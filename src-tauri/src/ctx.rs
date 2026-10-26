//! Application runtime: owns `Core`, runs the network node on its own two-thread runtime and
//! turns node events into UI events. One `Ctx` backs the Tauri commands and the devhost alike.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use hermod_core::identity::Identity;
use hermod_core::ids::{SpaceId, UserId};
use hermod_core::keyguard::{SecretStore, Unlock};
use hermod_core::{Core, SignedEvent};
use hermod_node::config::NodeConfig;
use hermod_node::store::FilePeerBook;
use hermod_node::{Node, NodeEvent, NodeHandle, NodeStatus, Reachability};
use serde_json::{Value, json};
use tokio::sync::{RwLock, broadcast, mpsc};

use crate::adapter::{self, CoreStore, Notice};
use crate::keychain::{KeyringStore, legacy_account};
use crate::{blob, notify, settings};

const JOIN_LINK_PREFIX: &str = "hermod://join/";

/// `hermod://join/<code>` to `<code>`. Codes are base58, so anything else is rejected.
pub fn invite_code(url: &str) -> Option<&str> {
    let code = url.strip_prefix(JOIN_LINK_PREFIX)?.trim_end_matches('/');
    (!code.is_empty() && code.chars().all(|c| c.is_ascii_alphanumeric())).then_some(code)
}

pub type BoxFut<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// Every projection collection the UI reads; used when we cannot tell what changed.
pub const ALL_COLLECTIONS: &[&str] = &[
    "people",
    "spaces",
    "channels",
    "messages",
    "rooms",
    "agenda",
    "workboards",
    "skein",
    "feed",
    "media",
    "pinboards",
    "docs",
    "events",
    "letters",
    "inbox",
    "desk",
    "arcade",
    "messaging",
];
const STATUS_EVERY: Duration = Duration::from_secs(1);
/// Core setting that remembers events authored while the node could not send them (G-010), so
/// the "waiting to sync" count survives a restart.
const UNSENT_KEY: &str = "unsent_events";
const STOP_GRACE: Duration = Duration::from_secs(3);
/// How long a data swap waits for in-flight work to let go of the database, and how often it looks.
const CLOSE_WAIT: Duration = Duration::from_secs(10);
const CLOSE_POLL: Duration = Duration::from_millis(25);

/// One UI event (`hermod://changed`, `hermod://node`, ...).
#[derive(Debug, Clone)]
pub struct Emitted {
    pub name: String,
    pub payload: Value,
}

/// Desktop integration the API needs but must not depend on (dialogs, OS notifications,
/// updater). Tauri implements it; the devhost passes none and those commands say so.
pub trait Shell: Send + Sync {
    fn notify(&self, title: &str, body: &str);
    /// Unread total on the dock icon (and tray tooltip where badges are unsupported); 0 clears it.
    fn badge(&self, count: u32);
    /// Blocking native file picker.
    fn pick_files(&self, multiple: bool, accept: &[String])
    -> Result<Option<Vec<PathBuf>>, String>;
    /// Blocking native save dialog.
    fn save_dialog(&self, suggested: &str) -> Result<Option<PathBuf>, String>;
    fn update_check(&self) -> BoxFut<Result<Value, String>>;
    fn update_install(&self) -> BoxFut<Result<(), String>>;
}

pub type NodeTweak = Arc<dyn Fn(&mut NodeConfig) + Send + Sync>;

/// Knobs that differ between the shipped app and tests or the devhost.
#[derive(Clone)]
pub struct Options {
    /// Adjust the node configuration (listen addresses, discovery) before start.
    pub node_tweak: Option<NodeTweak>,
    /// Allow `blob_put` for any path. The app only accepts paths its own picker returned.
    pub unrestricted_paths: bool,
    /// Let link previews fetch loopback and private addresses. Production refuses them (SSRF);
    /// the devhost allows them so local pages and test servers can be previewed.
    pub preview_allow_private: bool,
    /// Log file `log_tail` reads.
    pub log_file: Option<PathBuf>,
    /// Keychain offered for the identity key. None for the devhost and tests, which must never
    /// touch the developer's real keychain (tests pass an in-memory one).
    pub keystore: Option<Arc<dyn SecretStore>>,
}

