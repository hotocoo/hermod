//! Three-node localhost integration tests. `MemStore` is a test double for `NodeStore`;
//! it lives here and is never part of the shipped crate.

use std::collections::BTreeMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use hermod_node::config::{Limits, NodeConfig, RelayMode};
use hermod_node::store::{
    Author, BlobId, FilePeerBook, IngestOutcome, ManifestInfo, NodeStore, SpaceId, StoreError,
    StoreResult,
};
use hermod_node::{Multiaddr, Node, NodeEvent, NodeHandle, NodeStatus};
use libp2p::identity::ed25519;
use tokio::sync::mpsc::UnboundedReceiver;

const CHUNK: usize = 1024;
const SPACE: SpaceId = [9u8; 32];
/// Chunks in the blob of the tail-fetch test: at the default serve rate (2 MiB/s) the whole
/// transfer takes seconds, the tail chunk one round trip.
const TAIL_TEST_CHUNKS: usize = 4096;
/// Author whose live gossip the test store rejects, standing in for a flooder over the core cap.
const FLOODER: &str = "mallory";

#[derive(Default)]
struct Inner {
    events: BTreeMap<Author, BTreeMap<u64, Vec<u8>>>,
    manifests: BTreeMap<BlobId, Vec<u8>>,
    chunks: BTreeMap<(BlobId, u32), Vec<u8>>,
}

#[derive(Default)]
struct MemStore(Mutex<Inner>);

// Event wire format in tests: "<author>|<seq>|<payload>".
fn ev(author: &str, seq: u64) -> Vec<u8> {
    format!("{author}|{seq}|hello-{seq}").into_bytes()
}

fn parse(b: &[u8]) -> Option<(String, u64)> {
    let s = std::str::from_utf8(b).ok()?;
    let mut it = s.splitn(3, '|');
    Some((it.next()?.to_string(), it.next()?.parse().ok()?))
}

fn manifest_bytes(data: &[u8]) -> Vec<u8> {
    let mut out = (data.len() as u64).to_le_bytes().to_vec();
    for c in data.chunks(CHUNK) {
        out.extend_from_slice(blake3::hash(c).as_bytes());
    }
    out
}

fn parse_manifest(b: &[u8]) -> Option<ManifestInfo> {
    let size = u64::from_le_bytes(b.get(..8)?.try_into().ok()?);
    let chunks: Vec<[u8; 32]> = b[8..]
        .chunks(32)
        .map(|c| c.try_into().ok())
        .collect::<Option<_>>()?;
    (chunks.len() as u64 == size.div_ceil(CHUNK as u64)).then_some(ManifestInfo { size, chunks })
}

impl MemStore {
    fn add_event(&self, author: &str, seq: u64) -> Vec<u8> {
        let b = ev(author, seq);
        self.0
            .lock()
            .unwrap()
            .events
            .entry(author.into())
            .or_default()
            .insert(seq, b.clone());
        b
    }
    /// An event padded to `size` bytes, to exercise the sync page byte budget.
    fn add_big_event(&self, author: &str, seq: u64, size: usize) {
        let mut b = ev(author, seq);
        b.resize(size, b'x');
        self.0
            .lock()
            .unwrap()
            .events
            .entry(author.into())
            .or_default()
            .insert(seq, b);
    }
    fn count(&self) -> usize {
        self.0
            .lock()
            .unwrap()
            .events
            .values()
            .map(|m| m.len())
            .sum()
    }
    /// Store a full blob; `corrupt` flips a byte in chunk 1 after hashing.
    fn add_blob(&self, data: &[u8], corrupt: bool) -> BlobId {
        let m = manifest_bytes(data);
        let id = *blake3::hash(&m).as_bytes();
        let mut g = self.0.lock().unwrap();
        g.manifests.insert(id, m);
        for (i, c) in data.chunks(CHUNK).enumerate() {
            let mut c = c.to_vec();
            if corrupt && i == 1 {
                c[0] ^= 0xff;
            }
            g.chunks.insert((id, i as u32), c);
        }
        id
    }
    fn read_blob(&self, id: &BlobId) -> Option<Vec<u8>> {
        let g = self.0.lock().unwrap();
        let info = parse_manifest(g.manifests.get(id)?)?;
        let mut out = Vec::new();
        for i in 0..info.chunks.len() as u32 {
            out.extend_from_slice(g.chunks.get(&(*id, i))?);
        }
        Some(out)
    }
}

