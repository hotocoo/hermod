//! Snapshot folder commands through the bridge (K-003, K-009, K-010). The native folder dialogs cannot
//! run headless, so the devhost/test path argument stands in for the dialog; the commands are the real ones.

use std::sync::Arc;

use hermodr_lib::api;
use hermodr_lib::ctx::{Ctx, Options};
use serde_json::{Value, json};

async fn call(c: &Arc<Ctx>, name: &str, args: Value) -> Value {
    api::handle(c, name, args)
        .await
        .unwrap_or_else(|e| panic!("{name}: {e}"))
}

async fn open(opts: Options, dir: &std::path::Path) -> (Arc<Ctx>, String) {
    let ctx = Ctx::open(dir.to_path_buf(), opts, None).await.unwrap();
    call(
        &ctx,
        "legal_accept",
        json!({"version": "1", "shareResources": true}),
    )
    .await;
    let sp = call(
        &ctx,
        "space_create",
        json!({"name": "Forge", "tagline": "t", "kind": "Team"}),
    )
    .await;
    let space = sp["space_id"].as_str().unwrap().to_string();
    (ctx, space)
}

async fn take_snap(c: &Arc<Ctx>, space: &str, id: &str, plan: &Value, parent: Option<&str>) {
    call(
        c,
        "event_append",
        json!({"spaceId": space, "body": {
        "t": "snap.create", "snap_id": id, "line_id": "main", "title": id, "kind": "Files",
        "files": plan["files"], "parent": parent}}),
    )
    .await;
}

/// The stored chunk file under a data dir whose bytes equal `data`.
fn chunk_holding(dir: &std::path::Path, data: &[u8]) -> std::path::PathBuf {
    fn walk(p: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for e in std::fs::read_dir(p).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(&p, out);
            } else {
                out.push(p);
            }
        }
    }
    let mut v = Vec::new();
    walk(&dir.join("blobs/chunks"), &mut v);
    v.into_iter()
        .find(|p| std::fs::read(p).unwrap() == data)
        .expect("chunk on disk")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn scan_snapshot_export_and_tamper_through_the_bridge() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, space) = open(Options::localhost(None, vec![]), dir.path()).await;
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("a.txt"), b"one\ntwo\n").unwrap();
    std::fs::create_dir(folder.path().join("sub")).unwrap();
    std::fs::write(folder.path().join("sub/b.txt"), b"x\n").unwrap();

    // K-003: pick folder, hash it into blobs, count adds.
    let first = call(
        &ctx,
        "snap_scan_folder",
        json!({"spaceId": space, "path": folder.path()}),
    )
    .await;
    assert_eq!(first["added"], 2);
    assert_eq!(
        (first["removed"].as_u64(), first["changed"].as_u64()),
        (Some(0), Some(0))
    );
    let files = first["files"].as_array().unwrap();
    assert!(
        files
            .iter()
            .all(|f| f["blob"]["hash"].as_str().is_some_and(|h| h.len() == 64))
    );
    take_snap(&ctx, &space, "s1", &first, None).await;

    // Edit, add and remove against the parent: dels and adds are computed.
    std::fs::write(folder.path().join("a.txt"), b"one\n2\n").unwrap();
    std::fs::write(folder.path().join("c.txt"), b"new\n").unwrap();
    std::fs::remove_file(folder.path().join("sub/b.txt")).unwrap();
    let second = call(
        &ctx,
        "snap_scan_folder",
        json!({"spaceId": space, "path": folder.path(), "parent": "s1"}),
    )
    .await;
    assert_eq!(
        (
            second["added"].as_u64(),
            second["removed"].as_u64(),
            second["changed"].as_u64()
        ),
        (Some(1), Some(1), Some(1))
    );
    let a = second["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "a.txt")
        .unwrap();
    assert_eq!((a["adds"].as_u64(), a["dels"].as_u64()), (Some(1), Some(1)));

    // K-010: export writes the snapshot's files into the chosen folder, nested paths included.
    let out = tempfile::tempdir().unwrap().keep().join("copy");
    let done = call(
        &ctx,
        "snap_export",
        json!({"spaceId": space, "snapId": "s1", "path": out}),
    )
    .await;
    assert_eq!(done["files"], 2);
    assert_eq!(std::fs::read(out.join("a.txt")).unwrap(), b"one\ntwo\n");
    assert_eq!(std::fs::read(out.join("sub/b.txt")).unwrap(), b"x\n");
    let again = api::handle(
        &ctx,
        "snap_export",
        json!({"spaceId": space, "snapId": "s1", "path": out}),
    )
    .await;
    assert!(again.is_err(), "a non-empty folder is refused");
    let rel = api::handle(
        &ctx,
        "snap_export",
        json!({"spaceId": space, "snapId": "s1", "path": "relative/dir"}),
    )
    .await;
    assert!(rel.is_err(), "a relative path is refused");

    // K-009: untouched blobs verify; one altered chunk is reported as corrupt.
    let ok = call(
        &ctx,
        "snap_verify",
        json!({"spaceId": space, "snapId": "s1"}),
    )
    .await;
    assert_eq!(ok["ok"], true);
    std::fs::write(chunk_holding(dir.path(), b"one\ntwo\n"), b"tampered").unwrap();
    let bad = call(
        &ctx,
        "snap_verify",
        json!({"spaceId": space, "snapId": "s1"}),
    )
    .await;
    assert_eq!(bad["ok"], false);
    assert_eq!(bad["corrupt"], json!(["a.txt"]));
    ctx.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn scan_folder_only_reads_what_the_folder_picker_returned() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, space) = open(Options::production(None), dir.path()).await;
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("a.txt"), b"one\n").unwrap();
    let args = json!({"spaceId": space, "path": folder.path()});
    assert!(
        api::handle(&ctx, "snap_scan_folder", args.clone())
            .await
            .is_err()
    );
    ctx.allow_path(folder.path().to_path_buf());
    assert_eq!(call(&ctx, "snap_scan_folder", args).await["added"], 1);
    ctx.shutdown().await;
}
