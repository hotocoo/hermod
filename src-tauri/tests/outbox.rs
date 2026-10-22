//! G-010: events authored while the node is not running still count as "waiting to sync", and
//! the count survives a restart of the app.

use hermodr_lib::api;
use hermodr_lib::ctx::{Ctx, Options};
use serde_json::{Value, json};

async fn open(dir: &std::path::Path) -> std::sync::Arc<Ctx> {
    // Terms not accepted: no node starts, so nothing can be gossiped.
    Ctx::open(dir.to_path_buf(), Options::localhost(None, vec![]), None)
        .await
        .unwrap()
}

async fn call(c: &std::sync::Arc<Ctx>, name: &str, args: Value) -> Value {
    api::handle(c, name, args)
        .await
        .unwrap_or_else(|e| panic!("{name}: {e}"))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn events_authored_without_a_node_are_pending_and_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let c = open(dir.path()).await;
    assert_eq!(call(&c, "outbox_status", json!({})).await["pending"], 0);
    let sp = call(
        &c,
        "space_create",
        json!({"name": "Offline", "tagline": "t", "kind": "Team"}),
    )
    .await;
    let space = sp["space_id"].as_str().unwrap().to_string();
    let before = call(&c, "outbox_status", json!({})).await["pending"]
        .as_u64()
        .unwrap();
    call(&c, "event_append", json!({"spaceId": space, "body": {
        "t": "message.post", "channel_id": "general", "msg_id": "m1", "text": "while away", "attachments": []}})).await;
    let after = call(&c, "outbox_status", json!({})).await["pending"]
        .as_u64()
        .unwrap();
    assert_eq!(after, before + 1, "the offline post is counted");
    drop(c);

    let again = open(dir.path()).await;
    assert_eq!(
        call(&again, "outbox_status", json!({})).await["pending"],
        after,
        "still pending after a restart"
    );
}
