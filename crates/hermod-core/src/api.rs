//! `Core`: the single facade the Tauri bridge and the node talk to.
//!
//! One `Mutex` guards the identity and the SQLite store, so every append (seq, lamport, sign,
//! ingest) is atomic and `Core` can be shared freely across threads.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::backup::{self, BlobBackup, KdfParams, Payload, SpaceBackup, serde_bytes_compat::Bytes};
use crate::blobs::BlobStore;
use crate::crypto::{SpaceKey, random_bytes};
use crate::device;
use crate::error::{Error, Result};
use crate::event::{BlobRef, EventBody, KeyWrap, Role, SignedEvent};
use crate::growth::GrowthConfig;
use crate::identity::{self, Identity};
use crate::ids::{SpaceId, UserId, hex_encode};
use crate::invite::InviteV1;
use crate::keyguard::{KeyMode, Unlock};
use crate::keywrap;
use crate::projections::{
    InviteInfo, MemberInfo, ProjectionConfig, ProjectionCtx, ReportInfo, SpaceInput, SpaceReport,
    genesis_author, initials_of, project, report, search_items,
};
use crate::ratelimit::RateConfig;
use crate::search::SearchHit;
use crate::store::{Ingested, Source, SpaceRow, Store};

pub use crate::projections::AuditEntry;

/// Database file name inside the app data dir.
pub const DB_FILE: &str = "hermod.db";
/// Everything in a data dir that is this install's data: identity, database (with its journal
/// files) and blobs. Wiping and restoring touch exactly these.
pub const DATA_ENTRIES: [&str; 5] = [
    identity::KEY_FILE,
    DB_FILE,
    "hermod.db-wal",
    "hermod.db-shm",
    "blobs",
];
/// Scratch directory inside the data dir where a backup is unpacked before being moved into place.
const RESTORE_DIR: &str = ".restore";
/// Label the UI uses for the home space.
pub const HOME_LABEL: &str = "home";
/// Kind of the home space (the UI keys off this value).
pub const HOME_KIND: &str = "Personal";

const HOME_NAME: &str = "Home";
const HOME_TAGLINE: &str = "Your people, and the best of every Space you\u{2019}re in";
const DEFAULT_CHANNEL: &str = "general";
const PROFILE_KEY: &str = "profile";
/// Local record `creator:<space id>` of the only author whose `space.create` counts for a space.
const CREATOR_PIN_PREFIX: &str = "creator:";
pub(crate) const SETTING_PREFIX: &str = "setting.";
const TZ_SETTING: &str = "tz_offset_secs";
const RECEIPTS_SETTING: &str = "read_receipts";
const MAX_SETTING_KEY: usize = 64;
const MAX_SETTING_VALUE: usize = 4096;
const MAX_VERSION_LEN: usize = 32;
pub(crate) const CACHE_GRACE: Duration = Duration::from_secs(3600);
const SEARCH_LIMIT_MAX: usize = 200;

