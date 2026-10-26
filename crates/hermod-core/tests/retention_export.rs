//! D-004 retention and D-006 export through the Core facade.

mod common;

use std::time::Duration;

use hermod_core::Core;
use hermod_core::event::EventBody;
use hermod_core::ids::SpaceId;
use serde_json::Value;

const DAY_MS: i64 = 86_400_000;
const RETENTION_DAYS: u32 = 30;
const FILE_BYTES: &[u8] = b"retention test payload";

fn core() -> (tempfile::TempDir, Core) {
    let dir = tempfile::tempdir().unwrap();
    let c = Core::open(dir.path()).unwrap();
    (dir, c)
}

fn messages(c: &Core, key: &str) -> Vec<String> {
    c.snapshot().unwrap()["collections"]["messages"][key]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap().to_string())
        .collect()
}

fn post_with_blob(c: &Core, space: &SpaceId, id: &str, blob: &hermod_core::BlobRef) {
    let EventBody::MessagePost {
        channel_id,
        msg_id,
        text,
        reply_to,
        snap,
        mentions,
        preview,
        target,
        ext,
        ..
    } = common::post_msg("general", id, "hello")
    else {
        unreachable!()
    };
    let body = EventBody::MessagePost {
        channel_id,
        msg_id,
        text,
        reply_to,
        attachments: vec![blob.clone()],
        snap,
        mentions,
        preview,
        target,
        ext,
    };
    c.append(space, body).unwrap();
}

/// Space with one message carrying a blob. Returns (core, space, blob).
fn world() -> (tempfile::TempDir, Core, SpaceId, hermod_core::BlobRef) {
    let (dir, c) = core();
    let space = c.space_create("Studio", "", "Team").unwrap().id;
    let blob = c.blob_put_bytes("note.txt", FILE_BYTES).unwrap();
    post_with_blob(&c, &space, "m1", &blob);
    (dir, c, space, blob)
}

#[test]
fn retention_get_reads_back_what_was_set() {
    let (_d, c, space, _blob) = world();
    assert_eq!(c.retention_get(&space).unwrap(), None);
    c.retention_set(&space, Some(RETENTION_DAYS)).unwrap();
    assert_eq!(c.retention_get(&space).unwrap(), Some(RETENTION_DAYS));
    c.retention_set(&space, None).unwrap();
    assert_eq!(c.retention_get(&space).unwrap(), None);
    assert!(c.retention_set(&space, Some(0)).is_err());
    assert_eq!(
        c.retention_get(&space).unwrap(),
        None,
        "bad value not stored"
    );
}

#[test]
fn prune_hides_old_messages_and_frees_unreferenced_blobs() {
    let (_d, c, space, blob) = world();
    let hash = blob.hash.clone();
    let key = format!("{space}/general");
    c.retention_set(&space, Some(RETENTION_DAYS)).unwrap();
    assert_eq!(messages(&c, &key), ["m1"], "fresh content survives");
    let later = hermod_core::api::now_ms() + 31 * DAY_MS;
    let ctx_hidden = c.snapshot_at(later).unwrap()["collections"]["messages"][&key].clone();
    assert_eq!(ctx_hidden, Value::Array(vec![]), "past retention is hidden");
    let freed = c.retention_prune_with(later, Duration::ZERO).unwrap();
    assert!(freed > 0);
    assert!(!c.blobs().list().unwrap().contains(&hash));
    assert!(
        !c.missing_since(&space, &Default::default())
            .unwrap()
            .is_empty(),
        "the signed log is untouched"
    );
}

#[test]
fn forever_keeps_everything() {
    let (_d, c, space, blob) = world();
    let hash = blob.hash.clone();
    let key = format!("{space}/general");
    c.retention_set(&space, None).unwrap();
    let later = hermod_core::api::now_ms() + 3650 * DAY_MS;
    assert_eq!(c.retention_prune_with(later, Duration::ZERO).unwrap(), 0);
    assert!(c.blobs().list().unwrap().contains(&hash));
    let kept = c.snapshot_at(later).unwrap()["collections"]["messages"][&key].clone();
    assert_eq!(kept.as_array().unwrap().len(), 1);
}

#[test]
fn prune_keeps_blobs_still_referenced_elsewhere() {
    let (_d, c, space, blob) = world();
    let other = c.space_create("Other", "", "Team").unwrap().id;
    post_with_blob(&c, &other, "m2", &blob);
    c.retention_set(&space, Some(RETENTION_DAYS)).unwrap();
    let later = hermod_core::api::now_ms() + 31 * DAY_MS;
    assert_eq!(c.retention_prune_with(later, Duration::ZERO).unwrap(), 0);
    assert!(c.blobs().list().unwrap().contains(&blob.hash));
}

#[test]
fn export_writes_json_and_files() {
    let (_d, c, space, blob) = world();
    let hash = blob.hash.clone();
    let out = tempfile::tempdir().unwrap();
    let target = out.path().join("export");
    let sum = c.space_export(&space, &target).unwrap();
    assert_eq!((sum.messages, sum.files), (1, 1));
    assert!(sum.missing.is_empty());
    for f in [
        "messages.json",
        "posts.json",
        "docs.json",
        "board.json",
        "members.json",
    ] {
        let raw = std::fs::read_to_string(target.join(f)).unwrap();
        serde_json::from_str::<Value>(&raw).unwrap();
    }
    let msgs: Value =
        serde_json::from_str(&std::fs::read_to_string(target.join("messages.json")).unwrap())
            .unwrap();
    assert_eq!(msgs["general"][0]["text"], "hello");
    let index: Value =
        serde_json::from_str(&std::fs::read_to_string(target.join("files/index.json")).unwrap())
            .unwrap();
    let file = index[&hash]["file"].as_str().unwrap();
    assert_eq!(
        std::fs::read(target.join("files").join(file)).unwrap(),
        FILE_BYTES
    );
}

#[test]
fn export_refuses_a_non_empty_folder() {
    let (_d, c, space, _blob) = world();
    let out = tempfile::tempdir().unwrap();
    std::fs::write(out.path().join("keep.txt"), b"mine").unwrap();
    assert!(c.space_export(&space, out.path()).is_err());
    assert_eq!(std::fs::read(out.path().join("keep.txt")).unwrap(), b"mine");
}
