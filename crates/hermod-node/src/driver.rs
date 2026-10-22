//! Event loop: owns the swarm and all mutable node state.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use libp2p::futures::StreamExt;
use libp2p::gossipsub::{self, IdentTopic, TopicHash};
use libp2p::multiaddr::Protocol;
use libp2p::request_response::{self, OutboundRequestId, ResponseChannel};
use libp2p::swarm::dial_opts::{DialOpts, PeerCondition};
use libp2p::swarm::{ConnectionId, SwarmEvent};
use libp2p::{Multiaddr, PeerId, Swarm, autonat, identify, kad, mdns, relay, upnp};
use serde_bytes::ByteBuf;
use tokio::sync::{mpsc, oneshot};

use crate::addr::{Class, classify, peer_of, shareable, with_peer, without_peer};
use crate::behaviour::{Behaviour, BehaviourEvent, conn_limits, relay_server};
use crate::blobjob::BlobJob;
use crate::bucket::TokenBucket;
use crate::config::{Limits, NodeConfig, RelayMode};
use crate::proto::*;
use crate::store::{
    BlobId, GLOBAL_PEERS, IngestOutcome, ManifestInfo, NodeStore, SpaceId, StoreResult,
};
use crate::types::{NodeError, NodeEvent, NodeStatus, Reachability};

type Reply<T> = oneshot::Sender<Result<T, NodeError>>;

pub enum Command {
    Join(SpaceId, Reply<()>),
    Leave(SpaceId, Reply<()>),
    Publish(SpaceId, Vec<u8>, Reply<()>),
    RequestBlob(BlobId, Option<crate::blobjob::ChunkSpan>, Reply<()>),
    AnnounceBlob(SpaceId, BlobId, Reply<()>),
    Signal(SpaceId, Option<PeerId>, Vec<u8>, Reply<()>),
    Ephemeral(SpaceId, String, Vec<u8>, Reply<()>),
    Dial(Multiaddr, Reply<PeerId>),
    LocalAddrs(oneshot::Sender<Vec<Multiaddr>>),
    Status(oneshot::Sender<NodeStatus>),
    SetLimits(Limits, oneshot::Sender<()>),
    Shutdown(oneshot::Sender<()>),
}

/// Results of work done on blocking threads, fed back into the loop.
pub enum Internal {
    Ingested {
        space: SpaceId,
        source: PeerId,
        outcome: StoreResult<IngestOutcome>,
    },
    SyncVector {
        peer: PeerId,
        space: SpaceId,
        vector: std::collections::BTreeMap<String, u64>,
    },
    SyncServed {
        channel: ResponseChannel<SyncResp>,
        resp: SyncResp,
    },
    SyncApplied {
        peer: PeerId,
        space: SpaceId,
        applied: usize,
        more: bool,
    },
    BlobServed {
        peer: PeerId,
        channel: ResponseChannel<BlobResp>,
        resp: BlobResp,
    },
    BlobPlan {
        blob: BlobId,
        plan: Result<crate::blobjob::BlobPlan, String>,
    },
    BlobManifest {
        blob: BlobId,
        peer: PeerId,
        res: Result<ManifestInfo, String>,
    },
    BlobChunk {
        blob: BlobId,
        peer: PeerId,
        idx: u32,
        res: Result<(), String>,
    },
}

pub struct RateMap {
    rate: f64,
    burst: f64,
    m: HashMap<String, (f64, Instant)>,
}

impl RateMap {
    pub fn new(rate: f64, burst: f64) -> Self {
        Self {
            rate,
            burst,
            m: HashMap::new(),
        }
    }
    pub fn allow(&mut self, key: &str) -> bool {
        let now = Instant::now();
        let e = self.m.entry(key.to_string()).or_insert((self.burst, now));
        e.0 = (e.0 + now.duration_since(e.1).as_secs_f64() * self.rate).min(self.burst);
        e.1 = now;
        if e.0 >= 1.0 {
            e.0 -= 1.0;
            true
        } else {
            false
        }
    }
    pub fn gc(&mut self) {
        let cutoff = Instant::now() - Duration::from_secs(120);
        self.m.retain(|_, v| v.1 > cutoff);
    }
}

pub struct Driver {
    pub swarm: Swarm<Behaviour>,
    pub cfg: NodeConfig,
    pub limits: Limits,
    pub store: Arc<dyn NodeStore>,
    pub local: PeerId,
    pub events: mpsc::UnboundedSender<NodeEvent>,
    pub internal_tx: mpsc::UnboundedSender<Internal>,
    pub spaces: HashSet<SpaceId>,
    pub topics: HashMap<TopicHash, SpaceId>,
    pub eph_topics: HashMap<TopicHash, SpaceId>,
    pub space_peers: HashMap<SpaceId, HashSet<PeerId>>,
    pub peer_addrs: HashMap<PeerId, Vec<Multiaddr>>,
    pub listen_addrs: HashSet<Multiaddr>,
    pub relay_listen: HashSet<Multiaddr>,
    pub relay_hops: HashSet<PeerId>,
    pub reserved_on: HashSet<Multiaddr>,
    pub reachability: Reachability,
    pub upnp: Option<String>,
    pub circuits: u32,
    pub pending_dials: HashMap<ConnectionId, Reply<PeerId>>,
    pub sync_inflight: HashSet<(PeerId, SpaceId)>,
    pub sync_reqs: HashMap<OutboundRequestId, (PeerId, SpaceId)>,
    pub last_sync_count: u32,
    pub outbox: HashMap<SpaceId, VecDeque<Vec<u8>>>,
    pub jobs: HashMap<BlobId, BlobJob>,
    pub blob_reqs: HashMap<OutboundRequestId, (BlobId, Option<u32>, PeerId)>,
    pub providers: HashMap<BlobId, Vec<PeerId>>,
    pub bucket: Arc<TokenBucket>,
    pub book: HashMap<SpaceId, Vec<String>>,
    pub book_dirty: HashSet<SpaceId>,
    pub banned: HashMap<PeerId, Instant>,
    pub strikes: HashMap<PeerId, u32>,
    pub event_rate: RateMap,
    pub eph_in_rate: RateMap,
    pub eph_out_rate: RateMap,
    pub sync_in_rate: RateMap,
    pub signal_in_rate: RateMap,
    /// Blob requests currently being served, per requesting peer.
    pub serving: HashMap<PeerId, u32>,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub last_bytes: (u64, u64, Instant),
    pub rates: (u64, u64),
}

