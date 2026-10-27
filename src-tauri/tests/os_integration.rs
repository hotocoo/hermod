//! What reaches the OS through the desktop shell: notifications (N-001), dock badge (N-003),
//! per-kind notification settings (N-004), log viewer (W-005), save dialog and size cap (W-009).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use hermodr_lib::api;
use hermodr_lib::ctx::{BoxFut, Ctx, Options, Shell};
use serde_json::{Value, json};

const LOG_LINES: usize = 1500;
const TAIL: usize = 1000;
const TITLE_MAX: usize = 120;
const BODY_MAX: usize = 240;
const FILE_BYTES: &[u8] = b"saved through the dialog";

#[derive(Default)]
struct Recorder {
    notified: Mutex<Vec<(String, String)>>,
    badges: Mutex<Vec<u32>>,
    save_to: Mutex<Option<PathBuf>>,
}

impl Shell for Recorder {
    fn notify(&self, title: &str, body: &str) {
        self.notified
            .lock()
            .unwrap()
            .push((title.into(), body.into()));
    }
    fn badge(&self, count: u32) {
        self.badges.lock().unwrap().push(count);
    }
    fn pick_files(&self, _: bool, _: &[String]) -> Result<Option<Vec<PathBuf>>, String> {
        Ok(None)
    }
    fn pick_folder(&self) -> Result<Option<PathBuf>, String> {
        Ok(None)
    }
    fn save_dialog(&self, _: &str) -> Result<Option<PathBuf>, String> {
        Ok(self.save_to.lock().unwrap().clone())
    }
    fn update_check(&self) -> BoxFut<Result<Value, String>> {
        Box::pin(async { Err("none".into()) })
    }
    fn update_install(&self) -> BoxFut<Result<(), String>> {
        Box::pin(async { Err("none".into()) })
    }
}

async fn open(dir: &std::path::Path, log: Option<PathBuf>) -> (Arc<Ctx>, Arc<Recorder>) {
    let rec = Arc::new(Recorder::default());
    let ctx = Ctx::open(
        dir.to_path_buf(),
        Options::localhost(log, vec![]),
        Some(rec.clone()),
    )
    .await
    .unwrap();
    (ctx, rec)
}

