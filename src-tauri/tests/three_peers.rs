//! Three full runtimes (real Core, real Node, localhost): sync, late-joiner backfill, blob
//! fetch, a relayed circuit through the third node, and removal with rekey, after which no
//! new content reaches the removed peer in readable form.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use hermod_node::config::{NodeConfig, RelayMode};
use hermod_node::{Multiaddr, NodeHandle};
use hermodr_lib::ctx::{Ctx, NodeTweak, Options};
use hermodr_lib::{api, blob};
use serde_json::{Value, json};

/// Poll interval while waiting for something to arrive over the network.
const POLL: Duration = Duration::from_millis(150);
/// Upper bound for anything the network must deliver.
const DEADLINE: Duration = Duration::from_secs(30);
/// How long the removed peer is given to (wrongly) receive readable content: several gossip
/// heartbeats and a full sync round after its node restarts.
const QUIET: Duration = Duration::from_secs(5);
/// Posts made after C's removal (one by A, one by B), each sealed under the new epoch.
const LOCKED_AFTER_REMOVAL: u64 = 2;
/// Size of the attachment C fetches from A.
const BLOB_BYTES: u32 = 300_000;
/// Peers C holds while the circuit is up: A directly and B through A. Only three nodes
/// exist, so this count means C is connected to B, and B listens on nothing.
const C_PEERS_WITH_CIRCUIT: u32 = 2;

async fn within<F: Future>(what: &str, f: F) -> F::Output {
    tokio::time::timeout(DEADLINE, f)
        .await
        .unwrap_or_else(|_| panic!("timed out: {what}"))
}

/// Localhost runtime; `extra` adjusts its node config after the localhost defaults.
async fn peer(
    dir: &std::path::Path,
    extra: impl Fn(&mut NodeConfig) + Send + Sync + 'static,
) -> Arc<Ctx> {
    let mut opts = Options::localhost(None, vec![]);
    let base = opts
        .node_tweak
        .take()
        .expect("localhost options tweak the node");
    let tweak: NodeTweak = Arc::new(move |c| {
        base(c);
        extra(c);
    });
    opts.node_tweak = Some(tweak);
    let ctx = Ctx::open(dir.to_path_buf(), opts, None).await.unwrap();
    call(
        &ctx,
        "legal_accept",
        json!({"version": "1", "shareResources": true}),
    )
    .await;
    ctx
}

async fn call(c: &Arc<Ctx>, name: &str, args: Value) -> Value {
    api::handle(c, name, args)
        .await
        .unwrap_or_else(|e| panic!("{name}: {e}"))
}

async fn snapshot_has(c: &Arc<Ctx>, text: &str) -> bool {
    call(c, "snapshot", json!({}))
        .await
        .to_string()
        .contains(text)
}

async fn until_text(c: &Arc<Ctx>, text: &str, what: &str) {
    within(what, async {
        while !snapshot_has(c, text).await {
            tokio::time::sleep(POLL).await;
        }
    })
    .await
}

async fn post(c: &Arc<Ctx>, space: &str, msg_id: &str, text: &str, attachments: Value) {
    call(
        c,
        "event_append",
        json!({"spaceId": space, "body": {
        "t": "message.post", "channel_id": "general", "msg_id": msg_id, "text": text,
        "attachments": attachments}}),
    )
    .await;
}

async fn join(host: &Arc<Ctx>, guest: &Arc<Ctx>, space: &str) {
    let inv = call(host, "invite_create", json!({"spaceId": space})).await;
    let joined = call(guest, "invite_accept", json!({"code": inv["code"]})).await;
    assert_eq!(joined["space_id"], space);
}

async fn user_id(c: &Arc<Ctx>) -> Value {
    call(c, "identity_get", json!({})).await["user_id"].clone()
}

/// Whether the snapshot marks `space` as one this peer was removed from.
async fn removed_from(c: &Arc<Ctx>, space: &str) -> bool {
    let snap = call(c, "snapshot", json!({})).await;
    let mut found = false;
    walk(&snap, &mut |v| {
        found |= v.get("removed") == Some(&Value::Bool(true)) && v.to_string().contains(space);
    });
    found
}

/// Whether C is still linked to B through the circuit A relays.
async fn circuit_up(a: &NodeHandle, c: &NodeHandle) -> bool {
    a.status().await.unwrap().relaying_circuits >= 1
        && c.status().await.unwrap().peers >= C_PEERS_WITH_CIRCUIT
}