const BOOK_CAP: usize = 48;
const OUTBOX_CAP: usize = 4096;

impl Driver {
    pub fn new(
        swarm: Swarm<Behaviour>,
        cfg: NodeConfig,
        store: Arc<dyn NodeStore>,
        events: mpsc::UnboundedSender<NodeEvent>,
        internal_tx: mpsc::UnboundedSender<Internal>,
    ) -> Self {
        let local = *swarm.local_peer_id();
        let limits = cfg.limits.clone();
        let bucket = Arc::new(TokenBucket::new(limits.blob_serve_bps));
        Self {
            swarm,
            cfg,
            limits,
            store,
            local,
            events,
            internal_tx,
            spaces: HashSet::new(),
            topics: HashMap::new(),
            eph_topics: HashMap::new(),
            space_peers: HashMap::new(),
            peer_addrs: HashMap::new(),
            listen_addrs: HashSet::new(),
            relay_listen: HashSet::new(),
            relay_hops: HashSet::new(),
            reserved_on: HashSet::new(),
            reachability: Reachability::Unknown,
            upnp: None,
            circuits: 0,
            pending_dials: HashMap::new(),
            sync_inflight: HashSet::new(),
            sync_reqs: HashMap::new(),
            last_sync_count: 0,
            outbox: HashMap::new(),
            jobs: HashMap::new(),
            blob_reqs: HashMap::new(),
            providers: HashMap::new(),
            bucket,
            book: HashMap::new(),
            book_dirty: HashSet::new(),
            banned: HashMap::new(),
            strikes: HashMap::new(),
            event_rate: RateMap::new(EVENT_IN_RATE.0, EVENT_IN_RATE.1),
            eph_in_rate: RateMap::new(EPHEMERAL_RATE.0, EPHEMERAL_RATE.1),
            eph_out_rate: RateMap::new(EPHEMERAL_RATE.0, EPHEMERAL_RATE.1),
            sync_in_rate: RateMap::new(SYNC_IN_RATE.0, SYNC_IN_RATE.1),
            signal_in_rate: RateMap::new(SIGNAL_IN_RATE.0, SIGNAL_IN_RATE.1),
            serving: HashMap::new(),
            bytes_in: 0,
            bytes_out: 0,
            last_bytes: (0, 0, Instant::now()),
            rates: (0, 0),
        }
    }

    pub fn emit(&self, e: NodeEvent) {
        let _ = self.events.send(e);
    }

    /// Run a store call off the loop thread and feed its result back.
    pub fn blocking<F>(&self, f: F)
    where
        F: FnOnce(&dyn NodeStore) -> Internal + Send + 'static,
    {
        let store = self.store.clone();
        let tx = self.internal_tx.clone();
        tokio::task::spawn_blocking(move || {
            let _ = tx.send(f(store.as_ref()));
        });
    }

    pub async fn run(
        mut self,
        mut cmds: mpsc::UnboundedReceiver<Command>,
        mut internal: mpsc::UnboundedReceiver<Internal>,
    ) {
        self.startup();
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        let mut maint = tokio::time::interval(self.cfg.maintenance_interval);
        let mut n = 0u32;
        loop {
            tokio::select! {
                ev = self.swarm.select_next_some() => self.on_swarm(ev),
                cmd = cmds.recv() => match cmd {
                    Some(Command::Shutdown(done)) => {
                        self.flush_book();
                        let _ = done.send(());
                        return;
                    }
                    Some(c) => self.on_command(c),
                    None => { self.flush_book(); return; }
                },
                Some(i) = internal.recv() => self.on_internal(i),
                _ = tick.tick() => {
                    self.expire_jobs();
                    n += 1;
                    if n.is_multiple_of(5) { self.emit_status(); }
                }
                _ = maint.tick() => self.maintain(),
            }
        }
    }

    fn startup(&mut self) {
        for a in self.cfg.listen.clone() {
            if let Err(e) = self.swarm.listen_on(a.clone()) {
                tracing::warn!("listen_on {a} failed: {e}");
            }
        }
        for a in self.cfg.external_addrs.clone() {
            self.swarm.add_external_address(a);
        }
        for a in self.cfg.bootstrap.clone() {
            self.dial_quiet(a);
        }
        for s in self.cfg.peer_book.load(&GLOBAL_PEERS) {
            if let Ok(a) = s.parse() {
                self.dial_quiet(a);
            }
        }
        self.restore_bans();
        for s in self.store.joined_spaces() {
            let _ = self.join(s);
        }
        self.apply_relay_server();
        if self.cfg.reserve_always {
            self.reserve_on_relays();
        }
    }

