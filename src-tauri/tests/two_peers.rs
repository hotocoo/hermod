//! Two full runtimes (real Core, real Node, localhost): invite, sync, blobs, backup.

use std::sync::Arc;
use std::time::Duration;

use hermodr_lib::ctx::{Ctx, Options};
use hermodr_lib::{api, blob};
use serde_json::{Value, json};

async fn peer(dir: &std::path::Path) -> Arc<Ctx> {
    let ctx = Ctx::open(dir.to_path_buf(), Options::localhost(None, vec![]), None)
        .await
        .unwrap();
    api::handle(
        &ctx,
        "legal_accept",
        json!({"version": "1", "shareResources": true}),
    )
    .await
    .unwrap();
    ctx
}

async fn call(c: &Arc<Ctx>, name: &str, args: Value) -> Value {
    api::handle(c, name, args)
        .await
        .unwrap_or_else(|e| panic!("{name}: {e}"))
}

async fn has_text(c: &Arc<Ctx>, space: &str, text: &str) -> bool {
    let snap = call(c, "snapshot", json!({})).await;
    snap.pointer(&format!("/collections/messages/{space}/general"))
        .map(|v| v.to_string().contains(text))
        .unwrap_or_else(|| snap.to_string().contains(text))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn invite_sync_blob_and_backup() {
    let (da, db, dc) = (
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
    );
    let a = peer(da.path()).await;
    let b = peer(db.path()).await;
    let fresh = call(&a, "identity_get", json!({})).await;
    assert_eq!(
        fresh["name"], fresh["handle"],
        "a fresh identity shows the profile step"
    );

    let sp = call(
        &a,
        "space_create",
        json!({"name": "Forge", "tagline": "t", "kind": "Team"}),
    )
    .await;
    let space = sp["space_id"].as_str().unwrap().to_string();
    let inv = call(&a, "invite_create", json!({"spaceId": space})).await;
    let code = inv["code"].as_str().unwrap();
    let joined = call(&b, "invite_accept", json!({"code": code})).await;
    assert_eq!(joined["space_id"], space.as_str());

    // B posts, A sees it.
    call(&b, "event_append", json!({"spaceId": space, "body": {
        "t": "message.post", "channel_id": "general", "msg_id": "m1", "text": "hello from B", "attachments": []}})).await;
    let mut seen = false;
    for _ in 0..200 {
        if has_text(&a, &space, "hello from B").await {
            seen = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    assert!(seen, "B's message never reached A");

    // Blob put on A, attached to a message, read through B's blob path.
    let data: Vec<u8> = (0..600_000u32).map(|i| (i % 251) as u8).collect();
    let r = call(
        &a,
        "blob_put_bytes",
        json!({"name": "clip.mp4", "bytes": data}),
    )
    .await;
    let hash = r["hash"].as_str().unwrap().to_string();
    call(&a, "event_append", json!({"spaceId": space, "body": {
        "t": "message.post", "channel_id": "general", "msg_id": "m2", "text": "file", "attachments": [r]}})).await;
    let mut got = None;
    for _ in 0..100 {
        if has_text(&b, &space, "\"m2\"").await {
            break;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    let resp = blob::serve(&b, &hash, Some("bytes=300000-300009")).await;
    if resp.status == 206 {
        got = Some(resp);
    }
    let resp = got.expect("range request through B");
    assert_eq!(resp.body, data[300_000..300_010]);
    assert_eq!(resp.total, 600_000);
    assert_eq!(resp.range, Some((300_000, 300_009)));

    // Backup round trip: export from A, restore into a fresh dir.
    let file = da.path().join("backup.hbk");
    call(
        &a,
        "backup_export",
        json!({"path": file, "passphrase": "correct horse", "includeBlobs": true}),
    )
    .await;
    let id_a = call(&a, "identity_get", json!({})).await["user_id"].clone();
    let c = Ctx::open(
        dc.path().to_path_buf(),
        Options::localhost(None, vec![]),
        None,
    )
    .await
    .unwrap();
    call(
        &c,
        "backup_import",
        json!({"path": file, "passphrase": "correct horse"}),
    )
    .await;
    assert_eq!(call(&c, "identity_get", json!({})).await["user_id"], id_a);
    assert!(
        has_text(&c, &space, "hello from B").await,
        "restored data lacks the message"
    );
    // A wrong passphrase fails and leaves the restored data intact.
    assert!(
        api::handle(
            &c,
            "backup_import",
            json!({"path": file, "passphrase": "wrong wrong"})
        )
        .await
        .is_err()
    );
    assert!(has_text(&c, &space, "hello from B").await);

    for x in [&a, &b, &c] {
        x.shutdown().await;
    }
}
