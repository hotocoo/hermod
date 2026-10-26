//! D-003: the recovery phrase shows only on an explicit confirm, restores the same identity on a
//! fresh install, refuses bad or foreign-checksum phrases, and never leaks into an error.

use std::sync::Arc;

use hermodr_lib::api;
use hermodr_lib::ctx::{Ctx, Options};
use serde_json::{Value, json};

async fn open(dir: &std::path::Path) -> Arc<Ctx> {
    Ctx::open(dir.to_path_buf(), Options::localhost(None, vec![]), None)
        .await
        .unwrap()
}

async fn call(c: &Arc<Ctx>, name: &str, args: Value) -> Result<Value, String> {
    api::handle(c, name, args).await
}

async fn phrase_of(c: &Arc<Ctx>) -> String {
    call(c, "identity_phrase", json!({"confirm": true}))
        .await
        .unwrap()
        .as_str()
        .unwrap()
        .to_string()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn phrase_needs_confirm_and_restores_the_same_identity() {
    let a = tempfile::tempdir().unwrap();
    let ca = open(a.path()).await;
    for args in [
        json!({}),
        json!({"confirm": false}),
        json!({"confirm": "yes"}),
    ] {
        let err = call(&ca, "identity_phrase", args).await.unwrap_err();
        assert!(err.contains("confirm"), "{err}");
    }
    let phrase = phrase_of(&ca).await;
    assert_eq!(phrase.split_whitespace().count(), 24);
    let id = call(&ca, "identity_get", json!({})).await.unwrap();

    let b = tempfile::tempdir().unwrap();
    let cb = open(b.path()).await;
    let other = call(&cb, "identity_get", json!({})).await.unwrap();
    assert_ne!(other["user_id"], id["user_id"]);
    call(&cb, "identity_restore_phrase", json!({"phrase": phrase}))
        .await
        .unwrap();
    let back = call(&cb, "identity_get", json!({})).await.unwrap();
    assert_eq!(
        back["user_id"], id["user_id"],
        "same identity after restore"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bad_phrase_is_refused_without_echo_and_keeps_the_identity() {
    let src = tempfile::tempdir().unwrap();
    let phrase = phrase_of(&open(src.path()).await).await;
    let mut words: Vec<&str> = phrase.split_whitespace().collect();
    let (i, j) = (0..words.len())
        .flat_map(|i| (i + 1..words.len()).map(move |j| (i, j)))
        .find(|&(i, j)| words[i] != words[j])
        .unwrap();
    words.swap(i, j);
    let bad = words.join(" ");

    let dir = tempfile::tempdir().unwrap();
    let c = open(dir.path()).await;
    let before = call(&c, "identity_get", json!({})).await.unwrap();
    let err = call(&c, "identity_restore_phrase", json!({"phrase": bad}))
        .await
        .unwrap_err();
    assert!(err.contains("checksum"), "{err}");
    // Single words can occur in the message text by chance; an adjacent pair cannot.
    for pair in words.windows(2) {
        assert!(!err.contains(&pair.join(" ")), "error leaked words: {err}");
    }
    let after = call(&c, "identity_get", json!({})).await.unwrap();
    assert_eq!(
        before["user_id"], after["user_id"],
        "a refusal changes nothing"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restore_refuses_a_dir_with_data_until_start_over() {
    let src = tempfile::tempdir().unwrap();
    let phrase = phrase_of(&open(src.path()).await).await;

    let dir = tempfile::tempdir().unwrap();
    let c = open(dir.path()).await;
    call(&c, "profile_set", json!({"name": "Ada", "bio": ""}))
        .await
        .unwrap();
    let err = call(&c, "identity_restore_phrase", json!({"phrase": phrase}))
        .await
        .unwrap_err();
    assert!(err.contains("start over"), "{err}");

    call(&c, "app_reset", json!({})).await.unwrap();
    call(&c, "identity_restore_phrase", json!({"phrase": phrase}))
        .await
        .unwrap();
    assert_eq!(
        call(&c, "identity_get", json!({})).await.unwrap()["user_id"],
        call(&open(src.path()).await, "identity_get", json!({}))
            .await
            .unwrap()["user_id"]
    );
}
