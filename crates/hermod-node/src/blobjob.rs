//! Sync (vector exchange) and blob transfer logic on the driver.

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Instant;

use libp2p::PeerId;
use libp2p::request_response::{self, OutboundRequestId};
use serde_bytes::ByteBuf;

use crate::driver::{Driver, Internal};
use crate::proto::*;
use crate::store::{BlobId, ManifestInfo, SpaceId};
use crate::types::NodeError;

/// `None`: already complete. Otherwise the manifest (if known) and the missing chunk indices.
pub type BlobPlan = Option<(Option<ManifestInfo>, Vec<u32>)>;

type Reply = tokio::sync::oneshot::Sender<Result<(), NodeError>>;

pub struct BlobJob {
    waiters: Vec<Reply>,
    info: Option<ManifestInfo>,
    planned: bool,
    manifest_pending: bool,
    todo: VecDeque<u32>,
    remaining: HashSet<u32>,
    inflight: HashMap<OutboundRequestId, (Option<u32>, PeerId)>,
    tried: HashMap<Option<u32>, HashSet<PeerId>>,
    deadline: Instant,
}

impl Driver {
    // ---- sync -----------------------------------------------------------------------------

    pub fn start_sync(&mut self, peer: PeerId, space: SpaceId) {
        if !self.spaces.contains(&space) || self.banned.contains_key(&peer) {
            return;
        }
        if !self.sync_inflight.insert((peer, space)) {
            return;
        }
        self.report_sync();
        self.blocking(move |s| Internal::SyncVector {
            peer,
            space,
            vector: s.vector(&space),
        });
    }

    pub fn on_sync_event(&mut self, e: request_response::Event<SyncReq, SyncResp>) {
        use request_response::{Event, Message};
        match e {
            Event::Message {
                message:
                    Message::Request {
                        request, channel, ..
                    },
                ..
            } => {
                if !self.spaces.contains(&request.space) {
                    let _ = self.swarm.behaviour_mut().sync.send_response(
                        channel,
                        SyncResp {
                            events: vec![],
                            more: false,
                        },
                    );
                    return;
                }
                self.blocking(move |s| {
                    let mut events =
                        s.events_after(&request.space, &request.vector, SYNC_PAGE_EVENTS);
                    let mut more = events.len() >= SYNC_PAGE_EVENTS;
                    let mut total = 0usize;
                    let keep = events
                        .iter()
                        .take_while(|e| {
                            total += e.len();
                            total <= SYNC_PAGE_BYTES
                        })
                        .count()
                        .max(1.min(events.len()));
                    if keep < events.len() {
                        events.truncate(keep);
                        more = true;
                    }
                    let events = events.into_iter().map(ByteBuf::from).collect();
                    Internal::SyncServed {
                        channel,
                        resp: SyncResp { events, more },
                    }
                });
            }
            Event::Message {
                message:
                    Message::Response {
                        request_id,
                        response,
                    },
                ..
            } => {
                let Some((peer, space)) = self.sync_reqs.remove(&request_id) else {
                    return;
                };
                let more = response.more;
                let events: Vec<_> = response.events.into_iter().take(SYNC_PAGE_EVENTS).collect();
                self.bytes_in += events.iter().map(|e| e.len() as u64).sum::<u64>();
                self.blocking(move |s| {
                    let applied = events
                        .iter()
                        .filter(|b| {
                            matches!(
                                s.ingest(&space, b),
                                Ok(crate::store::IngestOutcome::Applied)
                            )
                        })
                        .count();
                    Internal::SyncApplied {
                        peer,
                        space,
                        applied,
                        more,
                    }
                });
            }
            Event::OutboundFailure { request_id, .. } => {
                if let Some(k) = self.sync_reqs.remove(&request_id) {
                    self.sync_inflight.remove(&k);
                    self.report_sync();
                }
            }
            _ => {}
        }
    }

    // ---- blob serving and fetching ---------------------------------------------------------