    fn dial_quiet(&mut self, a: Multiaddr) {
        let opts = match peer_of(&a) {
            Some(p) if p == self.local => return,
            Some(p) => DialOpts::peer_id(p).addresses(vec![a]).build(),
            None => DialOpts::unknown_peer_id().address(a).build(),
        };
        if let Err(e) = self.swarm.dial(opts) {
            tracing::debug!("dial skipped: {e}");
        }
    }

    // ---- commands -------------------------------------------------------------------------

    fn on_command(&mut self, c: Command) {
        match c {
            Command::Join(s, r) => {
                let _ = r.send(self.join(s));
            }
            Command::Leave(s, r) => {
                let _ = r.send(self.leave(s));
            }
            Command::Publish(s, bytes, r) => {
                let _ = r.send(self.publish(s, bytes));
            }
            Command::RequestBlob(b, want, r) => self.request_blob(b, want, r),
            Command::AnnounceBlob(s, b, r) => {
                let res = self.gossip(&s, &Gossip::Provide(b)).map(|_| ());
                let _ = r.send(res);
            }
            Command::Signal(s, to, payload, r) => {
                let _ = r.send(self.signal(s, to, payload));
            }
            Command::Ephemeral(s, kind, payload, r) => {
                let _ = r.send(self.ephemeral(s, kind, payload));
            }
            Command::Dial(a, r) => self.dial(a, r),
            Command::LocalAddrs(r) => {
                let _ = r.send(self.local_addrs());
            }
            Command::Status(r) => {
                let _ = r.send(self.status());
            }
            Command::SetLimits(l, r) => {
                self.set_limits(l);
                let _ = r.send(());
            }
            Command::Shutdown(_) => {}
        }
    }

    fn join(&mut self, space: SpaceId) -> Result<(), NodeError> {
        if !self.spaces.insert(space) {
            return Ok(());
        }
        let t = IdentTopic::new(topic_name(&space));
        let e = IdentTopic::new(eph_topic_name(&space));
        let gs = &mut self.swarm.behaviour_mut().gossipsub;
        gs.subscribe(&t)
            .map_err(|e| NodeError::Invalid(e.to_string()))?;
        gs.subscribe(&e)
            .map_err(|e| NodeError::Invalid(e.to_string()))?;
        self.topics.insert(t.hash(), space);
        self.eph_topics.insert(e.hash(), space);
        self.space_peers.entry(space).or_default();
        let saved = self.cfg.peer_book.load(&space);
        self.book.insert(space, saved.clone());
        for s in saved {
            if let Ok(a) = s.parse() {
                self.dial_quiet(a);
            }
        }
        self.discover(space);
        // Peers we are already connected to may hold the space; ask them directly.
        for p in self.swarm.connected_peers().copied().collect::<Vec<_>>() {
            self.start_sync(p, space);
        }
        Ok(())
    }

    fn leave(&mut self, space: SpaceId) -> Result<(), NodeError> {
        if !self.spaces.remove(&space) {
            return Ok(());
        }
        let t = IdentTopic::new(topic_name(&space));
        let e = IdentTopic::new(eph_topic_name(&space));
        let gs = &mut self.swarm.behaviour_mut().gossipsub;
        gs.unsubscribe(&t);
        gs.unsubscribe(&e);
        self.topics.remove(&t.hash());
        self.eph_topics.remove(&e.hash());
        self.space_peers.remove(&space);
        self.outbox.remove(&space);
        self.report_sync();
        self.book_dirty.insert(space);
        self.flush_book();
        self.book.remove(&space);
        Ok(())
    }

    fn gossip(&mut self, space: &SpaceId, g: &Gossip) -> Result<bool, NodeError> {
        if !self.spaces.contains(space) {
            return Err(NodeError::Invalid("space not joined".into()));
        }
        let data = encode(g);
        let n = data.len() as u64;
        match self
            .swarm
            .behaviour_mut()
            .gossipsub
            .publish(IdentTopic::new(topic_name(space)), data)
        {
            Ok(_) => {
                self.bytes_out += n;
                Ok(true)
            }
            Err(gossipsub::PublishError::NoPeersSubscribedToTopic) => Ok(false),
            Err(e) => Err(NodeError::Publish(e.to_string())),
        }
    }

    fn publish(&mut self, space: SpaceId, bytes: Vec<u8>) -> Result<(), NodeError> {
        if bytes.len() > crate::proto::MAX_GOSSIP_EVENT {
            return Err(NodeError::Invalid("event too large".into()));
        }
        let g = Gossip::Event(ByteBuf::from(bytes.clone()));
        if !self.gossip(&space, &g)? {
            let q = self.outbox.entry(space).or_default();
            if q.len() >= OUTBOX_CAP {
                q.pop_front();
            }
            q.push_back(bytes);
            self.report_sync();
        }
        Ok(())
    }

    fn flush_outbox(&mut self, space: SpaceId) {
        let Some(mut q) = self.outbox.remove(&space) else {
            return;
        };
        while let Some(b) = q.pop_front() {
            let g = Gossip::Event(ByteBuf::from(b.clone()));
            match self.gossip(&space, &g) {
                Ok(true) => {}
                _ => {
                    q.push_front(b);
                    break;
                }
            }
        }
        if !q.is_empty() {
            self.outbox.insert(space, q);
        }
        self.report_sync();
    }