/// Tunables that default sensibly and are only overridden by tests or advanced builds.
#[derive(Debug, Clone, Default)]
pub struct CoreConfig {
    pub projection: ProjectionConfig,
    pub growth: GrowthConfig,
    pub rate: RateConfig,
    pub backup_kdf: KdfParams,
    /// Keychain entry and passphrase needed to read a protected identity key.
    pub unlock: Unlock,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityInfo {
    pub user_id: String,
    pub handle: String,
    pub name: String,
    pub bio: String,
    pub initials: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<BlobRef>,
    /// Where the secret key is kept at rest.
    pub key_mode: KeyMode,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileInput {
    pub name: String,
    #[serde(default)]
    pub bio: String,
    #[serde(default)]
    pub initials: Option<String>,
    #[serde(default)]
    pub avatar: Option<BlobRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct StoredProfile {
    name: String,
    bio: String,
    initials: String,
    avatar: Option<BlobRef>,
}

/// A space that was just created locally.
#[derive(Debug, Clone)]
pub struct SpaceCreated {
    pub id: SpaceId,
    /// How the UI refers to it (`home` for the home space, else hex).
    pub label: String,
    /// New events, to be handed to the node for gossip.
    pub events: Vec<SignedEvent>,
}

/// Outcome of accepting an invite.
#[derive(Debug, Clone)]
pub struct Joined {
    pub id: SpaceId,
    pub label: String,
    pub name: String,
    pub inviter: UserId,
    /// Multiaddrs from the invite, for the node to dial.
    pub addrs: Vec<String>,
    pub events: Vec<SignedEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InviteOut {
    pub id: String,
    pub code: String,
    pub link: String,
    pub deep_link: String,
}

/// Options for [`Core::invite_create_with`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InviteOptions {
    pub expires_in_secs: Option<u64>,
    pub max_uses: Option<u32>,
    /// Role the joiner gets. Defaults to member.
    pub role: Role,
    pub addrs: Vec<String>,
}

impl Default for InviteOptions {
    fn default() -> Self {
        InviteOptions {
            expires_in_secs: None,
            max_uses: None,
            role: Role::Member,
            addrs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegalStatus {
    pub accepted_version: Option<String>,
    pub accepted_at: Option<i64>,
    pub share_resources: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpaceSummary {
    pub label: String,
    pub space_id: String,
    pub name: String,
    pub kind: String,
    pub home: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpaceUsage {
    pub label: String,
    pub name: String,
    pub events: u64,
    pub event_bytes: u64,
    pub blobs: u32,
    pub blob_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StorageUsage {
    pub spaces: Vec<SpaceUsage>,
    /// Bytes on disk in the blob store, referenced or not.
    pub blob_store_bytes: u64,
    /// Blob bytes no local event references (fetched for others or abandoned uploads).
    pub cache_bytes: u64,
}

/// Result of [`Core::snap_verify`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapVerify {
    pub ok: bool,
    /// Files whose blob is not fully present locally.
    pub missing: Vec<String>,
    /// Files whose stored bytes do not match their hashes or declared size.
    pub corrupt: Vec<String>,
}

pub(crate) struct Inner {
    pub(crate) store: Store,
    pub(crate) identity: Identity,
}

pub struct Core {
    pub(crate) inner: Mutex<Inner>,
    blobs: BlobStore,
    dir: PathBuf,
    user: UserId,
    pub(crate) config: CoreConfig,
}

/// Wall clock in unix milliseconds.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

fn now_secs() -> u64 {
    now_ms().max(0) as u64 / 1000
}

fn mono_of(name: &str) -> String {
    name.trim()
        .chars()
        .next()
        .map(|c| c.to_uppercase().to_string())
        .unwrap_or_default()
}

fn mime_for(name: &str) -> &'static str {
    match name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "weba" | "opus" => "audio/webm",
        "m4a" | "aac" => "audio/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "pdf" => "application/pdf",
        "vtt" => "text/vtt",
        "txt" | "md" => "text/plain",
        _ => "application/octet-stream",
    }
}

/// Events whose arrival can change who is authorized or which keys exist.
fn affects_keys(body: &EventBody) -> bool {
    matches!(
        body,
        EventBody::SpaceRekey { .. }
            | EventBody::MemberRole { .. }
            | EventBody::MemberRemove { .. }
            | EventBody::MemberJoin { .. }
            | EventBody::SpaceCreate { .. }
            | EventBody::InviteCreate { .. }
            | EventBody::InviteRevoke { .. }
    )
}

/// Applied peer events worth a `sync_keys` fold: a rekey that wraps a key for `me`, or a role
/// change that can authorize an earlier rekey. Joins and invites cannot, and backfill is full
/// of them, so they must not each trigger a full fold.
fn changes_my_keys(body: &EventBody, me: &str) -> bool {
    match body {
        EventBody::SpaceRekey { wraps, .. } => wraps.iter().any(|w| w.user == me),
        EventBody::MemberRole { .. }
        | EventBody::MemberRemove { .. }
        | EventBody::SpaceCreate { .. } => true,
        _ => false,
    }
}

impl Inner {
    fn stored_profile(&self) -> Result<StoredProfile> {
        match self.store.kv_get(PROFILE_KEY)? {
            Some(s) => Ok(serde_json::from_str(&s)?),
            None => {
                let handle = self.identity.user_id().short();
                Ok(StoredProfile {
                    initials: initials_of(&handle),
                    name: handle,
                    bio: String::new(),
                    avatar: None,
                })
            }
        }
    }

    fn profile_body(&self) -> Result<EventBody> {
        let p = self.stored_profile()?;
        Ok(EventBody::ProfileSet {
            name: p.name,
            bio: p.bio,
            initials: p.initials,
            avatar: p.avatar,
            x25519: Some(keywrap::own_public_hex(&self.identity)),
        })
    }

    pub(crate) fn row(&self, space: &SpaceId) -> Result<SpaceRow> {
        self.store
            .space(space)?
            .filter(|s| !s.left)
            .ok_or_else(|| Error::UnknownSpace(space.to_string()))
    }

    pub(crate) fn input(&self, row: &SpaceRow) -> Result<SpaceInput> {
        let events = self.store.load_opened(row)?;
        let pin_key = format!("{CREATOR_PIN_PREFIX}{}", row.id);
        let creator = match self.store.kv_get(&pin_key)? {
            Some(c) => c.parse().ok(),
            None => {
                let first = genesis_author(&row.id, &events);
                if let Some(c) = first {
                    self.store.kv_set(&pin_key, &c.to_string())?;
                }
                first
            }
        };
        Ok(SpaceInput {
            id: row.id,
            name: row.name.clone(),
            kind: row.kind.clone(),
            is_home: row.is_home,
            creator,
            events,
        })
    }

    pub(crate) fn ctx(&self, cfg: &CoreConfig, now: i64) -> Result<ProjectionCtx> {
        let mut ctx = ProjectionCtx::new(self.identity.user_id(), now);
        ctx.tz_offset_secs = self
            .store
            .kv_get(&format!("{SETTING_PREFIX}{TZ_SETTING}"))?
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(0);
        ctx.read_markers = self.store.read_arrivals()?;
        ctx.blocks = self.store.blocked()?;
        ctx.follows = self.store.follows()?;
        ctx.hidden = crate::messaging::hidden_set(&self.store)?;
        ctx.muted = crate::messaging::muted_map(&self.store)?;
        ctx.retention_cutoffs = crate::retention::cutoffs(&self.store, now)?;
        ctx.config = cfg.projection.clone();
        ctx.growth = cfg.growth.clone();
        Ok(ctx)
    }

    fn report(&self, cfg: &CoreConfig, space: &SpaceId) -> Result<SpaceReport> {
        let row = self.row(space)?;
        Ok(report(&self.ctx(cfg, now_ms())?, &self.input(&row)?))
    }

    fn require(&self, cfg: &CoreConfig, space: &SpaceId, min: Role) -> Result<SpaceReport> {
        let rep = self.report(cfg, space)?;
        match rep.my_role {
            Some(r) if r >= min => Ok(rep),
            _ => Err(Error::Forbidden(format!(
                "this needs the {} role",
                min.as_str()
            ))),
        }
    }

    /// Signs, stores and returns one local event, then installs any keys it unlocks.
    pub(crate) fn append(&mut self, space: &SpaceId, body: &EventBody) -> Result<SignedEvent> {
        if matches!(body, EventBody::Unknown) {
            return Err(Error::invalid(
                "event body",
                "unknown event types cannot be appended",
            ));
        }
        if let EventBody::SpaceUpdate {
            map_style: Some(m), ..
        } = body
            && !crate::event::valid_map_style(m)
        {
            return Err(Error::invalid("map_style", "must be village or sanctuary"));
        }
        if let EventBody::SpaceUpdate {
            join_pow_bits: Some(b),
            ..
        } = body
            && *b > crate::pow::MAX_JOIN_POW_BITS
        {
            return Err(Error::invalid(
                "join_pow_bits",
                format!("must be at most {}", crate::pow::MAX_JOIN_POW_BITS),
            ));
        }
        let row = self.row(space)?;
        let me = self.identity.user_id();
        let seq = self.store.vector(space)?.get(&me).copied().unwrap_or(0) + 1;
        let lamport = self
            .store
            .max_lamport(space)?
            .max(self.store.lamport_floor(space)?)
            + 1;
        let ev = SignedEvent::create(
            &self.identity,
            &row.key,
            row.epoch,
            *space,
            seq,
            lamport,
            now_ms(),
            body,
        )?;
        self.store.ingest_from(&ev, Source::Local)?;
        if affects_keys(body) {
            self.sync_keys(space)?;
        }
        Ok(ev)
    }

    /// Ingests a peer event and follows up on key changes. Returns the merged result.
    fn ingest(&mut self, ev: &SignedEvent, source: Source) -> Result<Ingested> {
        let mut out = self.store.ingest_from(ev, source)?;
        if out.applied.is_empty() {
            return Ok(out);
        }
        let keys = self.store.all_keys(&ev.space_id)?;
        let me = self.identity.user_id().to_string();
        let relevant = out.applied.iter().any(|id| {
            self.store
                .event_by_id(id)
                .ok()
                .flatten()
                .and_then(|e| keys.get(&e.epoch).and_then(|ks| e.open_any(ks).ok()))
                .is_some_and(|d| changes_my_keys(&d.body, &me))
        });
        if relevant {
            out.applied.extend(self.sync_keys(&ev.space_id)?);
        }
        Ok(out)
    }

    /// Installs keys from authorized `space.rekey` events (per the fold) and applies events that
    /// were waiting for them. Returns ids that became applied. Repeats while new keys appear.
    fn sync_keys(&mut self, space: &SpaceId) -> Result<Vec<String>> {
        let mut applied = Vec::new();
        loop {
            let row = self.row(space)?;
            let rep = report(
                &self.ctx(&CoreConfig::default(), now_ms())?,
                &self.input(&row)?,
            );
            let me = self.identity.user_id().to_string();
            let mut installed = false;
            for entry in rep.audit.iter().filter(|a| a.kind == "space.rekey") {
                let Some(ev) = self.store.event_by_id(&entry.event_id)? else {
                    continue;
                };
                let keys = self.store.keys_for(space, ev.epoch)?;
                let Ok(decoded) = ev.open_any(&keys) else {
                    continue;
                };
                let EventBody::SpaceRekey { epoch, wraps } = decoded.body else {
                    continue;
                };
                if epoch != ev.epoch + 1 {
                    continue;
                }
                for w in wraps.iter().filter(|w| w.user == me) {
                    if let Ok(key) = keywrap::unwrap(&self.identity, &w.sealed_key) {
                        installed |= self.store.add_key(space, epoch, &key)?;
                    }
                }
            }
            if !installed {
                return Ok(applied);
            }
            applied.extend(self.store.unlock(space)?);
        }
    }

    pub(crate) fn new_space(
        &mut self,
        name: &str,
        tagline: &str,
        kind: &str,
        sections: &[&str],
        home: bool,
    ) -> Result<SpaceCreated> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(Error::invalid("space name", "must be 1 to 80 characters"));
        }
        let nonce: [u8; 32] = crate::crypto::random_bytes();
        let id = SpaceId::derive(&self.identity.user_id(), &nonce);
        let row = SpaceRow {
            id,
            key: SpaceKey::random(),
            epoch: 0,
            name: name.to_string(),
            kind: kind.to_string(),
            is_home: home,
            joined_at: now_ms(),
            left: false,
        };
        self.store.add_space(&row)?;
        let bodies = [
            EventBody::SpaceCreate {
                name: name.to_string(),
                kind: kind.to_string(),
                tagline: tagline.to_string(),
                mono: mono_of(name),
                sections: sections.iter().map(|s| s.to_string()).collect(),
                nonce: Some(hex_encode(&nonce)),
            },
            EventBody::ChannelCreate {
                channel_id: DEFAULT_CHANNEL.into(),
                name: DEFAULT_CHANNEL.into(),
                topic: String::new(),
                dm: None,
                guest: false,
            },
            self.profile_body()?,
        ];
        let events = bodies
            .iter()
            .map(|b| self.append(&id, b))
            .collect::<Result<Vec<_>>>()?;
        Ok(SpaceCreated {
            id,
            label: if home {
                HOME_LABEL.into()
            } else {
                id.to_string()
            },
            events,
        })
    }

    /// Publishes a fresh key for the next epoch to every current member.
    fn rekey(&mut self, cfg: &CoreConfig, space: &SpaceId) -> Result<SignedEvent> {
        let rep = self.require(cfg, space, Role::Admin)?;
        let row = self.row(space)?;
        let next = row.epoch + 1;
        let key = SpaceKey::random();
        let mut wraps = Vec::new();
        for m in &rep.members {
            let user: UserId = m.user.parse()?;
            wraps.push(KeyWrap {
                user: m.user.clone(),
                sealed_key: keywrap::wrap(&user, &key)?,
            });
        }
        self.append(space, &EventBody::SpaceRekey { epoch: next, wraps })
    }
}

impl Core {
    /// Opens (or initializes) the data dir: identity, database, blob store, and the home space.
    pub fn open(dir: impl AsRef<Path>) -> Result<Self> {
        Self::open_with(dir, CoreConfig::default())
    }

    pub fn open_with(dir: impl AsRef<Path>, mut config: CoreConfig) -> Result<Self> {
        let dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir)?;
        let identity = Identity::load_or_create_with(&dir, &config.unlock)?;
        // The passphrase is only for reading the key file; do not keep it for the Core's lifetime.
        config.unlock.passphrase = None;
        let store = Store::open_with(&dir.join(DB_FILE), config.rate.clone())?;
        let blobs = BlobStore::open(&dir)?;
        let user = identity.user_id();
        let mut inner = Inner { store, identity };
        if inner.store.home()?.is_none() {
            inner.new_space(HOME_NAME, HOME_TAGLINE, HOME_KIND, &["chat", "feed"], true)?;
        }
        Ok(Core {
            inner: Mutex::new(inner),
            blobs,
            dir,
            user,
            config,
        })
    }

    /// Applies new live-gossip caps (per author rate, burst, event size) without reopening.
    pub fn set_rate(&self, rate: RateConfig) {
        self.lock().store.set_rate(rate);
    }

    pub(crate) fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn user_id(&self) -> UserId {
        self.user
    }

    pub fn blobs(&self) -> &BlobStore {
        &self.blobs
    }

    /// Schema version of the open database.
    pub fn schema_version(&self) -> Result<u32> {
        self.lock().store.schema_version()
    }

    /// Runs SQLite's integrity check on the open database.
    pub fn integrity_check(&self) -> Result<()> {
        self.lock().store.integrity_check()
    }

    // ---- identity and profile ----

    pub fn identity(&self) -> Result<IdentityInfo> {
        let p = self.lock().stored_profile()?;
        Ok(IdentityInfo {
            user_id: self.user.to_string(),
            handle: self.user.short(),
            name: p.name,
            bio: p.bio,
            initials: p.initials,
            avatar: p.avatar,
            key_mode: Identity::mode_in(&self.dir)?.unwrap_or(KeyMode::File),
        })
    }

    /// The 32 byte identity seed the node derives its libp2p keypair from.
    pub fn identity_seed(&self) -> [u8; 32] {
        self.lock().identity.seed()
    }

    /// The 24 word recovery phrase for the identity (D-003). Secret: the caller must show it once
    /// and never log or store it; the buffer zeroizes on drop.
    pub fn identity_phrase(&self) -> Result<zeroize::Zeroizing<String>> {
        self.lock().identity.phrase()
    }

    /// Replaces the identity of a data dir that holds nothing yet (only the empty home space, no
    /// profile) with the one the phrase encodes. Call on a closed dir; the caller wipes first
    /// (start over) when there is data. The key lands as a plain key file; protect it again after.
    pub fn restore_from_phrase(dir: &Path, phrase: &str) -> Result<()> {
        let id = Identity::from_phrase(phrase)?;
        let db = dir.join(DB_FILE);
        if db.exists() {
            let store = Store::open(&db)?;
            let spaces = store.spaces()?;
            if spaces.iter().any(|s| !s.is_home) || store.kv_get(PROFILE_KEY)?.is_some() {
                return Err(Error::invalid(
                    "restore",
                    "this device already holds data, start over first",
                ));
            }
        }
        Self::wipe_data(dir)?;
        id.save(&dir.join(identity::KEY_FILE))
    }

    /// Moves the identity key to `mode` (see [`Identity::protect`]). `passphrase` is required for
    /// the passphrase mode and ignored otherwise. Under one lock so no append races the swap.
    pub fn identity_protect(&self, mode: KeyMode, passphrase: Option<&str>) -> Result<()> {
        let unlock = Unlock {
            store: self.config.unlock.store.clone(),
            passphrase: passphrase.map(|p| zeroize::Zeroizing::new(p.to_string())),
            legacy_account: None,
        };
        self.lock()
            .identity
            .protect(&self.dir, mode, &unlock, self.config.backup_kdf)
    }

    /// Stores the profile locally and publishes `profile.set` into every joined space.
    pub fn profile_set(&self, input: ProfileInput) -> Result<Vec<SignedEvent>> {
        let name = input.name.trim().to_string();
        if name.is_empty() || name.chars().count() > 80 || input.bio.chars().count() > 280 {
            return Err(Error::invalid(
                "profile",
                "name must be 1 to 80 characters, bio at most 280",
            ));
        }
        let initials = input
            .initials
            .filter(|i| !i.trim().is_empty())
            .unwrap_or_else(|| initials_of(&name));
        let stored = StoredProfile {
            name,
            bio: input.bio,
            initials,
            avatar: input.avatar,
        };
        let mut inner = self.lock();
        inner
            .store
            .kv_set(PROFILE_KEY, &serde_json::to_string(&stored)?)?;
        let body = inner.profile_body()?;
        let spaces = inner.store.spaces()?;
        spaces
            .iter()
            .filter(|s| !s.left)
            .map(|s| inner.append(&s.id, &body))
            .collect()
    }

    // ---- spaces ----

    /// Resolves a UI space label (`home` or hex id).
    pub fn resolve_space(&self, label: &str) -> Result<SpaceId> {
        if label == HOME_LABEL {
            return self
                .lock()
                .store
                .home()?
                .map(|h| h.id)
                .ok_or_else(|| Error::UnknownSpace(label.into()));
        }
        let id: SpaceId = label.parse()?;
        self.lock()
            .store
            .space(&id)?
            .map(|s| s.id)
            .ok_or_else(|| Error::UnknownSpace(label.into()))
    }

    pub fn spaces(&self) -> Result<Vec<SpaceSummary>> {
        Ok(self
            .lock()
            .store
            .spaces()?
            .into_iter()
            .filter(|s| !s.left)
            .map(|s| SpaceSummary {
                label: if s.is_home {
                    HOME_LABEL.into()
                } else {
                    s.id.to_string()
                },
                space_id: s.id.to_string(),
                name: s.name,
                kind: s.kind,
                home: s.is_home,
            })
            .collect())
    }

    /// Creates a space: `space.create` (the creator becomes owner and member), a `general`
    /// channel and the creator's profile.
    pub fn space_create(&self, name: &str, tagline: &str, kind: &str) -> Result<SpaceCreated> {
        self.lock().new_space(name, tagline, kind, &["chat"], false)
    }

    /// Leaves a space: publishes `member.leave`, then stops tracking it. Home cannot be left.
    pub fn space_leave(&self, space: &SpaceId) -> Result<Vec<SignedEvent>> {
        let mut inner = self.lock();
        if inner.store.space(space)?.is_some_and(|s| s.is_home) {
            return Err(Error::invalid("space", "home cannot be left"));
        }
        let ev = inner.append(space, &EventBody::MemberLeave {})?;
        inner.store.mark_left(space)?;
        Ok(vec![ev])
    }

    // ---- members, roles, removal, keys ----

    /// Members with roles, owners first.
    pub fn members(&self, space: &SpaceId) -> Result<Vec<MemberInfo>> {
        Ok(self.lock().report(&self.config, space)?.members)
    }

    /// Full governance view (members, invites, audit, reports, my role). Needs membership.
    pub fn space_report(&self, space: &SpaceId) -> Result<SpaceReport> {
        self.lock().require(&self.config, space, Role::Guest)
    }

    /// Owner only. The last owner cannot be demoted.
    pub fn member_set_role(
        &self,
        space: &SpaceId,
        user: &UserId,
        role: Role,
    ) -> Result<SignedEvent> {
        let mut inner = self.lock();
        let rep = inner.require(&self.config, space, Role::Owner)?;
        let owners = rep.members.iter().filter(|m| m.role == Role::Owner).count();
        let target = rep
            .members
            .iter()
            .find(|m| m.user == user.to_string())
            .ok_or_else(|| Error::NotFound("member".into()))?;
        if target.role == Role::Owner && role != Role::Owner && owners <= 1 {
            return Err(Error::Forbidden("the last owner cannot be demoted".into()));
        }
        inner.append(
            space,
            &EventBody::MemberRole {
                user: user.to_string(),
                role,
            },
        )
    }

    /// Removes a member you outrank, then re-keys so they cannot read anything that follows.
    pub fn member_remove(&self, space: &SpaceId, user: &UserId) -> Result<Vec<SignedEvent>> {
        let mut inner = self.lock();
        let rep = inner.require(&self.config, space, Role::Admin)?;
        let mine = rep.my_role.expect("require checked the role");
        let target = rep
            .members
            .iter()
            .find(|m| m.user == user.to_string())
            .ok_or_else(|| Error::NotFound("member".into()))?;
        if *user == self.user || target.role >= mine {
            return Err(Error::Forbidden(
                "you can only remove members below your own role".into(),
            ));
        }
        let last_seq = inner
            .store
            .load_opened(&inner.row(space)?)?
            .iter()
            .filter(|e| e.author == *user)
            .map(|e| e.seq)
            .max();
        let removal = inner.append(
            space,
            &EventBody::MemberRemove {
                user: user.to_string(),
                last_seq,
            },
        )?;
        let rekey = inner.rekey(&self.config, space)?;
        Ok(vec![removal, rekey])
    }

    /// Admin: publishes a new key epoch to the current members.
    pub fn rekey(&self, space: &SpaceId) -> Result<SignedEvent> {
        self.lock().rekey(&self.config, space)
    }

    /// Admin: removes someone else's message or post (tombstone for everyone).
    pub fn content_remove(
        &self,
        space: &SpaceId,
        target_id: &str,
        reason: Option<String>,
    ) -> Result<SignedEvent> {
        let mut inner = self.lock();
        inner.require(&self.config, space, Role::Admin)?;
        inner.append(
            space,
            &EventBody::ContentRemove {
                target_id: target_id.to_string(),
                reason,
            },
        )
    }

    /// Admin audit log: joins, leaves, removals, roles, invites, key epochs, moderation.
    pub fn audit_list(&self, space: &SpaceId) -> Result<Vec<AuditEntry>> {
        Ok(self.lock().require(&self.config, space, Role::Admin)?.audit)
    }

    /// Admin queue of content reports.
    pub fn reports_list(&self, space: &SpaceId) -> Result<Vec<ReportInfo>> {
        Ok(self
            .lock()
            .require(&self.config, space, Role::Admin)?
            .reports)
    }

    // ---- invites ----

    /// Admin invite with defaults: member role, no use limit.
    pub fn invite_create(
        &self,
        space: &SpaceId,
        expires_in_secs: Option<u64>,
        addrs: Vec<String>,
    ) -> Result<InviteOut> {
        self.invite_create_with(
            space,
            InviteOptions {
                expires_in_secs,
                addrs,
                ..InviteOptions::default()
            },
        )
    }

    /// Publishes `invite.create` and returns the code. The code carries the current key epoch.
    pub fn invite_create_with(&self, space: &SpaceId, opts: InviteOptions) -> Result<InviteOut> {
        self.invite_create_event(space, opts).map(|(out, _)| out)
    }

    /// Like [`Core::invite_create_with`], also returning the `invite.create` event so the caller
    /// can publish it at once (joiners need it before they can be admitted).
    pub fn invite_create_event(
        &self,
        space: &SpaceId,
        opts: InviteOptions,
    ) -> Result<(InviteOut, SignedEvent)> {
        let mut inner = self.lock();
        let row = inner.row(space)?;
        if row.is_home {
            return Err(Error::invalid("invite", "home is local only"));
        }
        let rep = inner.require(&self.config, space, Role::Admin)?;
        if opts.role >= Role::Owner || Some(opts.role) > rep.my_role {
            return Err(Error::Forbidden(
                "an invite cannot grant a role above your own, or owner".into(),
            ));
        }
        let id = hex_encode(&random_bytes::<8>());
        let exp = opts.expires_in_secs.map(|s| now_secs().saturating_add(s));
        let ev = inner.append(
            space,
            &EventBody::InviteCreate {
                id: id.clone(),
                exp,
                max_uses: opts.max_uses,
                role: opts.role,
            },
        )?;
        let mut inv = InviteV1::new(
            id.clone(),
            row.id,
            row.key,
            row.epoch,
            ev.lamport,
            row.name,
            self.user,
            opts.addrs,
            exp,
        );
        inv.pow_bits = rep.join_pow_bits;
        Ok((
            InviteOut {
                id,
                code: inv.encode()?,
                link: inv.link()?,
                deep_link: inv.deep_link()?,
            },
            ev,
        ))
    }

    pub fn invite_list(&self, space: &SpaceId) -> Result<Vec<InviteInfo>> {
        Ok(self
            .lock()
            .require(&self.config, space, Role::Admin)?
            .invites)
    }

    /// Revokes an invite and re-keys, so a leaked code cannot read anything published afterwards.
    pub fn invite_revoke(&self, space: &SpaceId, id: &str) -> Result<Vec<SignedEvent>> {
        let mut inner = self.lock();
        let rep = inner.require(&self.config, space, Role::Admin)?;
        if !rep.invites.iter().any(|i| i.id == id) {
            return Err(Error::NotFound(format!("invite {id}")));
        }
        let joined = inner
            .store
            .load_opened(&inner.row(space)?)?
            .iter()
            .filter(|e| matches!(&e.body, EventBody::MemberJoin { invite: Some(i), .. } if i == id))
            .map(|e| e.author.to_string())
            .collect();
        let revoke = inner.append(
            space,
            &EventBody::InviteRevoke {
                id: id.to_string(),
                joined: Some(joined),
            },
        )?;
        let rekey = inner.rekey(&self.config, space)?;
        Ok(vec![revoke, rekey])
    }

    /// Accepts a code, link or deep link. Idempotent for spaces already joined.
    pub fn invite_accept(&self, code: &str) -> Result<Joined> {
        self.invite_accept_cancellable(code, &AtomicBool::new(false))
    }

    /// [`Core::invite_accept`] whose proof-of-work search stops with `Error::Cancelled` once
    /// `cancel` is set. Nothing is stored on cancel.
    pub fn invite_accept_cancellable(&self, code: &str, cancel: &AtomicBool) -> Result<Joined> {
        let inv = InviteV1::parse(code)?;
        inv.check_expiry(now_secs())?;
        // Mined before taking the lock: the work can take seconds.
        let pow = crate::pow::mine(&inv.id, &self.user.to_string(), inv.pow_bits, cancel)?;
        let mut inner = self.lock();
        let mut joined = Joined {
            id: inv.space_id,
            label: inv.space_id.to_string(),
            name: inv.name.clone(),
            inviter: inv.inviter,
            addrs: inv.addrs.clone(),
            events: Vec::new(),
        };
        let mut reopened = false;
        match inner.store.space(&inv.space_id)? {
            Some(s) if !s.left => return Ok(joined),
            Some(_) => {
                inner.store.reopen_space(&inv.space_id)?;
                reopened = true;
            }
            None => {
                let row = SpaceRow {
                    id: inv.space_id,
                    key: inv.space_key.clone(),
                    epoch: inv.epoch,
                    name: inv.name.clone(),
                    kind: "Space".into(),
                    is_home: false,
                    joined_at: now_ms(),
                    left: false,
                };
                inner.store.add_space(&row)?;
            }
        }
        let fresh = !reopened;
        let steps = (|| -> Result<Vec<SignedEvent>> {
            inner
                .store
                .add_key(&inv.space_id, inv.epoch, &inv.space_key)?;
            inner.store.raise_lamport_floor(&inv.space_id, inv.lc)?;
            let join = EventBody::MemberJoin {
                via_invite_from: Some(inv.inviter.to_string()),
                invite: Some(inv.id.clone()),
                pow,
            };
            let profile = inner.profile_body()?;
            Ok(vec![
                inner.append(&inv.space_id, &join)?,
                inner.append(&inv.space_id, &profile)?,
            ])
        })();
        match steps {
            Ok(events) => joined.events = events,
            Err(e) => {
                // Undo the half-made join so a retry starts clean.
                let undo = if fresh {
                    inner.store.forget_space(&inv.space_id)
                } else {
                    inner.store.mark_left(&inv.space_id)
                };
                undo?;
                return Err(e);
            }
        }
        Ok(joined)
    }

    // ---- events ----

    /// Signs and stores one event authored by the local user.
    pub fn append(&self, space: &SpaceId, body: EventBody) -> Result<SignedEvent> {
        self.lock().append(space, &body)
    }

    /// Stores an event received over live gossip (per-author rate caps apply).
    pub fn ingest(&self, ev: SignedEvent) -> Result<Ingested> {
        self.lock().ingest(&ev, Source::Gossip)
    }

    /// Stores an event received during sync or backfill (no rate cap).
    pub fn ingest_sync(&self, ev: SignedEvent) -> Result<Ingested> {
        self.lock().ingest(&ev, Source::Sync)
    }

    /// Highest applied seq per author, for sync requests.
    pub fn vector(&self, space: &SpaceId) -> Result<BTreeMap<UserId, u64>> {
        self.lock().store.vector(space)
    }

    /// Events a peer with `vector` is missing.
    pub fn missing_since(
        &self,
        space: &SpaceId,
        vector: &BTreeMap<UserId, u64>,
    ) -> Result<Vec<SignedEvent>> {
        self.missing_page(space, vector, usize::MAX)
    }

    /// At most `limit` events a peer with `vector` is missing, in `(author, seq)` order.
    pub fn missing_page(
        &self,
        space: &SpaceId,
        vector: &BTreeMap<UserId, u64>,
        limit: usize,
    ) -> Result<Vec<SignedEvent>> {
        self.lock().store.events_since(space, vector, limit)
    }

    /// `(waiting for a gap, waiting for a key)` event counts.
    pub fn pending(&self, space: &SpaceId) -> Result<(u64, u64)> {
        let inner = self.lock();
        let all = inner.store.pending_count(space)?;
        let locked = inner.store.locked_count(space)?;
        Ok((all - locked, locked))
    }

    // ---- read state, blocks, follows (device-local) ----

    /// Marks everything currently in a channel as read. With receipts on, returns the `read.mark`
    /// event just appended; the caller must gossip it, or peers only see it on the next full sync.
    /// `upto_arrival` is the device-local watermark the viewer had loaded; events that arrived
    /// after it (while the mark request waited) stay unread.
    pub fn mark_read(
        &self,
        space: &SpaceId,
        channel: &str,
        upto_arrival: Option<u64>,
    ) -> Result<Option<SignedEvent>> {
        let mut inner = self.lock();
        let lamport = inner.store.max_lamport(space)?;
        inner
            .store
            .set_read_marker(space, channel, lamport, upto_arrival)?;
        let receipts = inner
            .store
            .kv_get(&format!("{SETTING_PREFIX}{RECEIPTS_SETTING}"))?
            .as_deref()
            == Some("1");
        if !receipts {
            return Ok(None);
        }
        inner
            .append(
                space,
                &EventBody::ReadMark {
                    channel_id: channel.to_string(),
                    upto: lamport,
                },
            )
            .map(Some)
    }

    /// Read markers keyed `space/channel` as the UI labels them.
    pub fn read_markers(&self) -> Result<BTreeMap<String, u64>> {
        let inner = self.lock();
        let homes: Option<SpaceId> = inner.store.home()?.map(|h| h.id);
        Ok(inner
            .store
            .read_markers()?
            .into_iter()
            .map(|((s, c), l)| {
                (
                    format!(
                        "{}/{c}",
                        if Some(s) == homes {
                            HOME_LABEL.to_string()
                        } else {
                            s.to_string()
                        }
                    ),
                    l,
                )
            })
            .collect())
    }

    pub fn block_user(&self, user: &UserId) -> Result<()> {
        if *user == self.user {
            return Err(Error::invalid("block", "you cannot block yourself"));
        }
        self.lock().store.block_user(&user.to_string(), now_ms())
    }

    pub fn unblock_user(&self, user: &UserId) -> Result<()> {
        self.lock().store.unblock_user(&user.to_string())
    }

    /// Blocked users with the time (ms since epoch) each was blocked.
    pub fn blocked_since(&self) -> Result<Vec<(String, i64)>> {
        self.lock().store.blocked_since()
    }

    /// Remembers a blob's name and content type so it survives restarts.
    pub fn blob_meta_put(&self, b: &BlobRef) -> Result<()> {
        if b.mime.is_empty() {
            return Ok(());
        }
        self.lock().store.blob_meta_put(&b.hash, &b.name, &b.mime)
    }

    pub fn blob_mime(&self, hash: &str) -> Result<Option<String>> {
        self.lock().store.blob_mime(hash)
    }

    pub fn blocked(&self) -> Result<BTreeSet<String>> {
        self.lock().store.blocked()
    }

    /// Follows a user or a space (`kind` is `user` or `space`; spaces by UI label).
    pub fn follow(&self, kind: &str, target: &str) -> Result<()> {
        if !matches!(kind, "user" | "space") || target.is_empty() || target.len() > 128 {
            return Err(Error::invalid("follow", "kind must be user or space"));
        }
        self.lock().store.follow(kind, target)
    }

    pub fn unfollow(&self, kind: &str, target: &str) -> Result<()> {
        self.lock().store.unfollow(kind, target)
    }

    pub fn follows(&self) -> Result<BTreeSet<(String, String)>> {
        self.lock().store.follows()
    }

    // ---- devices ----

    /// Vouches for another device of this identity (`device.link` in the home space).
    pub fn device_link(&self, device_pub: &[u8; 32]) -> Result<SignedEvent> {
        let mut inner = self.lock();
        let home = inner
            .store
            .home()?
            .ok_or_else(|| Error::UnknownSpace(HOME_LABEL.into()))?;
        let cert = device::make_cert(&inner.identity, device_pub);
        inner.append(
            &home.id,
            &EventBody::DeviceLink {
                device_pub: hex_encode(device_pub),
                cert,
            },
        )
    }

    pub fn device_revoke(&self, device_pub: &[u8; 32]) -> Result<SignedEvent> {
        let mut inner = self.lock();
        let home = inner
            .store
            .home()?
            .ok_or_else(|| Error::UnknownSpace(HOME_LABEL.into()))?;
        inner.append(
            &home.id,
            &EventBody::DeviceRevoke {
                device_pub: hex_encode(device_pub),
            },
        )
    }

    // ---- projections and search ----

    /// All projections keyed like the old `Seed`: `{people, spaces, collections}`.
    pub fn snapshot(&self) -> Result<Value> {
        self.snapshot_at(now_ms())
    }

    /// Like [`Core::snapshot`] with an explicit clock (relative times, expiry, activity windows).
    pub fn snapshot_at(&self, now_ms: i64) -> Result<Value> {
        let inner = self.lock();
        let ctx = inner.ctx(&self.config, now_ms)?;
        let inputs = inner
            .store
            .spaces()?
            .into_iter()
            .filter(|s| !s.left)
            .map(|s| inner.input(&s))
            .collect::<Result<Vec<_>>>()?;
        Ok(serde_json::to_value(project(&ctx, &inputs))?)
    }

    /// Full-text search over decrypted content, newest index built on demand.
    pub fn search_query(
        &self,
        q: &str,
        space: Option<&SpaceId>,
        kinds: &[String],
        limit: usize,
    ) -> Result<Vec<SearchHit>> {
        let mut inner = self.lock();
        let rows: Vec<SpaceRow> = match space {
            Some(id) => vec![inner.row(id)?],
            None => inner
                .store
                .spaces()?
                .into_iter()
                .filter(|s| !s.left)
                .collect(),
        };
        for row in &rows {
            if inner.store.search_stale(&row.id)? {
                let items = search_items(&inner.identity.user_id().to_string(), &inner.input(row)?);
                inner.store.search_reindex(&row.id, &items)?;
            }
        }
        let ids: Vec<SpaceId> = rows.iter().map(|r| r.id).collect();
        let hits = inner
            .store
            .search_query(q, &ids, kinds, limit.clamp(1, SEARCH_LIMIT_MAX))?;
        // Past-retention messages stay indexed (the index follows the log) but never surface.
        let cuts = crate::retention::cutoffs(&inner.store, now_ms())?;
        Ok(crate::retention::visible_hits(hits, &cuts))
    }

    // ---- skein seals ----

    /// Checks that every blob a snap references is present and hashes correctly (K-002, K-009).
    pub fn snap_verify(&self, space: &SpaceId, snap_id: &str) -> Result<SnapVerify> {
        let inner = self.lock();
        let row = inner.row(space)?;
        let mut files = Vec::new();
        for ev in inner.store.load_opened(&row)? {
            if let EventBody::SnapCreate {
                snap_id: id,
                files: f,
                ..
            } = ev.body
                && id == snap_id
            {
                files = f;
                break;
            }
        }
        if files.is_empty()
            && !inner.store.load_opened(&row)?.iter().any(
                |e| matches!(&e.body, EventBody::SnapCreate { snap_id: id, .. } if id == snap_id),
            )
        {
            return Err(Error::NotFound(format!("snap {snap_id}")));
        }
        let mut out = SnapVerify {
            ok: true,
            missing: Vec::new(),
            corrupt: Vec::new(),
        };
        for f in files.iter().filter(|f| f.blob.is_some()) {
            let blob = f.blob.as_ref().expect("filtered");
            match self.blobs.manifest(&blob.hash)? {
                Some(m) if m.size == blob.size && self.blobs.missing(&blob.hash)?.is_empty() => {
                    if self.blobs.read_all(&blob.hash).is_err() {
                        out.corrupt.push(f.path.clone());
                    }
                }
                Some(m) if m.size != blob.size => out.corrupt.push(f.path.clone()),
                _ => out.missing.push(f.path.clone()),
            }
        }
        out.ok = out.missing.is_empty() && out.corrupt.is_empty();
        Ok(out)
    }

    // ---- storage and backup ----

    /// Bytes per space (events and referenced blobs) plus unreferenced cache.
    pub fn storage_usage(&self) -> Result<StorageUsage> {
        let inner = self.lock();
        let mut spaces = Vec::new();
        let mut referenced: HashSet<String> = HashSet::new();
        for row in inner.store.spaces()?.into_iter().filter(|s| !s.left) {
            let (events, event_bytes) = inner.store.space_usage(&row.id)?;
            let mut seen: BTreeMap<String, u64> = BTreeMap::new();
            for ev in inner.store.load_opened(&row)? {
                for b in ev.body.blob_refs() {
                    seen.insert(b.hash.clone(), b.size);
                }
            }
            referenced.extend(seen.keys().cloned());
            spaces.push(SpaceUsage {
                label: if row.is_home {
                    HOME_LABEL.into()
                } else {
                    row.id.to_string()
                },
                name: row.name,
                events,
                event_bytes,
                blobs: seen.len() as u32,
                blob_bytes: seen.values().sum(),
            });
        }
        let total = self.blobs.disk_bytes()?;
        let kept: u64 = referenced
            .iter()
            .filter_map(|h| self.blobs.size(h).ok())
            .sum();
        Ok(StorageUsage {
            spaces,
            blob_store_bytes: total,
            cache_bytes: total.saturating_sub(kept),
        })
    }

    /// Deletes blobs no local event references (older than an hour). Returns bytes freed.
    pub fn storage_clear_cache(&self) -> Result<u64> {
        self.storage_clear_cache_with(CACHE_GRACE)
    }

    /// Like [`Core::storage_clear_cache`] with an explicit age floor for unreferenced blobs.
    pub fn storage_clear_cache_with(&self, grace: Duration) -> Result<u64> {
        self.blobs.gc(&self.referenced_blobs()?, grace)
    }

    /// Evicts the oldest unreferenced blobs until the cache held for others fits `limit` bytes.
    /// Blobs a local event references (our own uploads included) are never touched. Returns bytes freed.
    pub fn storage_trim_cache(&self, limit: u64) -> Result<u64> {
        self.storage_trim_cache_with(limit, CACHE_GRACE)
    }

    /// Like [`Core::storage_trim_cache`] with an explicit age floor for evictable blobs.
    pub fn storage_trim_cache_with(&self, limit: u64, grace: Duration) -> Result<u64> {
        let excess = self.storage_usage()?.cache_bytes.saturating_sub(limit);
        if excess == 0 {
            return Ok(0);
        }
        let victims = self
            .blobs
            .oldest_unreferenced(&self.referenced_blobs()?, grace, excess)?;
        let mut keep: HashSet<String> = self.blobs.list()?.into_iter().collect();
        for v in &victims {
            keep.remove(v);
        }
        self.blobs.gc(&keep, grace)
    }

    /// Hashes of blobs any event of a space we are still in refers to.
    fn referenced_blobs(&self) -> Result<HashSet<String>> {
        let inner = self.lock();
        let mut keep = HashSet::new();
        for row in inner.store.spaces()?.into_iter().filter(|s| !s.left) {
            for ev in inner.store.load_opened(&row)? {
                keep.extend(ev.body.blob_refs().into_iter().map(|b| b.hash.clone()));
            }
        }
        Ok(keep)
    }

    /// Writes an encrypted backup (identity, spaces, keys, log, local state, optionally blobs).
    pub fn backup_export(&self, path: &Path, passphrase: &str, include_blobs: bool) -> Result<()> {
        // The core lock covers only the log and keys; blob chunks are read after it is released.
        let inner = self.lock();
        let mut spaces = Vec::new();
        let mut blob_ids = BTreeSet::new();
        for row in inner.store.spaces()? {
            let events = inner.store.all_events(&row.id)?;
            let keys = inner.store.all_keys(&row.id)?;
            if include_blobs {
                for ev in inner.store.load_opened(&row)? {
                    blob_ids.extend(ev.body.blob_refs().into_iter().map(|b| b.hash.clone()));
                }
            }
            spaces.push(SpaceBackup {
                id: row.id,
                name: row.name,
                kind: row.kind,
                is_home: row.is_home,
                joined_at: row.joined_at,
                left: row.left,
                keys: keys
                    .into_iter()
                    .flat_map(|(e, ks)| ks.into_iter().map(move |k| (e, k)))
                    .collect(),
                events: events
                    .iter()
                    .map(|e| e.to_bytes().map(Bytes))
                    .collect::<Result<_>>()?,
            });
        }
        let mut payload = Payload {
            v: 1,
            identity_seed: inner.identity.seed(),
            spaces,
            kv: inner.store.kv_prefix("")?,
            read_markers: inner
                .store
                .read_markers()?
                .into_iter()
                .map(|((s, c), l)| (s, c, l))
                .collect(),
            blocks: inner.store.blocked()?.into_iter().collect(),
            follows: inner.store.follows()?.into_iter().collect(),
            blobs: Vec::new(),
        };
        drop(inner);
        let mut blobs = Vec::new();
        for id in blob_ids {
            let Some(m) = self.blobs.manifest(&id)? else {
                continue;
            };
            if !self.blobs.missing(&id)?.is_empty() {
                continue;
            }
            let chunks = m
                .chunks
                .iter()
                .enumerate()
                .map(|(i, h)| Ok((hex_encode(h), Bytes(self.blobs.read_chunk(&id, i as u32)?))))
                .collect::<Result<_>>()?;
            blobs.push(BlobBackup {
                id,
                manifest: m.to_bytes(),
                chunks,
            });
        }
        payload.blobs = blobs;
        backup::write_file(
            path,
            &backup::seal(&payload, passphrase, self.config.backup_kdf)?,
        )
    }

    /// Restores a backup into an empty data dir. Call [`Core::open`] on the dir afterwards.
    pub fn backup_import(dir: &Path, file: &Path, passphrase: &str) -> Result<()> {
        let payload = backup::open(&fs::read(file)?, passphrase)?;
        fs::create_dir_all(dir)?;
        if dir.join(identity::KEY_FILE).exists() || dir.join(DB_FILE).exists() {
            return Err(Error::invalid(
                "restore",
                "the data directory already holds an identity",
            ));
        }
        // Restore beside the target, then move into place: a failure leaves `dir` untouched.
        let tmp = dir.join(RESTORE_DIR);
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp)?;
        let moved = Self::restore_into(&tmp, &payload).and_then(|()| {
            // The identity moves last: its presence is what marks `dir` as already restored.
            for name in [
                DB_FILE,
                "hermod.db-wal",
                "hermod.db-shm",
                "blobs",
                identity::KEY_FILE,
            ] {
                match fs::rename(tmp.join(name), dir.join(name)) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
            }
            Ok(())
        });
        let _ = fs::remove_dir_all(&tmp);
        moved
    }

    fn restore_into(dir: &Path, payload: &backup::Payload) -> Result<()> {
        Identity::from_seed(payload.identity_seed).save(&dir.join(identity::KEY_FILE))?;
        let mut store = Store::open(&dir.join(DB_FILE))?;
        for sp in &payload.spaces {
            let mut keys = sp.keys.clone();
            keys.sort_by_key(|(e, _)| *e);
            let (epoch, key) = keys
                .first()
                .cloned()
                .ok_or_else(|| Error::invalid("backup", "space without a key"))?;
            store.add_space(&SpaceRow {
                id: sp.id,
                key,
                epoch,
                name: sp.name.clone(),
                kind: sp.kind.clone(),
                is_home: sp.is_home,
                joined_at: sp.joined_at,
                left: false,
            })?;
            for (e, k) in &keys {
                store.add_key(&sp.id, *e, k)?;
            }
            for raw in &sp.events {
                match store.ingest_from(&SignedEvent::from_bytes(&raw.0)?, Source::Sync) {
                    Ok(_) | Err(Error::Equivocation) => {}
                    Err(e) => return Err(e),
                }
            }
            if sp.left {
                store.mark_left(&sp.id)?;
            }
        }
        for (k, v) in &payload.kv {
            store.kv_set(k, v)?;
        }
        for (s, c, l) in &payload.read_markers {
            store.set_read_marker(s, c, *l, None)?;
        }
        for u in &payload.blocks {
            store.block_user(u, 0)?;
        }
        for (k, t) in &payload.follows {
            store.follow(k, t)?;
        }
        let blobs = BlobStore::open(dir)?;
        for b in &payload.blobs {
            blobs.put_manifest(&b.id, &b.manifest)?;
            for (h, data) in &b.chunks {
                blobs.put_chunk(h, &data.0)?;
            }
        }
        Ok(())
    }

    /// Deletes this install's data (identity, database, blobs). Irreversible without a backup.
    pub fn wipe_data(dir: &Path) -> Result<()> {
        for name in DATA_ENTRIES {
            let p = dir.join(name);
            let r = if p.is_dir() {
                fs::remove_dir_all(&p)
            } else {
                fs::remove_file(&p)
            };
            match r {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }

    // ---- local settings and legal ----

    pub fn setting_get(&self, key: &str) -> Result<Option<String>> {
        self.lock().store.kv_get(&format!("{SETTING_PREFIX}{key}"))
    }

    pub fn setting_set(&self, key: &str, value: &str) -> Result<()> {
        let ok_key = !key.is_empty()
            && key.len() <= MAX_SETTING_KEY
            && key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
        if !ok_key || value.len() > MAX_SETTING_VALUE {
            return Err(Error::invalid("setting", "bad key or value too large"));
        }
        self.lock()
            .store
            .kv_set(&format!("{SETTING_PREFIX}{key}"), value)
    }

    pub fn settings(&self) -> Result<BTreeMap<String, String>> {
        Ok(self
            .lock()
            .store
            .kv_prefix(SETTING_PREFIX)?
            .into_iter()
            .map(|(k, v)| (k[SETTING_PREFIX.len()..].to_string(), v))
            .collect())
    }

    pub fn legal_status(&self) -> Result<LegalStatus> {
        let inner = self.lock();
        Ok(LegalStatus {
            accepted_version: inner.store.kv_get("legal.version")?,
            accepted_at: inner
                .store
                .kv_get("legal.accepted_at")?
                .and_then(|v| v.parse().ok()),
            share_resources: inner.store.kv_get("legal.share_resources")?.as_deref() == Some("1"),
        })
    }

    pub fn legal_accept(&self, version: &str, share_resources: bool) -> Result<LegalStatus> {
        if version.is_empty() || version.len() > MAX_VERSION_LEN {
            return Err(Error::invalid("legal version", "empty or too long"));
        }
        {
            let inner = self.lock();
            inner.store.kv_set("legal.version", version)?;
            inner
                .store
                .kv_set("legal.accepted_at", &now_ms().to_string())?;
            inner.store.kv_set(
                "legal.share_resources",
                if share_resources { "1" } else { "0" },
            )?;
        }
        self.legal_status()
    }

    // ---- blobs ----

    pub fn blob_put_bytes(&self, name: &str, bytes: &[u8]) -> Result<BlobRef> {
        let info = self.blobs.put_bytes(bytes)?;
        let r = BlobRef {
            hash: info.hash,
            size: info.size,
            name: name.to_string(),
            mime: mime_for(name).into(),
        };
        self.blob_meta_put(&r)?;
        Ok(r)
    }

    pub fn blob_put_path(&self, path: &Path) -> Result<BlobRef> {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();
        let info = self.blobs.put_path(path)?;
        let r = BlobRef {
            hash: info.hash,
            size: info.size,
            mime: mime_for(&name).into(),
            name,
        };
        self.blob_meta_put(&r)?;
        Ok(r)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_role_changes_and_my_wraps_trigger_a_key_sync() {
        let join = EventBody::MemberJoin {
            via_invite_from: None,
            invite: None,
            pow: None,
        };
        assert!(!changes_my_keys(&join, "me"));
        let rekey = |user: &str| EventBody::SpaceRekey {
            epoch: 1,
            wraps: vec![KeyWrap {
                user: user.into(),
                sealed_key: String::new(),
            }],
        };
        assert!(changes_my_keys(&rekey("me"), "me"));
        assert!(!changes_my_keys(&rekey("you"), "me"));
        assert!(changes_my_keys(
            &EventBody::MemberRemove {
                user: "x".into(),
                last_seq: None
            },
            "me"
        ));
    }
}