    pub fn on_blob_event(&mut self, e: request_response::Event<BlobReq, BlobResp>) {
        use request_response::{Event, Message};
        match e {
            Event::Message {
                message:
                    Message::Request {
                        request, channel, ..
                    },
                ..
            } => {
                let store = self.store.clone();
                let tx = self.internal_tx.clone();
                let bucket = self.bucket.clone();
                tokio::spawn(async move {
                    let BlobReq { blob, idx } = request;
                    let data = tokio::task::spawn_blocking(move || match idx {
                        None => store.blob_manifest(&blob),
                        Some(i) => store.blob_chunk(&blob, i),
                    })
                    .await
                    .ok()
                    .flatten();
                    if let Some(d) = &data {
                        bucket.take(d.len() as u64).await;
                    }
                    let _ = tx.send(Internal::BlobServed {
                        channel,
                        resp: BlobResp {
                            data: data.map(ByteBuf::from),
                        },
                    });
                });
            }
            Event::Message {
                message:
                    Message::Response {
                        request_id,
                        response,
                    },
                ..
            } => {
                let Some((blob, idx, peer)) = self.blob_reqs.remove(&request_id) else {
                    return;
                };
                let Some(job) = self.jobs.get_mut(&blob) else {
                    return;
                };
                job.inflight.remove(&request_id);
                match response.data {
                    Some(d) => {
                        self.bytes_in += d.len() as u64;
                        self.on_blob_data(blob, peer, idx, d.into_vec());
                    }
                    None => self.blob_miss(blob, peer, idx),
                }
            }
            Event::OutboundFailure {
                peer, request_id, ..
            } => {
                if let Some((blob, idx, _)) = self.blob_reqs.remove(&request_id) {
                    if let Some(j) = self.jobs.get_mut(&blob) {
                        j.inflight.remove(&request_id);
                    }
                    self.blob_miss(blob, peer, idx);
                }
            }
            _ => {}
        }
    }

    fn on_blob_data(&mut self, blob: BlobId, peer: PeerId, idx: Option<u32>, data: Vec<u8>) {
        let Some(job) = self.jobs.get_mut(&blob) else {
            return;
        };
        match idx {
            None => {
                self.blocking(move |s| Internal::BlobManifest {
                    blob,
                    peer,
                    res: s.blob_put_manifest(&blob, &data).map_err(|e| e.to_string()),
                });
            }
            Some(i) => {
                let Some(want) = job
                    .info
                    .as_ref()
                    .and_then(|m| m.chunks.get(i as usize))
                    .copied()
                else {
                    return;
                };
                self.blocking(move |s| {
                    let res = if *blake3::hash(&data).as_bytes() != want {
                        Err("chunk hash mismatch".to_string())
                    } else {
                        s.blob_put_chunk(&blob, i, &data).map_err(|e| e.to_string())
                    };
                    Internal::BlobChunk {
                        blob,
                        peer,
                        idx: i,
                        res,
                    }
                });
            }
        }
    }

    /// A peer failed to deliver: remember it and retry elsewhere.
    fn blob_miss(&mut self, blob: BlobId, peer: PeerId, idx: Option<u32>) {
        let Some(job) = self.jobs.get_mut(&blob) else {
            return;
        };
        job.tried.entry(idx).or_default().insert(peer);
        match idx {
            None => job.manifest_pending = false,
            Some(i) => job.todo.push_front(i),
        }
        self.pump_job(&blob);
    }

    pub fn request_blob(&mut self, blob: BlobId, reply: Reply) {
        if let Some(j) = self.jobs.get_mut(&blob) {
            j.waiters.push(reply);
            return;
        }
        self.jobs.insert(
            blob,
            BlobJob {
                waiters: vec![reply],
                info: None,
                planned: false,
                manifest_pending: false,
                todo: VecDeque::new(),
                remaining: HashSet::new(),
                inflight: HashMap::new(),
                tried: HashMap::new(),
                deadline: Instant::now() + self.cfg.blob_timeout,
            },
        );
        self.blocking(move |s| {
            let plan = (|| {
                if s.blob_has(&blob) {
                    return Ok(None);
                }
                match s.blob_manifest(&blob) {
                    Some(bytes) => {
                        let info = s
                            .blob_put_manifest(&blob, &bytes)
                            .map_err(|e| e.to_string())?;
                        Ok(Some((Some(info), s.blob_missing(&blob))))
                    }
                    None => Ok(Some((None, Vec::new()))),
                }
            })();
            Internal::BlobPlan { blob, plan }
        });
    }

    pub fn on_blob_plan(&mut self, blob: BlobId, plan: Result<BlobPlan, String>) {
        match plan {
            Err(e) => self.fail_job(blob, e),
            Ok(None) => self.finish_job(blob),
            Ok(Some((info, missing))) => {
                let Some(job) = self.jobs.get_mut(&blob) else {
                    return;
                };
                job.planned = true;
                if info.is_some() {
                    job.info = info;
                    job.todo = missing.iter().copied().collect();
                    job.remaining = missing.into_iter().collect();
                    if job.remaining.is_empty() {
                        return self.finish_job(blob);
                    }
                }
                self.pump_job(&blob);
            }
        }
    }

    pub fn on_blob_manifest(
        &mut self,
        blob: BlobId,
        peer: PeerId,
        res: Result<ManifestInfo, String>,
    ) {
        match res {
            Err(e) => {
                tracing::debug!("bad manifest from {peer}: {e}");
                self.blob_miss(blob, peer, None);
            }
            Ok(info) => {
                let Some(job) = self.jobs.get_mut(&blob) else {
                    return;
                };
                job.manifest_pending = false;
                let n = info.chunks.len() as u32;
                job.todo = (0..n).collect();
                job.remaining = (0..n).collect();
                job.info = Some(info);
                if n == 0 {
                    return self.finish_job(blob);
                }
                self.pump_job(&blob);
            }
        }
    }