    fn signal(
        &mut self,
        space: SpaceId,
        to: Option<PeerId>,
        payload: Vec<u8>,
    ) -> Result<(), NodeError> {
        if payload.len() > MAX_SIGNAL_BYTES {
            return Err(NodeError::Invalid("signal too large".into()));
        }
        if !self.spaces.contains(&space) {
            return Err(NodeError::Invalid("space not joined".into()));
        }
        self.bytes_out += payload.len() as u64;
        match to {
            Some(p) if self.swarm.is_connected(&p) => {
                self.swarm.behaviour_mut().signal.send_request(
                    &p,
                    SignalReq {
                        space,
                        payload: ByteBuf::from(payload),
                    },
                );
                Ok(())
            }
            other => self
                .gossip(
                    &space,
                    &Gossip::Signal {
                        to: other.map(|p| p.to_string()),
                        payload: ByteBuf::from(payload),
                    },
                )
                .map(|_| ()),
        }
    }

    fn ephemeral(
        &mut self,
        space: SpaceId,
        kind: String,
        payload: Vec<u8>,
    ) -> Result<(), NodeError> {
        if !self.spaces.contains(&space) {
            return Ok(()); // not joined yet (the node subscribes after the space is created): ephemeral data is droppable by design
        }
        if kind.len() > MAX_EPHEMERAL_KIND || payload.len() > MAX_EPHEMERAL_BYTES {
            return Err(NodeError::Invalid("ephemeral message too large".into()));
        }
        if !self.eph_out_rate.allow(&hex::encode(space)) {
            return Ok(()); // rate-limited: ephemeral data is droppable by design
        }
        let data = encode(&Ephemeral {
            kind,
            payload: ByteBuf::from(payload),
        });
        self.bytes_out += data.len() as u64;
        match self
            .swarm
            .behaviour_mut()
            .gossipsub
            .publish(IdentTopic::new(eph_topic_name(&space)), data)
        {
            Ok(_) | Err(gossipsub::PublishError::NoPeersSubscribedToTopic) => Ok(()),
            Err(e) => Err(NodeError::Publish(e.to_string())),
        }
    }

    fn dial(&mut self, a: Multiaddr, r: Reply<PeerId>) {
        if let Some(p) = peer_of(&a) {
            if p == self.local {
                let _ = r.send(Err(NodeError::Dial("cannot dial self".into())));
                return;
            }
            if self.swarm.is_connected(&p) {
                let _ = r.send(Ok(p));
                return;
            }
        }
        let opts = match peer_of(&a) {
            Some(p) => DialOpts::peer_id(p)
                .addresses(vec![a])
                .condition(PeerCondition::Always)
                .build(),
            None => DialOpts::unknown_peer_id().address(a).build(),
        };
        let id = opts.connection_id();
        match self.swarm.dial(opts) {
            Ok(()) => {
                self.pending_dials.insert(id, r);
            }
            Err(e) => {
                let _ = r.send(Err(NodeError::Dial(e.to_string())));
            }
        }
    }

    fn set_limits(&mut self, l: Limits) {
        let l = l.clamped();
        self.bucket.set_rate(l.blob_serve_bps);
        *self.swarm.behaviour_mut().limits.limits_mut() = conn_limits(&l);
        let relay_changed = (
            l.relay_circuits,
            l.relay_bandwidth_bps,
            l.relay_bytes_per_circuit,
            l.relay_circuit_secs,
        ) != (
            self.limits.relay_circuits,
            self.limits.relay_bandwidth_bps,
            self.limits.relay_bytes_per_circuit,
            self.limits.relay_circuit_secs,
        );
        self.limits = l;
        self.apply_relay_server_force(relay_changed);
    }

    // ---- relay / NAT ----------------------------------------------------------------------

    fn want_relay_server(&self) -> bool {
        if self.limits.relay_paused {
            return false;
        }
        match self.cfg.relay_mode {
            RelayMode::Never => false,
            RelayMode::Always => true,
            RelayMode::Auto => self.reachability == Reachability::Public,
        }
    }

    pub fn apply_relay_server(&mut self) {
        self.apply_relay_server_force(false);
    }

    fn apply_relay_server_force(&mut self, force: bool) {
        let want = self.want_relay_server();
        let have = self.swarm.behaviour().relay_server.is_enabled();
        if want == have && !(force && want) {
            return;
        }
        self.swarm.behaviour_mut().relay_server = if want {
            relay_server(self.local, &self.limits)
        } else {
            libp2p::swarm::behaviour::toggle::Toggle::from(None)
        };
        tracing::info!("relay server {}", if want { "enabled" } else { "disabled" });
    }

    pub fn reserve_on_relays(&mut self) {
        let mut targets: Vec<Multiaddr> = self.cfg.relays.clone();
        for p in self.relay_hops.clone() {
            if let Some(a) = self.peer_addrs.get(&p).and_then(|v| {
                v.iter()
                    .find(|a| shareable(a, self.cfg.allow_private_addrs))
            }) {
                targets.push(with_peer(a.clone(), p));
            }
        }
        for t in targets {
            if self.reserved_on.len() >= 2 || peer_of(&t).is_none() {
                break;
            }
            if self.reserved_on.contains(&t) {
                continue;
            }
            let circuit = t.clone().with(Protocol::P2pCircuit);
            match self.swarm.listen_on(circuit) {
                Ok(_) => {
                    self.reserved_on.insert(t);
                }
                Err(e) => tracing::debug!("relay reservation failed: {e}"),
            }
        }
    }