impl NodeStore for MemStore {
    fn joined_spaces(&self) -> Vec<SpaceId> {
        Vec::new()
    }
    fn vector(&self, _: &SpaceId) -> BTreeMap<Author, u64> {
        let g = self.0.lock().unwrap();
        g.events
            .iter()
            .filter_map(|(a, m)| Some((a.clone(), *m.keys().next_back()?)))
            .collect()
    }
    fn events_after(
        &self,
        _: &SpaceId,
        v: &BTreeMap<Author, u64>,
        limit: usize,
        max_bytes: usize,
    ) -> Vec<Vec<u8>> {
        let g = self.0.lock().unwrap();
        let mut out: Vec<Vec<u8>> = Vec::new();
        let mut total = 0usize;
        for (a, m) in &g.events {
            let have = v.get(a).copied().unwrap_or(0);
            for (_, b) in m.range(have + 1..) {
                if out.len() >= limit || (!out.is_empty() && total + b.len() > max_bytes) {
                    return out;
                }
                total += b.len();
                out.push(b.clone());
            }
        }
        out
    }
    fn ingest_gossip(&self, space: &SpaceId, bytes: &[u8]) -> StoreResult<IngestOutcome> {
        if parse(bytes).is_some_and(|(a, _)| a.starts_with(FLOODER)) {
            return Ok(IngestOutcome::Rejected("rate limit exceeded".into()));
        }
        self.ingest(space, bytes)
    }
    fn ingest(&self, _: &SpaceId, bytes: &[u8]) -> StoreResult<IngestOutcome> {
        let Some((a, seq)) = parse(bytes) else {
            return Ok(IngestOutcome::Rejected("malformed".into()));
        };
        let mut g = self.0.lock().unwrap();
        let m = g.events.entry(a).or_default();
        let top = m.keys().next_back().copied().unwrap_or(0);
        Ok(if seq <= top {
            IngestOutcome::Duplicate
        } else if seq == top + 1 {
            m.insert(seq, bytes.to_vec());
            IngestOutcome::Applied
        } else {
            IngestOutcome::MissingPrior
        })
    }
    fn blob_has(&self, b: &BlobId) -> bool {
        self.read_blob(b).is_some()
    }
    fn blob_manifest(&self, b: &BlobId) -> Option<Vec<u8>> {
        self.0.lock().unwrap().manifests.get(b).cloned()
    }
    fn blob_put_manifest(&self, b: &BlobId, bytes: &[u8]) -> StoreResult<ManifestInfo> {
        if blake3::hash(bytes).as_bytes() != b {
            return Err(StoreError("manifest does not hash to id".into()));
        }
        let info = parse_manifest(bytes).ok_or_else(|| StoreError("bad manifest".into()))?;
        self.0.lock().unwrap().manifests.insert(*b, bytes.to_vec());
        Ok(info)
    }
    fn blob_missing(&self, b: &BlobId) -> Vec<u32> {
        let g = self.0.lock().unwrap();
        let Some(info) = g.manifests.get(b).and_then(|m| parse_manifest(m)) else {
            return Vec::new();
        };
        (0..info.chunks.len() as u32)
            .filter(|i| !g.chunks.contains_key(&(*b, *i)))
            .collect()
    }
    fn event_author(&self, bytes: &[u8]) -> Option<Author> {
        parse(bytes).map(|p| p.0)
    }
    fn blob_chunk(&self, b: &BlobId, i: u32) -> Option<Vec<u8>> {
        self.0.lock().unwrap().chunks.get(&(*b, i)).cloned()
    }
    fn blob_put_chunk(&self, b: &BlobId, i: u32, bytes: &[u8]) -> StoreResult<()> {
        self.0
            .lock()
            .unwrap()
            .chunks
            .insert((*b, i), bytes.to_vec());
        Ok(())
    }
}