impl Options {
    pub fn production(log_file: Option<PathBuf>) -> Self {
        Options {
            node_tweak: None,
            unrestricted_paths: false,
            preview_allow_private: false,
            log_file,
            keystore: Some(KeyringStore::shared()),
        }
    }

    /// Localhost only, no public bootstrap, mDNS, DHT or UPnP: for the devhost and tests.
    pub fn localhost(log_file: Option<PathBuf>, listen: Vec<hermod_node::Multiaddr>) -> Self {
        let tweak: NodeTweak = Arc::new(move |c: &mut NodeConfig| {
            if !listen.is_empty() {
                c.listen = listen.clone();
            } else {
                c.listen = vec!["/ip4/127.0.0.1/tcp/0".parse().expect("static multiaddr")];
            }
            c.bootstrap.clear();
            c.enable_mdns = false;
            c.enable_upnp = false;
            c.enable_dht = false;
            c.allow_private_addrs = true;
            c.relay_mode = hermod_node::config::RelayMode::Never;
            c.gossip_heartbeat = Duration::from_millis(250);
        });
        Options {
            node_tweak: Some(tweak),
            unrestricted_paths: true,
            preview_allow_private: true,
            log_file,
            keystore: None,
        }
    }
}

struct NodeRt {
    rt: tokio::runtime::Runtime,
    handle: NodeHandle,
}

/// Everything tied to one open data dir; replaced as a whole on reset and restore.
pub struct Live {
    pub core: Arc<Core>,
    node: tokio::sync::Mutex<Option<NodeRt>>,
    /// Held for the whole of `start_node`, so two starts cannot race while `node` stays free for
    /// readers (status, publish) during the slow network start.
    starting: tokio::sync::Mutex<()>,
    mime: Arc<Mutex<HashMap<String, String>>>,
    /// Complete blobs being served: their manifest and content type, so a Range request does not
    /// re-read the manifest, re-check every chunk and re-hash chunk 0 each time.
    blob_info: Mutex<HashMap<String, Arc<blob::BlobInfo>>>,
    online: Arc<Mutex<HashMap<SpaceId, HashSet<UserId>>>>,
    /// Collections touched by remote events applied since the last `changed` for that space.
    touched: Touched,
    /// (taken at, own bytes, bytes held for others): storage walks every event, so it is cached.
    storage: Mutex<Option<(std::time::Instant, u64, u64)>>,
    /// Events authored while the node was off or refused them: only in the store until a sync
    /// with a peer completes. Counted into the sync pill alongside the node's own queue.
    unsent: AtomicU32,
}

/// Collections the UI must re-read per space, filled as remote events apply.
pub type Touched = Arc<Mutex<HashMap<SpaceId, std::collections::BTreeSet<&'static str>>>>;

const STORAGE_TTL: Duration = Duration::from_secs(15);