    pub fn local_addrs(&self) -> Vec<Multiaddr> {
        let allow = self.cfg.allow_private_addrs;
        let mut v: Vec<Multiaddr> = self
            .swarm
            .external_addresses()
            .cloned()
            .chain(self.relay_listen.iter().cloned())
            .chain(self.listen_addrs.iter().cloned())
            .filter(|a| shareable(a, allow))
            .map(|a| with_peer(a, self.local))
            .collect();
        v.sort_by_key(classify);
        v.dedup();
        v
    }

    fn outbox_len(&self) -> u32 {
        self.outbox.values().map(|q| q.len() as u32).sum()
    }

    pub fn status(&self) -> NodeStatus {
        NodeStatus {
            peer_id: self.local.to_string(),
            peers: self.swarm.connected_peers().count() as u32,
            spaces: self.spaces.len() as u32,
            relaying_circuits: self.circuits,
            relay_serving: self.swarm.behaviour().relay_server.is_enabled(),
            reachability: self.reachability,
            external_addrs: self
                .swarm
                .external_addresses()
                .map(|a| a.to_string())
                .collect(),
            relay_listen: self.relay_listen.iter().map(|a| a.to_string()).collect(),
            upnp: self.upnp.clone(),
            bytes_in: self.bytes_in,
            bytes_out: self.bytes_out,
            rate_in_bps: self.rates.0,
            rate_out_bps: self.rates.1,
            sync_pending: self.sync_inflight.len() as u32,
            outbox: self.outbox_len(),
            banned: self.banned.len() as u32,
        }
    }

    fn emit_status(&mut self) {
        let dt = self.last_bytes.2.elapsed().as_secs_f64().max(0.001);
        self.rates = (
            ((self.bytes_in - self.last_bytes.0) as f64 / dt) as u64,
            ((self.bytes_out - self.last_bytes.1) as f64 / dt) as u64,
        );
        self.last_bytes = (self.bytes_in, self.bytes_out, Instant::now());
        self.emit(NodeEvent::Status(self.status()));
    }

    // ---- discovery / persistence ----------------------------------------------------------

    fn discover(&mut self, space: SpaceId) {
        let key = kad::RecordKey::new(&rendezvous_key(&space));
        let b = self.swarm.behaviour_mut();
        let _ = b.kad_hermod.start_providing(key.clone());
        b.kad_hermod.get_providers(key.clone());
        if let Some(k) = b.kad_ipfs.as_mut() {
            let _ = k.start_providing(key.clone());
            k.get_providers(key);
        }
    }

    fn maintain(&mut self) {
        let b = self.swarm.behaviour_mut();
        let _ = b.kad_hermod.bootstrap();
        if let Some(k) = b.kad_ipfs.as_mut() {
            let _ = k.bootstrap();
        }
        for s in self.spaces.clone() {
            self.discover(s);
            for p in self.space_peers.get(&s).cloned().unwrap_or_default() {
                self.start_sync(p, s);
            }
        }
        let now = Instant::now();
        let expired: Vec<PeerId> = self
            .banned
            .iter()
            .filter(|(_, t)| **t <= now)
            .map(|(p, _)| *p)
            .collect();
        for p in &expired {
            self.banned.remove(p);
            self.swarm.behaviour_mut().blocked.unblock_peer(*p);
        }
        if !expired.is_empty() {
            self.persist_bans();
        }
        self.strikes.clear();
        self.event_rate.gc();
        self.eph_in_rate.gc();
        self.eph_out_rate.gc();
        self.sync_in_rate.gc();
        self.signal_in_rate.gc();
        self.flush_book();
    }

    fn remember(&mut self, space: SpaceId, peer: PeerId) {
        let allow = self.cfg.allow_private_addrs;
        let Some(addrs) = self.peer_addrs.get(&peer) else {
            return;
        };
        let list = self.book.entry(space).or_default();
        for a in addrs.iter().filter(|a| shareable(a, allow)) {
            let s = with_peer(a.clone(), peer).to_string();
            list.retain(|x| *x != s);
            list.push(s);
        }
        if list.len() > BOOK_CAP {
            list.drain(..list.len() - BOOK_CAP);
        }
        self.book_dirty.insert(space);
    }

    fn flush_book(&mut self) {
        for s in std::mem::take(&mut self.book_dirty) {
            if let Some(list) = self.book.get(&s) {
                self.cfg.peer_book.save(&s, list);
            }
        }
    }

    // ---- swarm events ---------------------------------------------------------------------

