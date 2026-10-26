//! E-013: passphrase-protecting the identity key, the locked start, and unlocking. The keychain
//! mode is covered in hermod-core against an in-memory store; no test here touches a real keychain.

use hermodr_lib::api;
use hermodr_lib::ctx::{Ctx, Options};
use serde_json::{Value, json};

const PASS: &str = "correct horse battery";
const LOCKED: &str = "identity locked";

async fn open(dir: &std::path::Path) -> std::sync::Arc<Ctx> {
    Ctx::open(dir.to_path_buf(), Options::localhost(None, vec![]), None)
        .await
        .unwrap()
}

async fn call(c: &std::sync::Arc<Ctx>, name: &str, args: Value) -> Result<Value, String> {
    api::handle(c, name, args).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn passphrase_key_starts_locked_and_unlocks_to_the_same_identity() {
    let dir = tempfile::tempdir().unwrap();
    let c = open(dir.path()).await;
    let me = call(&c, "identity_get", json!({})).await.unwrap();
    assert_eq!(me["key_mode"], "file");

    let short = call(
        &c,
        "identity_protect",
        json!({"mode": "passphrase", "passphrase": "short"}),
    )
    .await;
    assert!(short.is_err(), "too short a passphrase is refused");
    assert_eq!(
        call(&c, "identity_get", json!({})).await.unwrap()["key_mode"],
        "file",
        "a refused change leaves the key as it was"
    );

    let done = call(
        &c,
        "identity_protect",
        json!({"mode": "passphrase", "passphrase": PASS}),
    )
    .await
    .unwrap();
    assert_eq!(done["key_mode"], "passphrase");
    drop(c);

    let c = open(dir.path()).await;
    assert_eq!(
        call(&c, "identity_get", json!({})).await.unwrap_err(),
        LOCKED
    );
    assert!(
        call(
            &c,
            "identity_unlock",
            json!({"passphrase": "wrong passphrase"})
        )
        .await
        .is_err()
    );
    assert_eq!(
        call(&c, "identity_get", json!({})).await.unwrap_err(),
        LOCKED,
        "a wrong passphrase leaves it locked"
    );
    call(&c, "identity_unlock", json!({"passphrase": PASS}))
        .await
        .unwrap();
    let back = call(&c, "identity_get", json!({})).await.unwrap();
    assert_eq!(back["user_id"], me["user_id"]);

    let off = call(&c, "identity_protect", json!({"mode": "file"}))
        .await
        .unwrap();
    assert_eq!(off["key_mode"], "file");
    drop(c);
    let c = open(dir.path()).await;
    assert_eq!(
        call(&c, "identity_get", json!({})).await.unwrap()["user_id"],
        me["user_id"]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn keychain_is_refused_where_none_is_offered() {
    let dir = tempfile::tempdir().unwrap();
    let c = open(dir.path()).await;
    assert!(
        call(&c, "identity_protect", json!({"mode": "keychain"}))
            .await
            .is_err()
    );
    assert_eq!(
        call(&c, "identity_get", json!({})).await.unwrap()["key_mode"],
        "file"
    );
}