/// Projection collections an event type can change.
pub fn collections_for(tag: &str) -> &'static [&'static str] {
    let p = tag.split('.').next().unwrap_or("");
    match p {
        "message" | "reaction" | "read" | "thread" | "emoji" | "sticker" | "dm" | "automation" => {
            &["messages", "channels", "inbox", "spaces", "messaging"]
        }
        "channel" => &["channels", "spaces", "messaging"],
        "profile" => &["people"],
        "post" | "like" | "save" | "story" | "live" => &["feed", "media", "spaces"],
        "room" | "meeting" | "agenda" | "note" => &["rooms", "agenda", "spaces"],
        "board" | "column" | "card" => &["workboards", "spaces"],
        "pinboard" | "pin" => &["pinboards", "spaces"],
        "doc" => &["docs", "spaces"],
        "event" => &["events", "spaces"],
        "line" | "snap" => &["skein", "spaces"],
        "letter" => &["letters", "messages", "inbox"],
        "game" | "poll" | "quiz" | "kudos" | "standup" => &["arcade", "spaces"],
        _ => ALL_COLLECTIONS,
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Live {
    /// Sets the unsent count and remembers it across restarts. Returns the new value.
    fn set_unsent(&self, n: u32) -> u32 {
        self.unsent.store(n, Ordering::Relaxed);
        if let Err(e) = self.core.setting_set(UNSENT_KEY, &n.to_string()) {
            tracing::warn!("cannot remember unsent count: {e}");
        }
        n
    }

    /// Content type recorded for a blob: memory first, then the persisted table.
    pub fn blob_info(&self, hash: &str) -> Option<Arc<blob::BlobInfo>> {
        lock(&self.blob_info).get(hash).cloned()
    }

    pub fn blob_info_put(&self, hash: &str, info: Arc<blob::BlobInfo>) {
        let mut m = lock(&self.blob_info);
        if m.len() >= blob::MAX_INFO_ENTRIES {
            m.clear();
        }
        m.insert(hash.to_string(), info);
    }

    /// Drop cached serving info after chunks may have gone (cache eviction, a failed read).
    pub fn forget_blob_info(&self) {
        lock(&self.blob_info).clear();
    }

    pub fn blob_mime(&self, hash: &str) -> Option<String> {
        if let Some(m) = lock(&self.mime).get(hash).cloned() {
            return Some(m);
        }
        let m = self.core.blob_mime(hash).ok().flatten()?;
        lock(&self.mime).insert(hash.to_string(), m.clone());
        Some(m)
    }

    /// (own bytes, bytes held for others), cached for a few seconds.
    pub fn storage_bytes(&self) -> (u64, u64) {
        let mut g = lock(&self.storage);
        if let Some((at, own, others)) = *g
            && at.elapsed() < STORAGE_TTL
        {
            return (own, others);
        }
        let (own, others) = match self.core.storage_usage() {
            Ok(u) => (
                u.blob_store_bytes.saturating_sub(u.cache_bytes)
                    + u.spaces.iter().map(|s| s.event_bytes).sum::<u64>(),
                u.cache_bytes,
            ),
            Err(e) => {
                tracing::warn!("storage usage unavailable: {e}");
                (0, 0)
            }
        };
        *g = Some((std::time::Instant::now(), own, others));
        (own, others)
    }

    pub fn remember_blobs<'a>(&self, refs: impl IntoIterator<Item = &'a hermod_core::BlobRef>) {
        let mut m = lock(&self.mime);
        for r in refs {
            if !r.mime.is_empty() {
                if let Err(e) = self.core.blob_meta_put(r) {
                    tracing::warn!("blob type not saved: {e}");
                }
                if m.len() < 100_000 {
                    m.insert(r.hash.clone(), r.mime.clone());
                }
                // A type learned now beats one sniffed earlier.
                lock(&self.blob_info).remove(&r.hash);
            }
        }
    }

    pub fn online_in(&self, space: &SpaceId) -> HashSet<UserId> {
        lock(&self.online).get(space).cloned().unwrap_or_default()
    }
}

pub struct Ctx {
    pub dir: PathBuf,
    pub opts: Options,
    pub shell: Option<Arc<dyn Shell>>,
    tx: broadcast::Sender<Emitted>,
    live: RwLock<Option<Arc<Live>>>,
    picked: Mutex<HashSet<PathBuf>>,
    background: AtomicBool,
    link: Mutex<PendingLink>,
    /// The keychain (never a passphrase: that is used once to open and then dropped).
    unlock: Mutex<Unlock>,
    /// Why the data dir is not open (locked, or the keychain cannot return the key); the UI shows
    /// its recovery screen for it.
    limited: Mutex<Option<String>>,
}

/// A join link that arrived before the UI first asked for one (a cold start opens the app
/// from the link, and its event fires before the webview listens).
#[derive(Default)]
struct PendingLink {
    code: Option<String>,
    /// The UI has asked once; from then on links reach it only as events, so a reload never
    /// replays an old one.
    read: bool,
}

/// Start of `Error::KeyUnavailable`'s text; the UI matches it too.
const KEY_UNAVAILABLE_PREFIX: &str = "identity key unavailable";

const BUSY_MSG: &str = "Hermod is still busy with your data, try again in a moment";

/// Waits until nothing but `live` itself holds the database (tasks mid-query, the node's store),
/// then drops it so SQLite is closed. Hands `live` back if others still hold it after
/// [`CLOSE_WAIT`]. No new holder can appear: callers hold the `live` write lock.
async fn release(live: Arc<Live>) -> Result<(), Arc<Live>> {
    let deadline = std::time::Instant::now() + CLOSE_WAIT;
    while Arc::strong_count(&live) > 1 || Arc::strong_count(&live.core) > 1 {
        if std::time::Instant::now() >= deadline {
            return Err(live);
        }
        tokio::time::sleep(CLOSE_POLL).await;
    }
    Ok(())
}

/// Open failures that leave the app running in a limited state (recovery screen) instead of
/// failing to start: the key cannot be read, but backup restore and reset still work.
fn is_limited(msg: &str) -> bool {
    msg == hermod_core::Error::Locked.to_string() || msg.starts_with(KEY_UNAVAILABLE_PREFIX)
}

fn open_live(dir: &Path, unlock: &Unlock) -> Result<Arc<Live>, String> {
    let cfg = hermod_core::CoreConfig {
        unlock: unlock.clone(),
        ..Default::default()
    };
    let core = Core::open_with(dir, cfg).map_err(|e| match e {
        // Passed through bare: the UI matches them to show the recovery screen.
        hermod_core::Error::Locked | hermod_core::Error::KeyUnavailable(_) => e.to_string(),
        _ => format!("cannot open your data: {e}"),
    })?;
    let unsent = core
        .setting_get(UNSENT_KEY)
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    Ok(Arc::new(Live {
        core: Arc::new(core),
        node: tokio::sync::Mutex::new(None),
        starting: tokio::sync::Mutex::new(()),
        mime: Arc::new(Mutex::new(HashMap::new())),
        blob_info: Mutex::new(HashMap::new()),
        online: Arc::new(Mutex::new(HashMap::new())),
        touched: Arc::new(Mutex::new(HashMap::new())),
        storage: Mutex::new(None),
        unsent: AtomicU32::new(unsent),
    }))
}

impl Ctx {
    /// Open the data dir and, when the Terms were accepted, start the node.
    pub async fn open(
        dir: PathBuf,
        opts: Options,
        shell: Option<Arc<dyn Shell>>,
    ) -> Result<Arc<Ctx>, String> {
        let unlock = Unlock {
            store: opts.keystore.clone(),
            passphrase: None,
            legacy_account: Some(legacy_account(&dir)),
        };
        // A passphrase-sealed or unreadable key (keychain entry gone, access denied) must not
        // stop the app starting: it comes up limited, with restore and reset still available.
        let (d, u) = (dir.clone(), unlock.clone());
        // Finish or undo a restore the app died in, before anything opens (or creates) the data.
        let opened = tokio::task::spawn_blocking(move || {
            crate::restore::recover(&d).map_err(|e| format!("cannot recover your data: {e}"))?;
            open_live(&d, &u)
        })
        .await
        .map_err(|e| e.to_string())?;
        let (live, limited) = match opened {
            Ok(l) => (Some(l), None),
            Err(msg) if is_limited(&msg) => (None, Some(msg)),
            Err(msg) => return Err(msg),
        };
        let open = live.is_some();
        let (tx, _) = broadcast::channel(512);
        let ctx = Arc::new(Ctx {
            dir,
            opts,
            shell,
            tx,
            live: RwLock::new(live),
            picked: Mutex::new(HashSet::new()),
            background: AtomicBool::new(false),
            link: Mutex::new(PendingLink::default()),
            unlock: Mutex::new(unlock),
            limited: Mutex::new(limited),
        });
        // Scheduled messages and automations are due whether or not the node runs, so the
        // scheduler lives on the app runtime and holds the Ctx weakly (it ends with it).
        tokio::spawn(crate::scheduler::run(Arc::downgrade(&ctx)));
        if open {
            ctx.finish_open().await;
        }
        Ok(ctx)
    }

    /// Background mode and, when the Terms were accepted, the node.
    async fn finish_open(self: &Arc<Self>) {
        self.refresh_background().await;
        if self.legal_accepted().await
            && let Err(e) = self.start_node().await
        {
            tracing::error!("node did not start: {e}");
        }
    }

    /// Opens the data dir with the typed passphrase. A wrong one leaves everything locked. The
    /// passphrase is dropped (and wiped) as soon as the key file has been read.
    pub async fn unlock(self: &Arc<Self>, passphrase: String) -> Result<(), String> {
        let mut guard = self.live.write().await;
        if guard.is_some() {
            return Ok(());
        }
        let unlock = Unlock {
            passphrase: Some(zeroize::Zeroizing::new(passphrase)),
            ..lock(&self.unlock).clone()
        };
        let dir = self.dir.clone();
        let live = tokio::task::spawn_blocking(move || open_live(&dir, &unlock))
            .await
            .map_err(|e| e.to_string())??;
        *guard = Some(live);
        drop(guard);
        *lock(&self.limited) = None;
        self.finish_open().await;
        Ok(())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Emitted> {
        self.tx.subscribe()
    }

    pub fn emit(&self, name: &str, payload: Value) {
        let _ = self.tx.send(Emitted {
            name: format!("hermod://{name}"),
            payload,
        });
    }

    pub fn changed(&self, space_label: &str, collections: &[&str]) {
        self.emit(
            "changed",
            json!({ "space_id": space_label, "collections": collections }),
        );
    }

    pub async fn live(&self) -> Result<Arc<Live>, String> {
        self.live.read().await.clone().ok_or_else(|| {
            lock(&self.limited)
                .clone()
                .unwrap_or_else(|| "Hermod is restarting, try again in a moment".to_string())
        })
    }

    pub async fn legal_accepted(&self) -> bool {
        match self.live().await {
            Ok(l) => l
                .core
                .legal_status()
                .map(|s| s.accepted_version.is_some())
                .unwrap_or(false),
            Err(_) => false,
        }
    }

    pub async fn node(&self) -> Option<NodeHandle> {
        let live = self.live().await.ok()?;
        live.node.lock().await.as_ref().map(|n| n.handle.clone())
    }

    pub fn background(&self) -> bool {
        self.background.load(Ordering::Relaxed)
    }

    pub async fn refresh_background(&self) {
        if let Ok(l) = self.live().await {
            let on = settings::node_settings(&l.core)
                .map(|s| s.background)
                .unwrap_or(false);
            self.background.store(on, Ordering::Relaxed);
        }
    }

    /// Route an OS-opened `hermod://join/<code>` link to the UI as `hermod://deeplink { code }`,
    /// keeping it for [`Ctx::take_pending_link`] until the UI has asked once. False for any
    /// other URL.
    pub fn open_link(&self, url: &str) -> bool {
        let Some(code) = invite_code(url) else {
            return false;
        };
        {
            let mut p = lock(&self.link);
            if !p.read {
                p.code = Some(code.to_string());
            }
        }
        self.emit("deeplink", json!({ "code": code }));
        true
    }

    /// The link that arrived before the UI was listening, handed out once.
    pub fn take_pending_link(&self) -> Option<String> {
        let mut p = lock(&self.link);
        p.read = true;
        p.code.take()
    }

    /// Remember a path the native picker returned so `blob_put` may read it.
    pub fn allow_path(&self, p: PathBuf) {
        lock(&self.picked).insert(p);
    }

    pub fn path_allowed(&self, p: &Path) -> bool {
        self.opts.unrestricted_paths || lock(&self.picked).contains(p)
    }

    // ---- node lifecycle ----

    /// Start the node (idempotent). Refuses before the Terms are accepted.
    pub async fn start_node(self: &Arc<Self>) -> Result<(), String> {
        let live = self.live().await?;
        let _starting = live.starting.lock().await;
        if live.node.lock().await.is_some() {
            return Ok(());
        }
        let legal = live.core.legal_status().map_err(|e| e.to_string())?;
        if legal.accepted_version.is_none() {
            return Err("accept the Terms of Use before joining the network".into());
        }
        let s = settings::node_settings(&live.core)?;
        live.core.set_rate(s.rate());
        let seed = adapter::identity_seed(&live.core);
        let (ntx, nrx) = mpsc::unbounded_channel::<Notice>();
        let store = Arc::new(CoreStore::new(live.core.clone(), ntx, live.touched.clone()));
        let mut cfg = NodeConfig {
            limits: s.limits(),
            ..NodeConfig::default()
        };
        let book = FilePeerBook::open(self.dir.join("peers.json"))
            .map_err(|e| format!("cannot read known peers: {e}"))?;
        cfg.peer_book = Arc::new(book);
        if let Some(t) = &self.opts.node_tweak {
            t(&mut cfg);
        }
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("hermod-node")
            .enable_all()
            .build()
            .map_err(|e| format!("cannot start the network runtime: {e}"))?;
        let joined = hermod_node::store::NodeStore::joined_spaces(&*store);
        let started = rt
            .spawn(Node::start(cfg, seed, store))
            .await
            .map_err(|e| e.to_string())?;
        let (handle, events) = started.map_err(|e| format!("the network could not start: {e}"))?;
        rt.spawn(pump(
            self.clone(),
            live.online.clone(),
            live.touched.clone(),
            events,
        ));
        rt.spawn(notify::run(live.core.clone(), live.mime.clone(), nrx));
        // Stored before the joins so the node mutex is never held across a network await.
        *live.node.lock().await = Some(NodeRt {
            rt,
            handle: handle.clone(),
        });
        for sp in joined {
            if let Err(e) = handle.join_space(sp).await {
                tracing::warn!("join space failed: {e}");
            }
        }
        tracing::info!("node started, peer id {}", handle.peer_id());
        self.emit("node", json!({ "status": self.node_view().await }));
        Ok(())
    }

    pub async fn stop_node(&self) {
        let Ok(live) = self.live().await else { return };
        let taken = live.node.lock().await.take();
        if let Some(n) = taken {
            n.handle.shutdown().await;
            let _ = tokio::task::spawn_blocking(move || n.rt.shutdown_timeout(STOP_GRACE)).await;
            tracing::info!("node stopped");
        }
        self.emit("node", json!({ "status": self.node_view().await }));
    }

    /// Graceful end of the process: stop the node, flush nothing else (SQLite is durable).
    pub async fn shutdown(&self) {
        self.stop_node().await;
    }

    /// Close everything, run `f` on the quiet data dir, reopen, and restart the node if the
    /// Terms stand. Used by backup restore and app reset.
    pub async fn with_closed<F>(self: &Arc<Self>, f: F) -> Result<(), String>
    where
        F: FnOnce(&Path) -> Result<(), String> + Send + 'static,
    {
        let mut guard = self.live.write().await;
        if let Some(live) = guard.take() {
            let taken = live.node.lock().await.take();
            if let Some(n) = taken {
                n.handle.shutdown().await;
                let _ =
                    tokio::task::spawn_blocking(move || n.rt.shutdown_timeout(STOP_GRACE)).await;
            }
            // SQLite stays open while any task still holds the Core; swapping files under it
            // would corrupt data, so wait for them, and put everything back if they linger.
            if let Err(live) = release(live).await {
                *guard = Some(live);
                drop(guard);
                if self.legal_accepted().await
                    && let Err(e) = self.start_node().await
                {
                    tracing::error!("node did not restart: {e}");
                }
                return Err(BUSY_MSG.into());
            }
        }
        let dir = self.dir.clone();
        let unlock = lock(&self.unlock).clone();
        let result = tokio::task::spawn_blocking(move || {
            // A keychain entry the old key file pointed at is dead weight once `f` replaced it.
            let stale = Identity::keychain_account_in(&dir, &unlock);
            let r = f(&dir);
            if r.is_ok()
                && let (Some(account), Some(store)) = (stale, &unlock.store)
                && let Err(e) = store.delete(&account)
            {
                tracing::warn!("could not remove the old keychain entry: {e}");
            }
            // Reopen even when `f` failed so the app keeps working on whatever is on disk.
            (r, open_live(&dir, &unlock))
        })
        .await
        .map_err(|e| e.to_string())?;
        let (r, opened) = result;
        match opened {
            Ok(live) => {
                *guard = Some(live);
                *lock(&self.limited) = None;
            }
            // Still sealed or unreadable (a failed restore left the old key): recovery screen.
            Err(msg) if is_limited(&msg) => *lock(&self.limited) = Some(msg),
            Err(msg) => return Err(msg),
        }
        drop(guard);
        lock(&self.picked).clear();
        self.refresh_background().await;
        if self.legal_accepted().await
            && let Err(e) = self.start_node().await
        {
            tracing::error!("node did not restart: {e}");
        }
        self.emit(
            "changed",
            json!({ "space_id": "home", "collections": ALL_COLLECTIONS }),
        );
        r
    }

    /// Push freshly authored events to the network and tell the UI.
    pub async fn publish(&self, space: &SpaceId, events: &[SignedEvent]) {
        let node = self.node().await;
        let mut unsent = 0u32;
        for ev in events {
            let Some(node) = &node else {
                unsent += 1;
                continue;
            };
            match ev.to_bytes() {
                Ok(bytes) => {
                    if let Err(e) = node.publish_event(space.0, bytes).await {
                        tracing::warn!("event stored but not gossiped yet: {e}");
                        unsent += 1;
                    }
                }
                Err(e) => tracing::error!("cannot encode event: {e}"),
            }
        }
        if unsent == 0 {
            return;
        }
        let Ok(live) = self.live().await else { return };
        let total = live.set_unsent(live.unsent.load(Ordering::Relaxed).saturating_add(unsent));
        let queued = match &node {
            Some(n) => n.status().await.map_or(0, |s| s.outbox + s.sync_pending),
            None => 0,
        };
        self.emit("sync", json!({ "pending": total.saturating_add(queued) }));
    }

    /// Events waiting for a first sync (see `Live::unsent`).
    pub async fn unsent(&self) -> u32 {
        self.live()
            .await
            .map_or(0, |l| l.unsent.load(Ordering::Relaxed))
    }

    /// The node reported `count` items still owed to the network. Zero means a sync finished
    /// or the queue drained, which also settles what was authored while offline.
    async fn sync_pending(&self, count: u32) {
        if count == 0
            && let Ok(live) = self.live().await
            && live.unsent.load(Ordering::Relaxed) != 0
        {
            live.set_unsent(0);
        }
        let pending = count.saturating_add(self.unsent().await);
        self.emit("sync", json!({ "pending": pending }));
    }

    /// Node status in the shape the UI expects.
    pub async fn node_view(&self) -> Value {
        let Ok(live) = self.live().await else {
            return stopped_view("");
        };
        let handle = live.node.lock().await.as_ref().map(|n| n.handle.clone());
        let Some(h) = handle else {
            return stopped_view("");
        };
        match h.status().await {
            Ok(s) => {
                let l = live.clone();
                let (own, others) = tokio::task::spawn_blocking(move || l.storage_bytes())
                    .await
                    .unwrap_or((0, 0));
                let mut v = status_view(&s, &settings::node_settings(&live.core).ok());
                v["storage"] = json!({ "for_others_bytes": others, "own_bytes": own });
                v
            }
            Err(_) => stopped_view(&h.peer_id().to_string()),
        }
    }
}

fn nat_label(s: &NodeStatus) -> &'static str {
    match s.reachability {
        Reachability::Public => "open",
        Reachability::Private if !s.relay_listen.is_empty() => {
            "behind NAT, reachable through a relay"
        }
        Reachability::Private if s.upnp.is_some() => "behind NAT, port mapped",
        Reachability::Private => "behind NAT",
        Reachability::Unknown => "checking",
    }
}

fn reach_label(r: Reachability) -> &'static str {
    match r {
        Reachability::Unknown => "unknown",
        Reachability::Public => "public",
        Reachability::Private => "private",
    }
}