    fn on_swarm(&mut self, ev: SwarmEvent<BehaviourEvent>) {
        match ev {
            SwarmEvent::Behaviour(b) => self.on_behaviour(b),
            SwarmEvent::NewListenAddr { address, .. } => {
                if classify(&address) == Class::Relay {
                    self.swarm.add_external_address(address.clone());
                    self.relay_listen.insert(address);
                } else {
                    // LAN-only deployments and tests have no public address; treating the
                    // listen address as external lets the relay server advertise its hop protocol.
                    if self.cfg.allow_private_addrs {
                        self.swarm.add_external_address(address.clone());
                    }
                    self.listen_addrs.insert(address);
                }
            }
            SwarmEvent::ExpiredListenAddr { address, .. } => {
                self.listen_addrs.remove(&address);
                self.relay_listen.remove(&address);
            }
            SwarmEvent::ConnectionEstablished {
                peer_id,
                connection_id,
                num_established,
                ..
            } => {
                if let Some(r) = self.pending_dials.remove(&connection_id) {
                    let _ = r.send(Ok(peer_id));
                }
                if num_established.get() == 1 {
                    for s in self.spaces.clone() {
                        self.start_sync(peer_id, s);
                    }
                    self.pump_all_jobs();
                }
            }
            SwarmEvent::ConnectionClosed {
                peer_id,
                num_established: 0,
                ..
            } => {
                for (space, peers) in self.space_peers.iter_mut() {
                    if peers.remove(&peer_id) {
                        let _ = self.events.send(NodeEvent::PeerLeft {
                            space: *space,
                            peer: peer_id,
                        });
                    }
                }
                self.sync_inflight.retain(|(p, _)| *p != peer_id);
                self.peer_addrs.remove(&peer_id);
                self.relay_hops.remove(&peer_id);
                self.report_sync();
            }
            SwarmEvent::OutgoingConnectionError {
                connection_id,
                error,
                ..
            } => {
                if let Some(r) = self.pending_dials.remove(&connection_id) {
                    let _ = r.send(Err(NodeError::Dial(error.to_string())));
                }
            }
            SwarmEvent::ListenerClosed { addresses, .. } => {
                for a in addresses {
                    self.relay_listen.remove(&a);
                    self.listen_addrs.remove(&a);
                    self.reserved_on
                        .retain(|r| r.clone().with(Protocol::P2pCircuit) != a);
                }
            }
            _ => {}
        }
    }

    fn on_behaviour(&mut self, ev: BehaviourEvent) {
        match ev {
            BehaviourEvent::Identify(identify::Event::Received { peer_id, info, .. }) => {
                self.on_identify(peer_id, info)
            }
            BehaviourEvent::Mdns(mdns::Event::Discovered(list)) => {
                for (p, a) in list {
                    if p == self.local {
                        continue;
                    }
                    self.swarm
                        .behaviour_mut()
                        .kad_hermod
                        .add_address(&p, a.clone());
                    if !self.swarm.is_connected(&p) {
                        self.dial_quiet(with_peer(a, p));
                    }
                }
            }
            BehaviourEvent::Autonat(autonat::v1::Event::StatusChanged { new, .. }) => {
                self.reachability = match new {
                    autonat::v1::NatStatus::Public(a) => {
                        self.swarm.add_external_address(a);
                        Reachability::Public
                    }
                    autonat::v1::NatStatus::Private => Reachability::Private,
                    autonat::v1::NatStatus::Unknown => Reachability::Unknown,
                };
                self.apply_relay_server();
                if self.reachability == Reachability::Private {
                    self.reserve_on_relays();
                }
            }
            BehaviourEvent::Upnp(e) => match e {
                upnp::Event::NewExternalAddr { external_addr, .. } => {
                    self.upnp = Some(external_addr.to_string())
                }
                upnp::Event::ExpiredExternalAddr { .. } => self.upnp = None,
                upnp::Event::GatewayNotFound | upnp::Event::NonRoutableGateway => self.upnp = None,
            },
            BehaviourEvent::KadHermod(e) => self.on_kad(e),
            BehaviourEvent::KadIpfs(e) => self.on_kad(e),
            BehaviourEvent::Gossipsub(e) => self.on_gossip_event(e),
            BehaviourEvent::Sync(e) => self.on_sync_event(e),
            BehaviourEvent::Blob(e) => self.on_blob_event(e),
            BehaviourEvent::Signal(e) => self.on_signal_event(e),
            BehaviourEvent::RelayServer(e) => match e {
                relay::Event::CircuitReqAccepted { .. } => self.circuits += 1,
                relay::Event::CircuitClosed { .. } => {
                    self.circuits = self.circuits.saturating_sub(1)
                }
                _ => {}
            },
            BehaviourEvent::RelayClient(relay::client::Event::ReservationReqAccepted {
                relay_peer_id,
                ..
            }) => {
                tracing::info!("relay reservation accepted by {relay_peer_id}");
            }
            BehaviourEvent::Dcutr(e) => {
                tracing::debug!("dcutr {}: {:?}", e.remote_peer_id, e.result.is_ok())
            }
            _ => {}
        }
    }

    fn on_identify(&mut self, peer: PeerId, info: identify::Info) {
        let allow = self.cfg.allow_private_addrs;
        let addrs: Vec<Multiaddr> = info
            .listen_addrs
            .iter()
            .cloned()
            .map(without_peer)
            .collect();
        let proto = |name: &str| info.protocols.iter().any(|p| p.as_ref() == name);
        let b = self.swarm.behaviour_mut();
        for a in addrs
            .iter()
            .filter(|a| shareable(a, allow) && classify(a) != Class::Relay)
        {
            if proto(KAD_PROTOCOL) {
                b.kad_hermod.add_address(&peer, a.clone());
            }
            if let (true, Some(k)) = (proto(kad::PROTOCOL_NAME.as_ref()), b.kad_ipfs.as_mut()) {
                k.add_address(&peer, a.clone());
            }
        }
        if proto(relay::HOP_PROTOCOL_NAME.as_ref()) {
            self.relay_hops.insert(peer);
            if self.cfg.reserve_always || self.reachability == Reachability::Private {
                self.peer_addrs.insert(peer, addrs.clone());
                self.reserve_on_relays();
            }
        }
        self.peer_addrs.insert(peer, addrs);
        // Remember the peer globally so a restart reconnects fast.
        let list = self.book.entry(GLOBAL_PEERS).or_default();
        let before = list.len();
        for a in self.peer_addrs[&peer]
            .iter()
            .filter(|a| shareable(a, allow))
        {
            let s = with_peer(a.clone(), peer).to_string();
            list.retain(|x| *x != s);
            list.push(s);
        }
        if list.len() > BOOK_CAP {
            list.drain(..list.len() - BOOK_CAP);
        }
        if list.len() != before || !self.peer_addrs[&peer].is_empty() {
            self.book_dirty.insert(GLOBAL_PEERS);
        }
        for (space, peers) in self.space_peers.clone() {
            if peers.contains(&peer) {
                self.remember(space, peer);
            }
        }
    }

