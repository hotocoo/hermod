//! A due scheduled message is appended by the scheduler even when the node never started
//! (Terms not accepted), and counts as waiting to sync.

use std::time::Duration;

use hermodr_lib::api;
use hermodr_lib::ctx::{Ctx, Options};
use serde_json::{Value, json};

const DUE_IN_MS: i64 = 700;
const WAIT: Duration = Duration::from_secs(15);

async fn call(c: &std::sync::Arc<Ctx>, name: &str, args: Value) -> Value {
    api::handle(c, name, args)
        .await
        .unwrap_or_else(|e| panic!("{name}: {e}"))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn due_scheduled_message_is_appended_without_a_node() {
    let dir = tempfile::tempdir().unwrap();
    let c = Ctx::open(
        dir.path().to_path_buf(),
        Options::localhost(None, vec![]),
        None,
    )
    .await
    .unwrap();
    let sp = call(
        &c,
        "space_create",
        json!({"name": "Later", "tagline": "t", "kind": "Team"}),
    )
    .await;
    let space = sp["space_id"].as_str().unwrap().to_string();
    let before = call(&c, "outbox_status", json!({})).await["pending"]
        .as_u64()
        .unwrap();
    let at = hermod_core::api::now_ms() + DUE_IN_MS;
    call(&c, "schedule_add", json!({"spaceId": space, "at": at, "body": {
        "t": "message.post", "channel_id": "general", "msg_id": "s1", "text": "sent by the clock", "attachments": []}})).await;
    let start = std::time::Instant::now();
    loop {
        let snap = call(&c, "snapshot", json!({})).await.to_string();
        if snap.contains("sent by the clock") {
            break;
        }
        assert!(start.elapsed() < WAIT, "scheduled message never appended");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let after = call(&c, "outbox_status", json!({})).await["pending"]
        .as_u64()
        .unwrap();
    assert!(after > before, "published without a node counts as unsent");
}
