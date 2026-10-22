//! G-004 / W-010: an OS-opened `hermod://join/<code>` link reaches the UI as an event, and a
//! link that arrives before the UI listens (cold start) is handed out once at boot.

use std::sync::Arc;

use hermodr_lib::api;
use hermodr_lib::ctx::{Ctx, Options};
use serde_json::{Value, json};

async fn open(dir: &std::path::Path) -> Arc<Ctx> {
    Ctx::open(dir.to_path_buf(), Options::localhost(None, vec![]), None)
        .await
        .unwrap()
}

async fn pending(c: &Arc<Ctx>) -> Value {
    api::handle(c, "deeplink_pending", json!({})).await.unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cold_start_link_is_kept_once_and_later_links_are_only_events() {
    let dir = tempfile::tempdir().unwrap();
    let c = open(dir.path()).await;
    let mut rx = c.subscribe();

    assert!(!c.open_link("https://example.com/join/abc"));
    assert!(!c.open_link("hermod://join/"));
    assert!(c.open_link("hermod://join/3mJr7AoU/"));
    let ev = rx.recv().await.unwrap();
    assert_eq!(ev.name, "hermod://deeplink");
    assert_eq!(ev.payload, json!({ "code": "3mJr7AoU" }));

    assert_eq!(
        pending(&c).await,
        json!("3mJr7AoU"),
        "boot reads the cold-start link"
    );
    assert_eq!(pending(&c).await, Value::Null, "and only once");

    assert!(c.open_link("hermod://join/Second1"));
    assert_eq!(
        rx.recv().await.unwrap().payload,
        json!({ "code": "Second1" }),
        "a running app gets the event"
    );
    assert_eq!(
        pending(&c).await,
        Value::Null,
        "a link after boot is not replayed on a reload"
    );
}
