//! Sync (vector exchange) and blob transfer logic on the driver.

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Instant;

use libp2p::PeerId;
use libp2p::request_response::{self, OutboundRequestId};
use serde_bytes::ByteBuf;

use crate::driver::{Driver, Internal};
use crate::proto::*;
use crate::store::{BlobId, IngestOutcome, ManifestInfo, SpaceId};
use crate::types::NodeError;

/// `None`: already complete. Otherwise the manifest (if known) and the missing chunk indices.
pub type BlobPlan = Option<(Option<ManifestInfo>, Vec<u32>)>;

type Reply = tokio::sync::oneshot::Sender<Result<(), NodeError>>;

/// Inclusive chunk indices a caller needs; clamped to the manifest once it is known.
pub type ChunkSpan = (u32, u32);

/// A caller awaiting a blob: the whole thing (`want: None`) or just some chunks of it.
struct Waiter {
    reply: Reply,
    want: Option<ChunkSpan>,
}

pub struct BlobJob {
    waiters: Vec<Waiter>,
    info: Option<ManifestInfo>,
    planned: bool,
    manifest_pending: bool,
    todo: VecDeque<u32>,
    remaining: HashSet<u32>,
    inflight: HashMap<OutboundRequestId, (Option<u32>, PeerId)>,
    tried: HashMap<Option<u32>, HashSet<PeerId>>,
    /// Failures per peer over the whole job: past `BLOB_PEER_MISS_LIMIT` it is not asked again.
    misses: HashMap<PeerId, u32>,
    deadline: Instant,
}

impl BlobJob {
    /// Chunks callers asked for by span go first, so a seek is not queued behind the rest.
    fn prioritize(&mut self) {
        let spans: Vec<ChunkSpan> = self.waiters.iter().filter_map(|w| w.want).collect();
        if spans.is_empty() {
            return;
        }
        let (mut hot, cold): (VecDeque<u32>, VecDeque<u32>) = self
            .todo
            .drain(..)
            .partition(|i| spans.iter().any(|(a, b)| (*a..=*b).contains(i)));
        hot.extend(cold);
        self.todo = hot;
    }

    /// Drops callers that gave up (their receiver is gone) so retries cannot pile up.
    fn prune_waiters(&mut self) {
        self.waiters.retain(|w| !w.reply.is_closed());
    }

    fn gave_up_on(&self, peer: &PeerId) -> bool {
        self.misses
            .get(peer)
            .is_some_and(|n| *n >= BLOB_PEER_MISS_LIMIT)
    }