fn test_cfg() -> NodeConfig {
    NodeConfig {
        listen: vec!["/ip4/127.0.0.1/tcp/0".parse().unwrap()],
        bootstrap: vec![],
        enable_mdns: false,
        enable_upnp: false,
        enable_dht: false,
        allow_private_addrs: true,
        relay_mode: RelayMode::Never,
        gossip_heartbeat: Duration::from_millis(200),
        blob_timeout: Duration::from_secs(10),
        ..NodeConfig::default()
    }
}

struct Peer {
    h: NodeHandle,
    store: Arc<MemStore>,
    events: UnboundedReceiver<NodeEvent>,
}

fn new_key() -> [u8; 32] {
    ed25519::Keypair::generate()
        .secret()
        .as_ref()
        .try_into()
        .unwrap()
}

async fn spawn(cfg: NodeConfig) -> Peer {
    spawn_keyed(cfg, new_key()).await
}

async fn spawn_keyed(cfg: NodeConfig, key: [u8; 32]) -> Peer {
    let store = Arc::new(MemStore::default());
    let (h, events) = Node::start(cfg, key, store.clone()).await.unwrap();
    Peer { h, store, events }
}

/// Ceiling for one network step (dial, gossip hop, backfill, blob round). Alone these take
/// milliseconds, but `cargo test --workspace` runs every test binary at once and a loaded
/// runner starves the swarm's IO tasks: measured a backfill crossing 20 s under that load
/// while passing in 0.2 s alone. The ceiling only bounds a real hang, so keep it generous.
const WAIT_TIMEOUT: Duration = Duration::from_secs(90);

async fn within<F: Future>(what: &str, f: F) -> F::Output {
    tokio::time::timeout(WAIT_TIMEOUT, f)
        .await
        .unwrap_or_else(|_| panic!("timed out: {what}"))
}

