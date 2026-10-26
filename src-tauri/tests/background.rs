//! W-002: the "keep helping the network in background" setting persists across a restart and is
//! what the window close handler reads (`Ctx::background`).

use hermodr_lib::api;
use hermodr_lib::ctx::{Ctx, Options};
use serde_json::json;

async fn open(dir: &std::path::Path) -> std::sync::Arc<Ctx> {
    Ctx::open(dir.to_path_buf(), Options::localhost(None, vec![]), None)
        .await
        .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn background_setting_persists_and_drives_the_close_decision() {
    let dir = tempfile::tempdir().unwrap();
    let c = open(dir.path()).await;
    assert!(!c.background(), "off by default: closing quits");

    let s = api::handle(&c, "node_settings_set", json!({"background": true}))
        .await
        .unwrap();
    assert_eq!(s["values"]["background"], true, "{s}");
    assert!(c.background(), "on: closing hides to the tray");
    drop(c);

    let again = open(dir.path()).await;
    assert!(again.background(), "persisted across a restart");
    api::handle(&again, "node_settings_set", json!({"background": false}))
        .await
        .unwrap();
    assert!(!again.background());
}