    pub fn on_blob_chunk(&mut self, blob: BlobId, peer: PeerId, idx: u32, res: Result<(), String>) {
        match res {
            Err(e) => {
                tracing::debug!("bad chunk {idx} from {peer}: {e}");
                self.blob_miss(blob, peer, Some(idx));
            }
            Ok(()) => {
                let Some(job) = self.jobs.get_mut(&blob) else {
                    return;
                };
                job.remaining.remove(&idx);
                if job.remaining.is_empty() && job.info.is_some() {
                    self.finish_job(blob);
                } else {
                    self.pump_job(&blob);
                }
            }
        }
    }

    fn candidates(&self, blob: &BlobId) -> Vec<PeerId> {
        let mut v: Vec<PeerId> = Vec::new();
        let announced = self.providers.get(blob).into_iter().flatten().copied();
        for p in announced.chain(self.swarm.connected_peers().copied()) {
            if self.swarm.is_connected(&p) && !v.contains(&p) {
                v.push(p);
            }
        }
        v
    }

    pub fn pump_all_jobs(&mut self) {
        for b in self.jobs.keys().copied().collect::<Vec<_>>() {
            self.pump_job(&b);
        }
    }

    pub fn pump_job(&mut self, blob: &BlobId) {
        let cands = self.candidates(blob);
        let Some(job) = self.jobs.get_mut(blob) else {
            return;
        };
        if !job.planned {
            return;
        }
        let mut load: HashMap<PeerId, usize> = HashMap::new();
        for (_, p) in job.inflight.values() {
            *load.entry(*p).or_default() += 1;
        }
        let pick =
            |job: &BlobJob, load: &HashMap<PeerId, usize>, idx: Option<u32>| -> Option<PeerId> {
                let tried = job.tried.get(&idx);
                cands
                    .iter()
                    .filter(|p| !tried.is_some_and(|t| t.contains(*p)))
                    .min_by_key(|p| load.get(*p).copied().unwrap_or(0))
                    .copied()
            };
        let mut sends: Vec<(PeerId, Option<u32>)> = Vec::new();
        if job.info.is_none() {
            if let (false, Some(p)) = (job.manifest_pending, pick(job, &load, None)) {
                job.manifest_pending = true;
                sends.push((p, None));
            }
        } else {
            let mut chunk_inflight = job.inflight.values().filter(|(i, _)| i.is_some()).count();
            while chunk_inflight < BLOB_WINDOW {
                let Some(&idx) = job.todo.front() else { break };
                let Some(p) = pick(job, &load, Some(idx)) else {
                    break;
                };
                job.todo.pop_front();
                sends.push((p, Some(idx)));
                chunk_inflight += 1;
                *load.entry(p).or_default() += 1;
            }
        }
        let blob = *blob;
        for (p, idx) in sends {
            let id = self
                .swarm
                .behaviour_mut()
                .blob
                .send_request(&p, BlobReq { blob, idx });
            self.blob_reqs.insert(id, (blob, idx, p));
            if let Some(j) = self.jobs.get_mut(&blob) {
                j.inflight.insert(id, (idx, p));
            }
        }
        // Stuck: nothing in flight, nothing pending, yet every candidate already failed us.
        if let Some(j) = self.jobs.get(&blob) {
            let idle = j.inflight.is_empty() && !j.manifest_pending && !cands.is_empty();
            let next = if j.info.is_none() {
                Some(None)
            } else {
                j.todo.front().map(|i| Some(*i))
            };
            if let (true, Some(n)) = (idle, next)
                && cands
                    .iter()
                    .all(|p| j.tried.get(&n).is_some_and(|t| t.contains(p)))
            {
                self.fail_job(blob, "no reachable peer has this blob".into());
            }
        }
    }

    pub fn expire_jobs(&mut self) {
        let now = Instant::now();
        let dead: Vec<BlobId> = self
            .jobs
            .iter()
            .filter(|(_, j)| j.deadline <= now)
            .map(|(b, _)| *b)
            .collect();
        for b in dead {
            self.fail_job(b, "timed out".into());
        }
    }

    fn finish_job(&mut self, blob: BlobId) {
        if let Some(j) = self.jobs.remove(&blob) {
            for w in j.waiters {
                let _ = w.send(Ok(()));
            }
        }
    }

    fn fail_job(&mut self, blob: BlobId, why: String) {
        if let Some(j) = self.jobs.remove(&blob) {
            for w in j.waiters {
                let _ = w.send(Err(NodeError::Blob(why.clone())));
            }
        }
    }
}