async fn call(c: &Arc<Ctx>, name: &str, args: Value) -> Result<Value, String> {
    api::handle(c, name, args).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn notify_and_badge_reach_the_shell_and_are_clipped() {
    let dir = tempfile::tempdir().unwrap();
    let (c, rec) = open(dir.path(), None).await;
    call(
        &c,
        "notify_send",
        json!({"title": "t".repeat(TITLE_MAX + 50), "body": "b".repeat(BODY_MAX + 50), "spaceId": "x", "channelId": "y"}),
    )
    .await
    .unwrap();
    call(&c, "badge_set", json!({"count": 7})).await.unwrap();
    call(&c, "badge_set", json!({"count": 0})).await.unwrap();
    let n = rec.notified.lock().unwrap().clone();
    assert_eq!(n.len(), 1);
    assert_eq!(
        (n[0].0.chars().count(), n[0].1.chars().count()),
        (TITLE_MAX, BODY_MAX)
    );
    assert_eq!(*rec.badges.lock().unwrap(), vec![7, 0]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn notification_kinds_are_stored_per_kind_and_survive_a_reopen() {
    let dir = tempfile::tempdir().unwrap();
    {
        let (c, _) = open(dir.path(), None).await;
        let before = call(&c, "notify_settings_get", json!({})).await.unwrap();
        let flipped = !before["meeting"].as_bool().unwrap();
        let after = call(&c, "notify_settings_set", json!({"meeting": flipped}))
            .await
            .unwrap();
        assert_eq!(after["meeting"], flipped);
        for k in ["dm", "mention", "reminder", "enabled"] {
            assert_eq!(after[k], before[k], "{k} untouched by a meeting patch");
        }
        c.shutdown().await;
        drop(c);
    }
    let (c, _) = open(dir.path(), None).await;
    let again = call(&c, "notify_settings_get", json!({})).await.unwrap();
    let default = Value::Bool(!again["meeting"].as_bool().unwrap());
    let reset = call(&c, "notify_settings_set", json!({"meeting": default}))
        .await
        .unwrap();
    assert_ne!(
        again["meeting"], reset["meeting"],
        "the stored choice was read back and can be changed again"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn log_tail_returns_the_last_lines_of_the_local_log() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("hermod.log");
    let text: String = (0..LOG_LINES).map(|i| format!("line {i}\n")).collect();
    std::fs::write(&log, text).unwrap();
    let (c, _) = open(dir.path(), Some(log)).await;
    let out = call(&c, "log_tail", json!({"lines": TAIL})).await.unwrap();
    let lines = out.as_array().unwrap();
    assert_eq!(lines.len(), TAIL);
    assert_eq!(lines[0], format!("line {}", LOG_LINES - TAIL));
    assert_eq!(lines[TAIL - 1], format!("line {}", LOG_LINES - 1));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn download_saves_through_the_dialog_and_cancel_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (c, rec) = open(dir.path(), None).await;
    let blob = api::handle_raw(
        &c,
        "blob_put_bytes",
        Some(r#"{"name":"note.txt"}"#),
        FILE_BYTES.to_vec(),
    )
    .await
    .unwrap();
    let hash = blob["hash"].as_str().unwrap().to_string();
    let args = json!({"hash": hash, "suggestedName": "note.txt"});

    // Dialog cancelled: nothing returned, nothing written.
    let cancelled = call(&c, "blob_save_as", args.clone()).await.unwrap();
    assert!(cancelled.is_null());

    let dest = dir.path().join("picked.txt");
    *rec.save_to.lock().unwrap() = Some(dest.clone());
    let saved = call(&c, "blob_save_as", args).await.unwrap();
    assert_eq!(saved, json!(dest.to_string_lossy()));
    assert_eq!(std::fs::read(&dest).unwrap(), FILE_BYTES);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_file_over_the_upload_cap_is_rejected_with_a_message() {
    let dir = tempfile::tempdir().unwrap();
    let (c, _) = open(dir.path(), None).await;
    let over = vec![0u8; api::MAX_UPLOAD_BYTES + 1];
    let err = api::handle_raw(&c, "blob_put_bytes", Some(r#"{"name":"big.bin"}"#), over)
        .await
        .unwrap_err();
    assert_eq!(err, "that file is too large");
}

/// D-006: the Tauri command path (save dialog, then export) produces a folder readable without Hermod.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn space_export_writes_plain_json_into_the_chosen_folder() {
    let dir = tempfile::tempdir().unwrap();
    let (c, rec) = open(dir.path(), None).await;
    let sp = call(
        &c,
        "space_create",
        json!({"name": "Forge", "tagline": "t", "kind": "Team"}),
    )
    .await
    .unwrap();
    let space = sp["space_id"].as_str().unwrap().to_string();
    call(&c, "event_append", json!({"spaceId": space, "body": {
        "t": "message.post", "channel_id": "general", "msg_id": "m1", "text": "plain words", "attachments": []}}))
    .await
    .unwrap();

    let args = json!({"spaceId": space});
    let cancelled = call(&c, "space_export", args.clone()).await.unwrap();
    assert!(cancelled.is_null(), "cancelled dialog exports nothing");
    let dest = dir.path().join("export");
    *rec.save_to.lock().unwrap() = Some(dest.clone());
    let out = call(&c, "space_export", args).await.unwrap();
    assert_eq!(out["messages"], 1);
    let raw = std::fs::read_to_string(dest.join("messages.json")).unwrap();
    let msgs: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(msgs["general"][0]["text"], "plain words");
}

/// E-009: through the command the UI calls, the last owner cannot be demoted.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_last_owner_cannot_be_demoted_through_the_command() {
    let dir = tempfile::tempdir().unwrap();
    let (c, _) = open(dir.path(), None).await;
    let sp = call(
        &c,
        "space_create",
        json!({"name": "Forge", "tagline": "t", "kind": "Team"}),
    )
    .await
    .unwrap();
    let space = sp["space_id"].as_str().unwrap();
    let me = call(&c, "identity_get", json!({})).await.unwrap()["user_id"]
        .as_str()
        .unwrap()
        .to_string();
    for role in ["admin", "member", "guest"] {
        let err = call(
            &c,
            "member_set_role",
            json!({"spaceId": space, "user": me, "role": role}),
        )
        .await
        .unwrap_err();
        assert!(!err.is_empty(), "demotion to {role} refused");
    }
    let members = call(&c, "space_members", json!({"spaceId": space}))
        .await
        .unwrap();
    assert_eq!(members[0]["role"], "owner", "still the owner");
}
