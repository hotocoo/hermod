//! D-008: a damaged database is reported to the UI (its Could-not-start screen), never a crash at
//! startup, and Delete all local data still recovers.

use hermod_core::identity::{Identity, KEY_FILE};
use hermodr_lib::api;
use hermodr_lib::ctx::{Ctx, Options};
use serde_json::json;

const DAMAGED: &[u8] = b"this is definitely not sqlite, just some bytes padding padding padding";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn corrupt_database_is_reported_not_fatal_and_reset_recovers() {
    let dir = tempfile::tempdir().unwrap();
    Identity::generate()
        .save(&dir.path().join(KEY_FILE))
        .unwrap();
    std::fs::write(dir.path().join(hermod_core::api::DB_FILE), DAMAGED).unwrap();

    let c = Ctx::open(
        dir.path().to_path_buf(),
        Options::localhost(None, vec![]),
        None,
    )
    .await
    .expect("a damaged database must not stop the app starting");
    for cmd in ["legal_status", "identity_get"] {
        let err = api::handle(&c, cmd, json!({})).await.unwrap_err();
        assert!(err.starts_with("your data file is damaged"), "{cmd}: {err}");
    }
    assert!(c.node().await.is_none(), "no node on damaged data");

    api::handle(&c, "app_reset", json!({})).await.unwrap();
    let legal = api::handle(&c, "legal_status", json!({})).await.unwrap();
    assert!(
        legal["accepted_version"].is_null(),
        "fresh data after reset"
    );
}