async fn until(what: &str, mut cond: impl FnMut() -> bool) {
    within(what, async {
        while !cond() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
}

async fn first_addr(h: &NodeHandle) -> Multiaddr {
    within("listen addr", async {
        loop {
            if let Some(a) = h.local_addrs().await.unwrap().into_iter().next() {
                return a;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn gossip_backfill_and_blob() {
    let a = spawn(test_cfg()).await;
    let b = spawn(test_cfg()).await;
    let mut c = spawn(test_cfg()).await;
    a.h.join_space(SPACE).await.unwrap();
    b.h.join_space(SPACE).await.unwrap();

    // Published with nobody around: sits in the outbox, flushes once B connects.
    let e1 = a.store.add_event("alice", 1);
    a.h.publish_event(SPACE, e1).await.unwrap();
    assert_eq!(a.h.status().await.unwrap().outbox, 1);
    let a_addr = first_addr(&a.h).await;
    b.h.dial(vec![a_addr.clone()]).await.unwrap();
    until("B receives gossip", || b.store.count() == 1).await;

    // Live publish while connected.
    let e2 = a.store.add_event("alice", 2);
    a.h.publish_event(SPACE, e2).await.unwrap();
    until("B receives second event", || b.store.count() == 2).await;
    assert_eq!(a.h.status().await.unwrap().outbox, 0);

    // C joins late and backfills through sync.
    a.store.add_event("alice", 3);
    c.h.join_space(SPACE).await.unwrap();
    c.h.dial(vec![a_addr]).await.unwrap();
    until("C backfills", || c.store.count() == 3).await;
    within("C ingest event", async {
        while let Some(e) = c.events.recv().await {
            if matches!(e, NodeEvent::EventsIngested { .. }) {
                return;
            }
        }
    })
    .await;

    // Blob: 2.5 chunks from A to C, verified per chunk.
    let data: Vec<u8> = (0..CHUNK * 2 + CHUNK / 2)
        .map(|i| (i % 251) as u8)
        .collect();
    let id = a.store.add_blob(&data, false);
    a.h.announce_blob(SPACE, id).await.unwrap();
    within("blob fetch", c.h.request_blob(id)).await.unwrap();
    assert_eq!(c.store.read_blob(&id).unwrap(), data);

    // Ephemeral message reaches B, never the store.
    let mut b = b;
    a.h.send_ephemeral(SPACE, "typing", vec![1]).await.unwrap();
    within("ephemeral", async {
        while let Some(e) = b.events.recv().await {
            if let NodeEvent::Ephemeral { kind, .. } = e {
                assert_eq!(kind, "typing");
                return;
            }
        }
    })
    .await;
    for p in [&a, &b, &c] {
        p.h.shutdown().await;
    }
}

/// A seek asks for the tail chunk of a blob the requester knows nothing about: that chunk
/// (and the manifest) arrives well before the rest, and the rest still completes after.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn chunk_span_resolves_before_whole_blob() {
    let a = spawn(test_cfg()).await;
    let c = spawn(test_cfg()).await;
    let data: Vec<u8> = (0..CHUNK * TAIL_TEST_CHUNKS)
        .map(|i| (i % 251) as u8)
        .collect();
    let id = a.store.add_blob(&data, false);
    c.h.dial(vec![first_addr(&a.h).await]).await.unwrap();

    let last = TAIL_TEST_CHUNKS as u32 - 1;
    // `u32::MAX` also proves an oversized span is clamped to the manifest.
    within("tail chunk", c.h.request_blob_chunks(id, last, u32::MAX))
        .await
        .unwrap();
    let missing = c.store.blob_missing(&id);
    assert!(!missing.contains(&last), "the requested chunk is stored");
    assert!(
        missing.len() > TAIL_TEST_CHUNKS / 2,
        "most of the blob is still on its way: {} missing",
        missing.len()
    );
    assert!(!c.store.blob_has(&id));

    until("background completion", || c.store.blob_has(&id)).await;
    assert_eq!(c.store.read_blob(&id).unwrap(), data);
    // Already complete: a later span request resolves at once.
    within("complete", c.h.request_blob_chunks(id, 0, 0))
        .await
        .unwrap();
    for p in [&a, &c] {
        p.h.shutdown().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn corrupt_chunk_is_rejected() {
    let a = spawn(test_cfg()).await;
    let c = spawn(test_cfg()).await;
    let data = vec![7u8; CHUNK * 3];
    let id = a.store.add_blob(&data, true);
    c.h.dial(vec![first_addr(&a.h).await]).await.unwrap();
    let err = within("blob fetch", c.h.request_blob(id))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("no reachable peer"), "{err}");
    assert!(!c.store.blob_has(&id));
}

async fn relay_setup(circuits: u32) -> (Peer, Peer, Multiaddr) {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("hermod_node=debug,libp2p_relay=debug,libp2p_swarm=debug")
        .with_test_writer()
        .try_init();
    let relay_cfg = NodeConfig {
        relay_mode: RelayMode::Always,
        limits: Limits {
            relay_circuits: circuits,
            ..Limits::default()
        },
        ..test_cfg()
    };
    let a = spawn(relay_cfg).await;
    let relay_addr = first_addr(&a.h).await;
    let b = spawn(NodeConfig {
        relays: vec![relay_addr],
        reserve_always: true,
        ..test_cfg()
    })
    .await;
    let circuit = within("relay reservation", async {
        loop {
            let s = b.h.status().await.unwrap();
            if let Some(x) = s.relay_listen.first() {
                return x.clone();
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    // B advertises the circuit address for invites.
    let advertised = b.h.local_addrs().await.unwrap();
    assert!(
        advertised
            .iter()
            .any(|a| a.to_string().contains("p2p-circuit")),
        "{advertised:?} vs {circuit}"
    );
    let dial_addr = advertised
        .into_iter()
        .find(|a| a.to_string().contains("p2p-circuit"))
        .unwrap();
    (a, b, dial_addr)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reach_peer_behind_relay() {
    let (a, mut b, circuit) = relay_setup(8).await;
    let c = spawn(test_cfg()).await;
    b.h.join_space(SPACE).await.unwrap();
    c.h.join_space(SPACE).await.unwrap();
    let reached = c.h.dial(vec![circuit]).await.unwrap();
    assert_eq!(reached, b.h.peer_id());
    assert_eq!(a.h.status().await.unwrap().relaying_circuits, 1);
    c.h.send_signal(SPACE, Some(b.h.peer_id()), b"offer".to_vec())
        .await
        .unwrap();
    within("signal over circuit", async {
        while let Some(e) = b.events.recv().await {
            if let NodeEvent::Signal { payload, from, .. } = e {
                assert_eq!(payload, b"offer");
                assert_eq!(from, c.h.peer_id());
                return;
            }
        }
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn governor_enforces_circuit_limit() {
    let (a, _b, circuit) = relay_setup(1).await;
    let c1 = spawn(test_cfg()).await;
    let c2 = spawn(test_cfg()).await;
    c1.h.dial(vec![circuit.clone()]).await.unwrap();
    assert_eq!(a.h.status().await.unwrap().relaying_circuits, 1);
    let err = c2.h.dial(vec![circuit]).await.unwrap_err();
    assert!(matches!(err, hermod_node::NodeError::Dial(_)), "{err}");

    // Pausing relaying turns the server off at runtime.
    a.h.set_limits(Limits {
        relay_paused: true,
        ..Limits::default()
    })
    .await
    .unwrap();
    assert!(!a.h.status().await.unwrap().relay_serving);
}

#[test]
fn limits_clamp_to_ceilings() {
    let l = Limits {
        relay_circuits: 999,
        relay_bandwidth_bps: u64::MAX,
        max_connections: 10_000,
        ..Limits::default()
    }
    .clamped();
    assert_eq!(l.relay_circuits, 32);
    assert_eq!(l.relay_bandwidth_bps, 2 * 1024 * 1024);
    assert_eq!(l.max_connections, 256);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn backfill_pages_through_the_sync_limit() {
    let a = spawn(test_cfg()).await;
    let c = spawn(test_cfg()).await;
    let n = hermod_node::proto::SYNC_PAGE_EVENTS as u64 * 2 + 5;
    for seq in 1..=n {
        a.store.add_event("alice", seq);
    }
    a.h.join_space(SPACE).await.unwrap();
    c.h.join_space(SPACE).await.unwrap();
    c.h.dial(vec![first_addr(&a.h).await]).await.unwrap();
    until("C pulls every page", || c.store.count() == n as usize).await;
    for p in [&a, &c] {
        p.h.shutdown().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn signal_flood_is_rate_limited() {
    let a = spawn(test_cfg()).await;
    let mut b = spawn(test_cfg()).await;
    a.h.join_space(SPACE).await.unwrap();
    b.h.join_space(SPACE).await.unwrap();
    let b_id = b.h.peer_id();
    b.h.dial(vec![first_addr(&a.h).await]).await.unwrap();
    // Signals are dropped until B has seen A subscribe, so probe until one gets through.
    within("first signal", async {
        loop {
            a.h.send_signal(SPACE, Some(b_id), vec![1]).await.unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
            while let Ok(e) = b.events.try_recv() {
                if matches!(e, NodeEvent::Signal { .. }) {
                    return;
                }
            }
        }
    })
    .await;
    let burst = hermod_node::proto::SIGNAL_IN_RATE.1 as usize;
    for _ in 0..burst * 4 {
        a.h.send_signal(SPACE, Some(b_id), vec![1]).await.unwrap();
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    let mut got = 0;
    while let Ok(e) = b.events.try_recv() {
        got += matches!(e, NodeEvent::Signal { .. }) as usize;
    }
    assert!(got > 0 && got <= burst + 10, "got {got} signals");
    for p in [&a, &b] {
        p.h.shutdown().await;
    }
}

async fn status_until(what: &str, h: &NodeHandle, cond: impl Fn(&NodeStatus) -> bool) {
    within(what, async {
        while !cond(&h.status().await.unwrap()) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
}

/// G-010: an event queued while offline raises the sync indicator and clears once it is delivered.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn offline_outbox_counts_as_sync_pending() {
    let mut a = spawn(test_cfg()).await;
    let b = spawn(test_cfg()).await;
    a.h.join_space(SPACE).await.unwrap();
    b.h.join_space(SPACE).await.unwrap();
    let e1 = a.store.add_event("alice", 1);
    a.h.publish_event(SPACE, e1).await.unwrap();
    within("pending raised while offline", async {
        while let Some(e) = a.events.recv().await {
            if matches!(e, NodeEvent::SyncPending { count: 1 }) {
                return;
            }
        }
    })
    .await;
    b.h.dial(vec![first_addr(&a.h).await]).await.unwrap();
    until("B receives the queued event", || b.store.count() == 1).await;
    within("pending cleared after delivery", async {
        while let Some(e) = a.events.recv().await {
            if matches!(e, NodeEvent::SyncPending { count: 0 }) {
                return;
            }
        }
    })
    .await;
    assert_eq!(a.h.status().await.unwrap().outbox, 0);
    for p in [&a, &b] {
        p.h.shutdown().await;
    }
}

/// E-010 + E-012: a peer whose gossip keeps being rejected is struck, disconnected, refused on
/// redial, and stays refused after the node restarts with the same peer book. Honest peers stay.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn flooding_peer_is_banned_and_stays_banned() {
    let dir = std::env::temp_dir().join(format!("hermod-ban-{}", std::process::id()));
    let book = dir.join("peers.json");
    let cfg_a = || NodeConfig {
        peer_book: Arc::new(FilePeerBook::open(&book).unwrap()),
        ..test_cfg()
    };
    let a_key = new_key();
    let a = spawn_keyed(cfg_a(), a_key).await;
    let b = spawn(test_cfg()).await;
    let c = spawn(test_cfg()).await;
    for p in [&a, &b, &c] {
        p.h.join_space(SPACE).await.unwrap();
    }
    let a_addr = first_addr(&a.h).await;
    b.h.dial(vec![a_addr.clone()]).await.unwrap();
    c.h.dial(vec![a_addr.clone()]).await.unwrap();
    status_until("A sees both peers", &a.h, |s| s.peers == 2).await;

    let honest = c.store.add_event("carol", 1);
    c.h.publish_event(SPACE, honest).await.unwrap();
    for seq in 1..=hermod_node::proto::STRIKE_LIMIT as u64 + 10 {
        b.h.publish_event(SPACE, ev(FLOODER, seq)).await.unwrap();
    }
    status_until("flooder banned and dropped", &a.h, |s| {
        s.banned == 1 && s.peers == 1
    })
    .await;
    until("honest peer unaffected", || a.store.count() == 1).await;

    // Redial: the ban is enforced before the connection is established.
    // The dial either fails outright or is closed by A at once: B ends with no peers (it had
    // one while the dial was in flight) and A never counts the connection.
    let _ = b.h.dial(vec![a_addr]).await;
    status_until("B refused by A", &b.h, |s| s.peers == 0).await;
    let s = a.h.status().await.unwrap();
    assert_eq!((s.peers, s.banned), (1, 1));

    // Restart A with the same identity and peer book: the ban survives.
    // C goes away too, so any connection A2 ends up with could only be the banned B.
    a.h.shutdown().await;
    c.h.shutdown().await;
    let a2 = spawn_keyed(cfg_a(), a_key).await;
    assert_eq!(a2.h.status().await.unwrap().banned, 1);
    let _ = b.h.dial(vec![first_addr(&a2.h).await]).await;
    status_until("B refused by restarted A", &b.h, |s| s.peers == 0).await;
    let s = a2.h.status().await.unwrap();
    assert_eq!((s.peers, s.banned), (0, 1));
    for p in [&a2, &b] {
        p.h.shutdown().await;
    }
    let _ = std::fs::remove_dir_all(dir);
}

/// Three nodes in a line (A - M - C), all in the space. Returns them once gossip crosses it.
async fn line_of_three() -> (Peer, Peer, Peer) {
    let a = spawn(test_cfg()).await;
    let m = spawn(test_cfg()).await;
    let c = spawn(test_cfg()).await;
    for p in [&a, &m, &c] {
        p.h.join_space(SPACE).await.unwrap();
    }
    let m_addr = first_addr(&m.h).await;
    a.h.dial(vec![m_addr.clone()]).await.unwrap();
    c.h.dial(vec![m_addr]).await.unwrap();
    status_until("middle sees both", &m.h, |s| s.peers == 2).await;
    // The mesh needs a heartbeat or two: an honest event from C must reach A through M.
    let probe = c.store.add_event("carol", 1);
    c.h.publish_event(SPACE, probe).await.unwrap();
    until("honest event crosses the line", || a.store.count() == 1).await;
    (a, m, c)
}

/// Rotating the (unauthenticated) author header buys no extra budget: every rejected message
/// strikes the relaying peer, which is banned, and the honest middle node never forwards the
/// rejected events to its other neighbour.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rotating_author_flood_is_banned_and_not_forwarded() {
    let (flooder, middle, far) = line_of_three().await;
    for seq in 1..=hermod_node::proto::STRIKE_LIMIT as u64 + 20 {
        let author = format!("{FLOODER}-{seq}");
        flooder
            .h
            .publish_event(SPACE, ev(&author, 1))
            .await
            .unwrap();
    }
    status_until("flooder banned by the middle node", &middle.h, |s| {
        s.banned == 1 && s.peers == 1
    })
    .await;
    assert_eq!(far.store.count(), 1, "rejected events were not forwarded");
    assert_eq!(far.h.status().await.unwrap().banned, 0);
    for p in [&flooder, &middle, &far] {
        p.h.shutdown().await;
    }
}

/// A signal from a peer that is not our gossip neighbour (it passed gossipsub signing) is
/// delivered at the far end of a line.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn signal_from_a_non_neighbour_reaches_the_far_end() {
    let (a, m, mut c) = line_of_three().await;
    let (a_id, c_id) = (a.h.peer_id(), c.h.peer_id());
    within("signal across the line", async {
        loop {
            a.h.send_signal(SPACE, Some(c_id), b"offer".to_vec())
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
            while let Ok(e) = c.events.try_recv() {
                if let NodeEvent::Signal { from, payload, .. } = e {
                    assert_eq!((from, payload), (a_id, b"offer".to_vec()));
                    return;
                }
            }
        }
    })
    .await;
    for p in [&a, &m, &c] {
        p.h.shutdown().await;
    }
}

/// Events larger than a page's byte budget still backfill completely, page by page.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn backfill_respects_the_page_byte_budget() {
    let a = spawn(test_cfg()).await;
    let c = spawn(test_cfg()).await;
    // Maximum-size events (1 MiB): a page holds four, so seven need two pages.
    let size = hermod_node::proto::MAX_GOSSIP_EVENT - 4096;
    let n = 7u64;
    for seq in 1..=n {
        a.store.add_big_event("alice", seq, size);
    }
    a.h.join_space(SPACE).await.unwrap();
    c.h.join_space(SPACE).await.unwrap();
    c.h.dial(vec![first_addr(&a.h).await]).await.unwrap();
    until("C pulls every byte-bounded page", || {
        c.store.count() == n as usize
    })
    .await;
    for p in [&a, &c] {
        p.h.shutdown().await;
    }
}

/// A peer that connects before it has joined the space is not struck for the early sync
/// traffic: it joins, backfills, and nobody is banned.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dial_before_join_syncs_without_strikes() {
    let a = spawn(test_cfg()).await;
    let c = spawn(test_cfg()).await;
    for seq in 1..=3 {
        a.store.add_event("alice", seq);
    }
    a.h.join_space(SPACE).await.unwrap();
    c.h.dial(vec![first_addr(&a.h).await]).await.unwrap();
    status_until("A sees C", &a.h, |s| s.peers == 1).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    c.h.join_space(SPACE).await.unwrap();
    until("C backfills after joining", || c.store.count() == 3).await;
    assert_eq!(a.h.status().await.unwrap().banned, 0);
    assert_eq!(c.h.status().await.unwrap().banned, 0);
    for p in [&a, &c] {
        p.h.shutdown().await;
    }
}