fn walk(v: &Value, f: &mut impl FnMut(&Value)) {
    f(v);
    match v {
        Value::Array(xs) => xs.iter().for_each(|x| walk(x, f)),
        Value::Object(m) => m.values().for_each(|x| walk(x, f)),
        _ => {}
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sync_backfill_blob_relay_and_removal() {
    let (da, db, dc) = (
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
    );
    // A serves relay circuits. B and C listen on nothing (B holds a reservation on A), so
    // neither can dial the other directly: their only link is a circuit through A.
    let a = peer(da.path(), |c| c.relay_mode = RelayMode::Always).await;
    let a_node = a.node().await.expect("A's node runs");
    let a_addr: Multiaddr = within("A listen addr", async {
        loop {
            if let Some(x) = a_node.local_addrs().await.unwrap().into_iter().next() {
                return x;
            }
            tokio::time::sleep(POLL).await;
        }
    })
    .await;
    let b = peer(db.path(), move |c| {
        c.listen.clear();
        c.relays = vec![a_addr.clone()];
        c.reserve_always = true;
    })
    .await;

    // Sync: B joins and posts, A reads it; A posts back, B reads it.
    let sp = call(
        &a,
        "space_create",
        json!({"name": "Trio", "tagline": "t", "kind": "Team"}),
    )
    .await;
    let space = sp["space_id"].as_str().unwrap().to_string();
    join(&a, &b, &space).await;
    post(&b, &space, "b1", "hello from B", json!([])).await;
    until_text(&a, "hello from B", "B's message reaches A").await;
    post(&a, &space, "a1", "hello from A", json!([])).await;
    until_text(&b, "hello from A", "A's message reaches B").await;

    // An attachment on A, posted before C exists.
    let data: Vec<u8> = (0..BLOB_BYTES).map(|i| (i % 251) as u8).collect();
    let r = call(
        &a,
        "blob_put_bytes",
        json!({"name": "clip.bin", "bytes": data}),
    )
    .await;
    let hash = r["hash"].as_str().unwrap().to_string();
    post(&a, &space, "a2", "attached", json!([r])).await;

    // Late joiner: C backfills everything posted before it existed, then fetches the blob.
    let c = peer(dc.path(), |c| c.listen.clear()).await;
    join(&a, &c, &space).await;
    until_text(&c, "hello from B", "C backfills B's message").await;
    until_text(&c, "hello from A", "C backfills A's message").await;
    until_text(&c, "\"a2\"", "C backfills the attachment post").await;
    let got = within("C fetches the blob", async {
        loop {
            let resp = blob::serve(&c, &hash, None).await;
            if resp.status == 200 {
                return resp;
            }
            tokio::time::sleep(POLL).await;
        }
    })
    .await;
    assert_eq!(got.body, data);

    // Relay: C reaches B only through A's circuit, and a signal crosses it.
    let b_node = b.node().await.expect("B's node runs");
    let circuit = within("B's relay reservation", async {
        loop {
            let found = b_node
                .local_addrs()
                .await
                .unwrap()
                .into_iter()
                .find(|x| x.to_string().contains("p2p-circuit"));
            if let Some(x) = found {
                return x;
            }
            tokio::time::sleep(POLL).await;
        }
    })
    .await;
    let c_node = c.node().await.expect("C's node runs");
    let reached = within("dial over the circuit", c_node.dial(vec![circuit]))
        .await
        .unwrap();
    assert_eq!(reached, b_node.peer_id());
    // The node sends a signal as a direct request only while connected to the target, else
    // over gossip (which A would forward); bracket the send so only the circuit can carry it.
    assert!(
        circuit_up(&a_node, &c_node).await,
        "circuit up before the signal"
    );
    let mut b_events = b.subscribe();
    call(
        &c,
        "media_signal",
        json!({"spaceId": space, "to": user_id(&b).await, "payload": {"sdp": "offer"}}),
    )
    .await;
    within("signal reaches B", async {
        loop {
            let e = b_events.recv().await.unwrap();
            if e.name.ends_with("signal") {
                assert_eq!(e.payload["payload"]["sdp"], "offer");
                return;
            }
        }
    })
    .await;
    assert!(
        circuit_up(&a_node, &c_node).await,
        "circuit up after the signal"
    );

    // Removal: A removes C (with a rekey); new posts reach B readable, never C.
    call(
        &a,
        "member_remove",
        json!({"spaceId": space, "user": user_id(&c).await}),
    )
    .await;
    within("C learns it was removed", async {
        while !removed_from(&c, &space).await {
            tokio::time::sleep(POLL).await;
        }
    })
    .await;
    post(&a, &space, "a3", "secret from A after removal", json!([])).await;
    // B seals with the newest key it holds; reading a3 proves it applied the rekey first.
    until_text(
        &b,
        "secret from A after removal",
        "A's new-epoch post reaches B",
    )
    .await;
    post(&b, &space, "b2", "secret from B after removal", json!([])).await;
    until_text(
        &a,
        "secret from B after removal",
        "B's new-epoch post reaches A",
    )
    .await;
    // Both new-epoch posts do reach C, but only as ciphertext it holds no key for.
    let c_core = c.live().await.unwrap().core.clone();
    let c_space = c_core.resolve_space(&space).unwrap();
    within("C holds the new posts locked", async {
        while c_core.pending(&c_space).unwrap().1 < LOCKED_AFTER_REMOVAL {
            tokio::time::sleep(POLL).await;
        }
    })
    .await;
    // A restart makes C sync from scratch with whoever it reaches; still nothing readable.
    c.stop_node().await;
    c.start_node().await.unwrap();
    tokio::time::sleep(QUIET).await;
    assert!(!snapshot_has(&c, "secret from A after removal").await);
    assert!(!snapshot_has(&c, "secret from B after removal").await);
    assert!(
        snapshot_has(&c, "hello from B").await,
        "history from before the removal stays readable"
    );

    for x in [&a, &b, &c] {
        x.shutdown().await;
    }
}
