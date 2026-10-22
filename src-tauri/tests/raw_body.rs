//! Binary uploads arrive as the raw IPC body, with the other arguments in a header.

use hermodr_lib::api::{self, MAX_UPLOAD_BYTES};
use hermodr_lib::ctx::{Ctx, Options};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn raw_body_uploads_store_the_bytes_and_enforce_the_cap() {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Ctx::open(
        dir.path().to_path_buf(),
        Options::localhost(None, vec![]),
        None,
    )
    .await
    .unwrap();
    let data = vec![7u8; 300_000];
    // Non-ASCII names travel as \u escapes (header values are ASCII).
    let meta = r#"{"name":"café 漢.bin"}"#;
    let r = api::handle_raw(&ctx, "blob_put_bytes", Some(meta), data.clone())
        .await
        .unwrap();
    assert_eq!(r["size"], 300_000);
    assert_eq!(r["name"], "café 漢.bin");
    let hash = r["hash"].as_str().unwrap();
    let live = ctx.live().await.unwrap();
    assert_eq!(live.core.blobs().read_all(hash).unwrap(), data);

    let too_big = vec![0u8; MAX_UPLOAD_BYTES + 1];
    let err = api::handle_raw(&ctx, "blob_put_bytes", Some("not json"), too_big)
        .await
        .unwrap_err();
    assert_eq!(
        err, "that file is too large",
        "size is checked before the header is parsed"
    );
    assert!(
        api::handle_raw(&ctx, "blob_put_bytes", Some("not json"), vec![1])
            .await
            .is_err()
    );
    assert!(
        api::handle_raw(&ctx, "identity_get", None, vec![1])
            .await
            .is_err()
    );
    ctx.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn backup_paths_must_come_from_the_picker() {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Ctx::open(dir.path().to_path_buf(), Options::production(None), None)
        .await
        .unwrap();
    let target = dir.path().join("x.hermodbak");
    let args = serde_json::json!({"path": target, "passphrase": "long enough pass"});
    assert!(
        api::handle(&ctx, "backup_export", args.clone())
            .await
            .is_err()
    );
    assert!(!target.exists());
    assert!(api::handle(&ctx, "backup_import", args).await.is_err());
    ctx.shutdown().await;
}