    fn on_kad(&mut self, e: kad::Event) {
        if let kad::Event::OutboundQueryProgressed {
            result:
                kad::QueryResult::GetProviders(Ok(kad::GetProvidersOk::FoundProviders {
                    providers,
                    ..
                })),
            ..
        } = e
        {
            for p in providers {
                if p != self.local && !self.swarm.is_connected(&p) && !self.banned.contains_key(&p)
                {
                    let _ = self.swarm.dial(DialOpts::peer_id(p).build());
                }
            }
        }
    }

    pub fn strike(&mut self, peer: PeerId) {
        let n = self.strikes.entry(peer).or_default();
        *n += 1;
        if *n >= STRIKE_LIMIT && !self.banned.contains_key(&peer) {
            tracing::warn!("peer {peer} flooded, banning for 10 minutes");
            self.ban(peer, Duration::from_secs(BAN_SECS));
        }
    }

    /// Refuse `peer` at the transport (before a connection is established), drop it now, and
    /// remember the ban across restarts.
    fn ban(&mut self, peer: PeerId, dur: Duration) {
        self.banned.insert(peer, Instant::now() + dur);
        self.swarm.behaviour_mut().blocked.block_peer(peer);
        let _ = self.swarm.disconnect_peer_id(peer);
        self.persist_bans();
    }

    fn persist_bans(&self) {
        let now = Instant::now();
        let unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        let bans: Vec<(String, u64)> = self
            .banned
            .iter()
            .map(|(p, t)| {
                (
                    p.to_string(),
                    unix + t.saturating_duration_since(now).as_secs(),
                )
            })
            .collect();
        self.cfg.peer_book.save_bans(&bans);
    }

    fn restore_bans(&mut self) {
        let unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        for (p, until) in self.cfg.peer_book.load_bans() {
            let (Ok(peer), Some(left)) = (p.parse::<PeerId>(), until.checked_sub(unix)) else {
                continue;
            };
            if left > 0 {
                self.banned
                    .insert(peer, Instant::now() + Duration::from_secs(left));
                self.swarm.behaviour_mut().blocked.block_peer(peer);
            }
        }
    }

    fn on_gossip_event(&mut self, e: gossipsub::Event) {
        match e {
            gossipsub::Event::Subscribed { peer_id, topic } => {
                if let Some(space) = self.topics.get(&topic).copied() {
                    if self.space_peers.entry(space).or_default().insert(peer_id) {
                        self.emit(NodeEvent::PeerJoined {
                            space,
                            peer: peer_id,
                        });
                    }
                    self.remember(space, peer_id);
                    self.flush_outbox(space);
                    self.start_sync(peer_id, space);
                }
            }
            gossipsub::Event::Unsubscribed { peer_id, topic } => {
                if let Some(space) = self.topics.get(&topic).copied()
                    && self.space_peers.entry(space).or_default().remove(&peer_id)
                {
                    self.emit(NodeEvent::PeerLeft {
                        space,
                        peer: peer_id,
                    });
                }
            }
            gossipsub::Event::Message {
                propagation_source,
                message,
                ..
            } => {
                self.bytes_in += message.data.len() as u64;
                let src = message.source.unwrap_or(propagation_source);
                // A banned origin may still reach us through honest forwarders; drop it before any work.
                if self.banned.contains_key(&src) {
                    return;
                }
                if let Some(space) = self.topics.get(&message.topic).copied() {
                    self.on_space_gossip(space, src, &message.data);
                } else if let Some(space) = self.eph_topics.get(&message.topic).copied() {
                    self.on_ephemeral(space, src, &message.data);
                }
            }
            _ => {}
        }
    }

    fn on_space_gossip(&mut self, space: SpaceId, src: PeerId, data: &[u8]) {
        match decode::<Gossip>(data) {
            Some(Gossip::Event(bytes)) => {
                let bytes = bytes.into_vec();
                if bytes.len() > MAX_GOSSIP_EVENT {
                    self.strike(src);
                    return;
                }
                // Backstop per author, well above the store's own cap (30/s by default), so
                // the store's configured limit is the one that normally trips first.
                let key = self
                    .store
                    .event_author(&bytes)
                    .unwrap_or_else(|| src.to_string());
                if !self.event_rate.allow(&key) {
                    self.strike(src);
                    return;
                }
                self.blocking(move |s| Internal::Ingested {
                    space,
                    source: src,
                    outcome: s.ingest_gossip(&space, &bytes),
                });
            }
            Some(Gossip::Provide(blob)) => {
                // Only for blobs we are fetching: otherwise a peer could grow the map at will.
                if self.jobs.contains_key(&blob) {
                    let v = self.providers.entry(blob).or_default();
                    if !v.contains(&src) && v.len() < MAX_PROVIDERS_PER_BLOB {
                        v.push(src);
                    }
                    self.pump_job(&blob);
                }
            }
            Some(Gossip::Signal { to, payload }) => {
                let mine = to.as_deref().is_none_or(|t| t == self.local.to_string());
                if mine
                    && src != self.local
                    && payload.len() <= MAX_SIGNAL_BYTES
                    && self.signal_allowed(space, src)
                {
                    self.emit(NodeEvent::Signal {
                        space,
                        from: src,
                        payload: payload.into_vec(),
                    });
                }
            }
            None => self.strike(src),
        }
    }