pub fn stopped_view(peer_id: &str) -> Value {
    json!({
        "running": false, "peer_id": peer_id, "peers": 0, "relaying": 0, "relay_paused": false,
        "reachability": "unknown", "nat": "offline",
        "bandwidth": { "in_bps": 0, "out_bps": 0, "relay_bps": 0 },
        "storage": { "for_others_bytes": 0, "own_bytes": 0 },
        "listen": [], "banned": 0,
    })
}

pub fn status_view(s: &NodeStatus, cfg: &Option<settings::NodeSettings>) -> Value {
    let limit = cfg.as_ref().map(|c| c.relay_bandwidth_bps).unwrap_or(0);
    let relay_bps = if s.relaying_circuits > 0 {
        s.rate_out_bps.min(limit)
    } else {
        0
    };
    let mut listen: Vec<String> = s.external_addrs.clone();
    listen.extend(s.relay_listen.iter().cloned());
    json!({
        "running": true,
        "peer_id": s.peer_id,
        "peers": s.peers,
        "relaying": s.relaying_circuits,
        "relay_paused": cfg.as_ref().map(|c| c.relay_paused).unwrap_or(!s.relay_serving),
        "reachability": reach_label(s.reachability),
        "nat": nat_label(s),
        "bandwidth": { "in_bps": s.rate_in_bps, "out_bps": s.rate_out_bps, "relay_bps": relay_bps },
        // Filled in by `Ctx::node_view` from the real store.
        "storage": { "for_others_bytes": 0, "own_bytes": 0 },
        "listen": listen,
        "banned": s.banned,
    })
}