    /// True once every chunk of `span` (clamped to the manifest) is stored.
    fn has_span(&self, (first, last): ChunkSpan) -> bool {
        let Some(info) = &self.info else { return false };
        let Some(end) = (info.chunks.len() as u32).checked_sub(1) else {
            return true;
        };
        (first.min(end)..=last.min(end)).all(|i| !self.remaining.contains(&i))
    }
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
                peer,
                ..
            } => {
                // Same empty answer for a space we have not joined and for a peer not (yet)
                // known as a member: strangers learn nothing, and an honest peer that asks
                // before its subscription reached us (connection race) is not struck.
                let member = self.spaces.contains(&request.space)
                    && self
                        .space_peers
                        .get(&request.space)
                        .is_some_and(|p| p.contains(&peer));
                let permit = if member && self.sync_in_rate.allow(&peer.to_string()) {
                    self.sync_serve_slots.clone().try_acquire_owned().ok()
                } else {
                    if member {
                        self.strike(peer);
                    }
                    None
                };
                let Some(permit) = permit else {
                    let _ = self.swarm.behaviour_mut().sync.send_response(
                        channel,
                        SyncResp {
                            events: vec![],
                            more: false,
                        },
                    );
                    return;
                };
                self.blocking(move |s| {
                    let _permit = permit;
                    let events = s.events_after(
                        &request.space,
                        &request.vector,
                        SYNC_PAGE_EVENTS,
                        SYNC_PAGE_BYTES,
                    );
                    let full = events.len() >= SYNC_PAGE_EVENTS;
                    let (events, cut) = fit_page(events, SYNC_PAGE_BYTES);
                    // A store that stops at the byte budget cannot say it left events behind:
                    // a page with less room than one maximum event may have been cut. A
                    // needless "more" costs the requester one empty round.
                    let bytes: usize = events.iter().map(Vec::len).sum();
                    let more = full || cut || bytes + MAX_GOSSIP_EVENT > SYNC_PAGE_BYTES;
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
                let from_member = self
                    .space_peers
                    .get(&space)
                    .is_some_and(|p| p.contains(&peer));
                let more = response.more;
                let events: Vec<_> = response.events.into_iter().take(SYNC_PAGE_EVENTS).collect();
                self.bytes_in += events.iter().map(|e| e.len() as u64).sum::<u64>();
                self.blocking(move |s| {
                    let (mut applied, mut rejected) = (0usize, 0usize);
                    for b in &events {
                        match s.ingest(&space, b) {
                            Ok(IngestOutcome::Applied) => applied += 1,
                            Ok(IngestOutcome::Rejected(_)) => rejected += 1,
                            _ => {}
                        }
                    }
                    if !more && from_member {
                        s.sync_complete(&space);
                    }
                    Internal::SyncApplied {
                        peer,
                        space,
                        applied,
                        rejected,
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
                peer,
                ..
            } => {
                let Ok(permit) = self.blob_serve_slots.clone().try_acquire_owned() else {
                    let _ = self
                        .swarm
                        .behaviour_mut()
                        .blob
                        .send_response(channel, BlobResp { data: None });
                    return;
                };
                if !acquire_serve(&mut self.serving, peer) {
                    let _ = self
                        .swarm
                        .behaviour_mut()
                        .blob
                        .send_response(channel, BlobResp { data: None });
                    return;
                }
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
                    // Refuse rather than sleep past the requester's own timeout.
                    let data = match data {
                        Some(d)
                            if !bucket
                                .take_within(d.len() as u64, BLOB_SERVE_MAX_WAIT)
                                .await =>
                        {
                            None
                        }
                        other => other,
                    };
                    drop(permit);
                    let _ = tx.send(Internal::BlobServed {
                        peer,
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
        *job.misses.entry(peer).or_default() += 1;
        match idx {
            None => job.manifest_pending = false,
            Some(i) => job.todo.push_front(i),
        }
        self.pump_job(&blob);
    }

    /// Start or join a fetch of `blob`. `want` limits what this caller waits for; the job
    /// still completes the whole blob in the background.
    pub fn request_blob(&mut self, blob: BlobId, want: Option<ChunkSpan>, reply: Reply) {
        let waiter = Waiter { reply, want };
        if let Some(j) = self.jobs.get_mut(&blob) {
            j.prune_waiters();
            j.waiters.push(waiter);
            j.prioritize();
            self.notify_spans(&blob);
            self.pump_job(&blob);
            return;
        }
        self.jobs.insert(
            blob,
            BlobJob {
                waiters: vec![waiter],
                info: None,
                planned: false,
                manifest_pending: false,
                todo: VecDeque::new(),
                remaining: HashSet::new(),
                inflight: HashMap::new(),
                tried: HashMap::new(),
                misses: HashMap::new(),
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
                    job.prioritize();
                }
                self.notify_spans(&blob);
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
                job.deadline = Instant::now() + self.cfg.blob_timeout;
                let n = info.chunks.len() as u32;
                job.todo = (0..n).collect();
                job.remaining = (0..n).collect();
                job.info = Some(info);
                if n == 0 {
                    return self.finish_job(blob);
                }
                job.prioritize();
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
                job.deadline = Instant::now() + self.cfg.blob_timeout;
                if job.remaining.is_empty() && job.info.is_some() {
                    self.finish_job(blob);
                } else {
                    self.notify_spans(&blob);
                    self.pump_job(&blob);
                }
            }
        }
    }

    /// Peers to ask, best first: announced providers and space members, then at most
    /// `BLOB_FALLBACK_PEERS` other connected peers. Returns the list and how many lead it as
    /// preferred. Banned peers are never asked.
    fn candidates(&self, blob: &BlobId) -> (Vec<PeerId>, usize) {
        let mut v: Vec<PeerId> = Vec::new();
        let announced = self.providers.get(blob).into_iter().flatten().copied();
        let members = self.space_peers.values().flatten().copied();
        for p in announced.chain(members) {
            if self.swarm.is_connected(&p) && !self.banned.contains_key(&p) && !v.contains(&p) {
                v.push(p);
            }
        }
        let preferred = v.len();
        let mut others = 0;
        for p in self.swarm.connected_peers().copied() {
            if others >= BLOB_FALLBACK_PEERS {
                break;
            }
            if !self.banned.contains_key(&p) && !v.contains(&p) {
                v.push(p);
                others += 1;
            }
        }
        (v, preferred)
    }

    pub fn pump_all_jobs(&mut self) {
        for b in self.jobs.keys().copied().collect::<Vec<_>>() {
            self.pump_job(&b);
        }
    }

    pub fn pump_job(&mut self, blob: &BlobId) {
        let (cands, preferred) = self.candidates(blob);
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
                    .enumerate()
                    .filter(|(_, p)| !tried.is_some_and(|t| t.contains(*p)) && !job.gave_up_on(p))
                    .min_by_key(|(i, p)| (*i >= preferred, load.get(*p).copied().unwrap_or(0)))
                    .map(|(_, p)| *p)
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
                    .all(|p| j.gave_up_on(p) || j.tried.get(&n).is_some_and(|t| t.contains(p)))
            {
                self.fail_job(blob, "no reachable peer has this blob".into());
            }
        }
    }

    /// Fails jobs idle past `blob_timeout` (the deadline moves on each manifest or chunk).
    pub fn expire_jobs(&mut self) {
        let now = Instant::now();
        for j in self.jobs.values_mut() {
            j.prune_waiters();
        }
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

    /// Answer the callers whose chunk span is now stored; the job keeps going for the rest.
    fn notify_spans(&mut self, blob: &BlobId) {
        let Some(job) = self.jobs.get_mut(blob) else {
            return;
        };
        job.prune_waiters();
        let waiters = std::mem::take(&mut job.waiters);
        let (done, pending): (Vec<_>, Vec<_>) = waiters
            .into_iter()
            .partition(|w| w.want.is_some_and(|span| job.has_span(span)));
        job.waiters = pending;
        for w in done {
            let _ = w.reply.send(Ok(()));
        }
    }

    fn finish_job(&mut self, blob: BlobId) {
        self.providers.remove(&blob);
        if let Some(j) = self.jobs.remove(&blob) {
            for w in j.waiters {
                let _ = w.reply.send(Ok(()));
            }
        }
    }

    fn fail_job(&mut self, blob: BlobId, why: String) {
        self.providers.remove(&blob);
        if let Some(j) = self.jobs.remove(&blob) {
            for w in j.waiters {
                let _ = w.reply.send(Err(NodeError::Blob(why.clone())));
            }
        }
    }
}

/// Keeps the leading events within `max_bytes` (always at least one) as a backstop for stores
/// that return more than the budget; the flag says whether anything was cut.
fn fit_page(mut events: Vec<Vec<u8>>, max_bytes: usize) -> (Vec<Vec<u8>>, bool) {
    let mut total = 0usize;
    let keep = events
        .iter()
        .take_while(|e| {
            total += e.len();
            total <= max_bytes
        })
        .count()
        .max(1.min(events.len()));
    let cut = keep < events.len();
    events.truncate(keep);
    (events, cut)
}

/// Takes one serve slot for `peer`; false when it already has `BLOB_SERVE_INFLIGHT_PER_PEER`.
fn acquire_serve(serving: &mut HashMap<PeerId, u32>, peer: PeerId) -> bool {
    let n = serving.entry(peer).or_default();
    if *n >= BLOB_SERVE_INFLIGHT_PER_PEER {
        return false;
    }
    *n += 1;
    true
}

/// Gives a slot back; the entry is dropped at zero so the map does not grow with peers.
pub(crate) fn release_serve(serving: &mut HashMap<PeerId, u32>, peer: PeerId) {
    if let Some(n) = serving.get_mut(&peer) {
        *n -= 1;
        if *n == 0 {
            serving.remove(&peer);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serve_slots_are_capped_per_peer_and_released() {
        let (a, b) = (PeerId::random(), PeerId::random());
        let mut m = HashMap::new();
        for _ in 0..BLOB_SERVE_INFLIGHT_PER_PEER {
            assert!(acquire_serve(&mut m, a));
        }
        assert!(!acquire_serve(&mut m, a), "over the cap");
        assert!(acquire_serve(&mut m, b), "other peers unaffected");
        release_serve(&mut m, a);
        assert!(acquire_serve(&mut m, a));
        for _ in 0..BLOB_SERVE_INFLIGHT_PER_PEER {
            release_serve(&mut m, a);
        }
        release_serve(&mut m, b);
        assert!(m.is_empty());
    }

    #[test]
    fn page_is_cut_at_the_byte_budget_but_never_empty() {
        let page = |sizes: &[usize]| sizes.iter().map(|n| vec![0u8; *n]).collect::<Vec<_>>();
        let (kept, cut) = fit_page(page(&[10, 10, 10]), 25);
        assert_eq!((kept.len(), cut), (2, true));
        let (kept, cut) = fit_page(page(&[10, 10]), 20);
        assert_eq!((kept.len(), cut), (2, false));
        let (kept, cut) = fit_page(page(&[100, 1]), 25);
        assert_eq!(
            (kept.len(), cut),
            (1, true),
            "an oversize first event still goes"
        );
        assert!(fit_page(Vec::new(), 25).0.is_empty());
    }

    #[test]
    fn global_serve_slots_are_capped() {
        let slots = std::sync::Arc::new(tokio::sync::Semaphore::new(BLOB_SERVE_GLOBAL_MAX));
        let held: Vec<_> = (0..BLOB_SERVE_GLOBAL_MAX)
            .map(|_| slots.clone().try_acquire_owned().expect("under the cap"))
            .collect();
        assert!(slots.clone().try_acquire_owned().is_err(), "over the cap");
        drop(held);
        assert!(slots.try_acquire_owned().is_ok());
    }

    #[test]
    fn closed_waiters_are_pruned() {
        let (live_tx, _live_rx) = tokio::sync::oneshot::channel();
        let (dead_tx, dead_rx) = tokio::sync::oneshot::channel();
        drop(dead_rx);
        let mut job = BlobJob {
            waiters: vec![
                Waiter {
                    reply: live_tx,
                    want: None,
                },
                Waiter {
                    reply: dead_tx,
                    want: Some((0, 1)),
                },
            ],
            info: None,
            planned: false,
            manifest_pending: false,
            todo: VecDeque::new(),
            remaining: HashSet::new(),
            inflight: HashMap::new(),
            tried: HashMap::new(),
            misses: HashMap::new(),
            deadline: Instant::now(),
        };
        job.prune_waiters();
        assert_eq!(job.waiters.len(), 1);
    }
}