    /// A signal is accepted only from a known member of the space within its rate budget.
    pub fn signal_allowed(&mut self, space: SpaceId, peer: PeerId) -> bool {
        if !self
            .space_peers
            .get(&space)
            .is_some_and(|p| p.contains(&peer))
        {
            return false;
        }
        if !self.signal_in_rate.allow(&peer.to_string()) {
            self.strike(peer);
            return false;
        }
        true
    }

    fn on_ephemeral(&mut self, space: SpaceId, src: PeerId, data: &[u8]) {
        if !self.eph_in_rate.allow(&src.to_string()) {
            return;
        }
        if let Some(e) = decode::<Ephemeral>(data)
            && e.fits()
        {
            self.emit(NodeEvent::Ephemeral {
                space,
                from: src,
                kind: e.kind,
                payload: e.payload.into_vec(),
            });
        }
    }

    fn on_signal_event(&mut self, e: request_response::Event<SignalReq, SignalAck>) {
        if let request_response::Event::Message {
            peer,
            message:
                request_response::Message::Request {
                    request, channel, ..
                },
            ..
        } = e
        {
            let ok = self.spaces.contains(&request.space)
                && request.payload.len() <= MAX_SIGNAL_BYTES
                && self.signal_allowed(request.space, peer);
            self.bytes_in += request.payload.len() as u64;
            if ok {
                self.emit(NodeEvent::Signal {
                    space: request.space,
                    from: peer,
                    payload: request.payload.into_vec(),
                });
            }
            let _ = self
                .swarm
                .behaviour_mut()
                .signal
                .send_response(channel, SignalAck { ok });
        }
    }

    fn on_internal(&mut self, i: Internal) {
        match i {
            Internal::Ingested {
                space,
                source,
                outcome,
            } => match outcome {
                Ok(IngestOutcome::Applied) => {
                    self.emit(NodeEvent::EventsIngested { space, count: 1 })
                }
                Ok(IngestOutcome::MissingPrior) => self.start_sync(source, space),
                Ok(IngestOutcome::Duplicate) => {}
                Ok(IngestOutcome::Rejected(why)) => {
                    tracing::debug!("rejected event from {source}: {why}");
                    self.strike(source);
                }
                Err(e) => tracing::warn!("ingest failed: {e}"),
            },
            Internal::SyncVector {
                peer,
                space,
                vector,
            } => {
                if !self.swarm.is_connected(&peer) || !self.spaces.contains(&space) {
                    self.sync_inflight.remove(&(peer, space));
                    self.report_sync();
                    return;
                }
                let id = self
                    .swarm
                    .behaviour_mut()
                    .sync
                    .send_request(&peer, SyncReq { space, vector });
                self.sync_reqs.insert(id, (peer, space));
            }
            Internal::SyncServed { channel, resp } => {
                let n: usize = resp.events.iter().map(|e| e.len()).sum();
                self.bytes_out += n as u64;
                let _ = self.swarm.behaviour_mut().sync.send_response(channel, resp);
            }
            Internal::SyncApplied {
                peer,
                space,
                applied,
                more,
            } => {
                self.sync_inflight.remove(&(peer, space));
                if applied > 0 {
                    self.emit(NodeEvent::EventsIngested {
                        space,
                        count: applied,
                    });
                }
                if more && applied > 0 {
                    self.start_sync(peer, space);
                }
                self.report_sync();
            }
            Internal::BlobServed {
                peer,
                channel,
                resp,
            } => {
                crate::blobjob::release_serve(&mut self.serving, peer);
                self.bytes_out += resp.data.as_ref().map_or(0, |d| d.len() as u64);
                let _ = self.swarm.behaviour_mut().blob.send_response(channel, resp);
            }
            Internal::BlobPlan { blob, plan } => self.on_blob_plan(blob, plan),
            Internal::BlobManifest { blob, peer, res } => self.on_blob_manifest(blob, peer, res),
            Internal::BlobChunk {
                blob,
                peer,
                idx,
                res,
            } => self.on_blob_chunk(blob, peer, idx, res),
        }
    }

    /// Work still owed to the network: queued outbound events plus syncs in flight.
    pub fn report_sync(&mut self) {
        let n = self.sync_inflight.len() as u32 + self.outbox_len();
        if n != self.last_sync_count {
            self.last_sync_count = n;
            self.emit(NodeEvent::SyncPending { count: n });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::RateMap;

    #[test]
    fn rate_map_caps_burst_per_key() {
        let mut r = RateMap::new(0.0, 3.0);
        assert!((0..5).filter(|_| r.allow("a")).count() == 3);
        assert!(r.allow("b"));
    }
}