/// Decode a signal or ephemeral payload: JSON when it parses, else a lossy string.
fn payload_value(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(bytes).into_owned()))
}

fn user_str(peer: &hermod_node::PeerId) -> String {
    adapter::user_of_peer(peer)
        .map(|u| u.to_string())
        .unwrap_or_else(|| peer.to_string())
}

/// Translate node events into UI events. Status is throttled to one per second.
async fn pump(
    ctx: Arc<Ctx>,
    online: Arc<Mutex<HashMap<SpaceId, HashSet<UserId>>>>,
    touched: Touched,
    mut events: mpsc::UnboundedReceiver<NodeEvent>,
) {
    let mut tick = tokio::time::interval(STATUS_EVERY);
    let mut dirty = true;
    loop {
        tokio::select! {
            _ = tick.tick() => {
                if dirty {
                    dirty = false;
                    let status = ctx.node_view().await;
                    ctx.emit("node", json!({ "status": status }));
                }
            }
            ev = events.recv() => {
                let Some(ev) = ev else { break };
                match ev {
                    NodeEvent::EventsIngested { space, .. } => {
                        let label = space_label(&ctx, &SpaceId(space)).await;
                        // The store recorded which collections the applied events touch; nothing
                        // recorded (events waiting on a key, unlocks) means "re-read everything".
                        let set = lock(&touched).remove(&SpaceId(space)).unwrap_or_default();
                        if set.is_empty() {
                            ctx.changed(&label, ALL_COLLECTIONS);
                        } else {
                            let cols: Vec<&str> = set.into_iter().collect();
                            ctx.changed(&label, &cols);
                        }
                    }
                    NodeEvent::Signal { space, from, payload } => {
                        let label = space_label(&ctx, &SpaceId(space)).await;
                        ctx.emit("signal", json!({ "from": user_str(&from), "space_id": label, "payload": payload_value(&payload) }));
                    }
                    NodeEvent::Ephemeral { space, from, kind, payload } => {
                        let label = space_label(&ctx, &SpaceId(space)).await;
                        ctx.emit("ephemeral", json!({ "from": user_str(&from), "space_id": label, "kind": kind, "payload": payload_value(&payload) }));
                    }
                    NodeEvent::Status(_) => dirty = true,
                    NodeEvent::PeerJoined { space, peer } => {
                        if let Some(u) = adapter::user_of_peer(&peer) {
                            lock(&online).entry(SpaceId(space)).or_default().insert(u);
                        }
                        dirty = true;
                        let label = space_label(&ctx, &SpaceId(space)).await;
                        ctx.changed(&label, &["people", "spaces"]);
                    }
                    NodeEvent::PeerLeft { space, peer } => {
                        if let Some(u) = adapter::user_of_peer(&peer)
                            && let Some(set) = lock(&online).get_mut(&SpaceId(space)) {
                                set.remove(&u);
                            }
                        dirty = true;
                        let label = space_label(&ctx, &SpaceId(space)).await;
                        ctx.changed(&label, &["people", "spaces"]);
                    }
                    NodeEvent::SyncPending { count } => ctx.sync_pending(count).await,
                }
            }
        }
    }
}

/// The id the UI uses for a space (`home` or hex).
pub async fn space_label(ctx: &Ctx, space: &SpaceId) -> String {
    let id = space.to_string();
    if let Ok(live) = ctx.live().await
        && let Ok(list) = live.core.spaces()
        && let Some(s) = list.iter().find(|s| s.space_id == id)
    {
        return s.label.clone();
    }
    id
}
