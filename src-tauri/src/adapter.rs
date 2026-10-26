//! `NodeStore` over `hermod-core`: the seam between the network node and the event log.
//!
//! The node only moves opaque bytes; everything here decodes, verifies (inside `Core::ingest`)
//! and stores them. Events that applied and carry something worth a desktop notification are
//! decrypted once more and handed to the runtime through [`Notice`].

use crate::ctx::{Touched, collections_for};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use hermod_core::api::DB_FILE;
use hermod_core::blobs::Manifest;
use hermod_core::event::Decoded;
use hermod_core::ids::{self, SpaceId, UserId};
use hermod_core::store::{IngestStatus, Store};
use hermod_core::{Core, EventBody, SignedEvent};
use hermod_node::store::{
    Author, BlobId, IngestOutcome, ManifestInfo, NodeStore, StoreError, StoreResult,
};
use tokio::sync::mpsc::UnboundedSender;

/// Events read from SQLite per step while filling a sync page, so the page's byte budget
/// bounds memory (at most this many maximum-size events are in memory beyond the budget).
const SYNC_READ_STEP: usize = 8;

/// A remote event that applied, decrypted for notification and blob-metadata purposes.
#[derive(Debug, Clone)]
pub struct Notice {
    pub space: SpaceId,
    pub author: UserId,
    pub ts: i64,
    pub body: EventBody,
}

pub struct CoreStore {
    core: Arc<Core>,
    notices: UnboundedSender<Notice>,
    /// Read-only second connection, used only to look up space keys for decryption.
    reader: Mutex<Option<Store>>,
    touched: Touched,
}

/// Decrypt a remote event with the keys held for ITS epoch (a rekey changes them, so nothing
/// is cached per space).
fn open_notice(store: &Store, ev: &SignedEvent) -> Option<Decoded> {
    let keys = store.keys_for(&ev.space_id, ev.epoch).ok()?;
    ev.open_any(&keys).ok()
}

fn serr(e: impl std::fmt::Display) -> StoreError {
    StoreError(e.to_string())
}

pub fn blob_hex(id: &BlobId) -> String {
    ids::hex_encode(id)
}

impl CoreStore {
    pub fn new(core: Arc<Core>, notices: UnboundedSender<Notice>, touched: Touched) -> Self {
        let reader = Store::open(&core.dir().join(DB_FILE))
            .map_err(|e| tracing::warn!("notification key reader unavailable: {e}"))
            .ok();
        CoreStore {
            core,
            notices,
            reader: Mutex::new(reader),
            touched,
        }
    }

    fn announce(&self, ev: &SignedEvent) {
        if ev.author == self.core.user_id() {
            return;
        }
        let guard = self.reader.lock().unwrap_or_else(|e| e.into_inner());
        let opened = guard.as_ref().and_then(|store| open_notice(store, ev));
        drop(guard);
        if let Some(d) = opened {
            let tag = serde_json::to_value(&d.body)
                .ok()
                .and_then(|v| v.get("t").and_then(|t| t.as_str().map(str::to_string)))
                .unwrap_or_default();
            self.touched
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .entry(ev.space_id)
                .or_default()
                .extend(collections_for(&tag).iter().copied());
            let _ = self.notices.send(Notice {
                space: ev.space_id,
                author: ev.author,
                ts: ev.ts,
                body: d.body,
            });
        }
    }

    fn ingest_with(
        &self,
        space: &hermod_node::store::SpaceId,
        bytes: &[u8],
        apply: impl FnOnce(&Core, SignedEvent) -> hermod_core::Result<hermod_core::store::Ingested>,
    ) -> StoreResult<IngestOutcome> {
        let ev = match SignedEvent::from_bytes(bytes) {
            Ok(ev) => ev,
            Err(e) => return Ok(IngestOutcome::Rejected(e.to_string())),
        };
        if ev.space_id.0 != *space {
            return Ok(IngestOutcome::Rejected(
                "event belongs to another space".into(),
            ));
        }
        let copy = ev.clone();
        Ok(match apply(&self.core, ev) {
            Ok(i) => match i.status {
                IngestStatus::Applied => {
                    self.announce(&copy);
                    IngestOutcome::Applied
                }
                IngestStatus::Duplicate => IngestOutcome::Duplicate,
                _ => IngestOutcome::MissingPrior,
            },
            Err(e) => IngestOutcome::Rejected(e.to_string()),
        })
    }

    fn manifest(&self, blob: &BlobId) -> Option<Manifest> {
        self.core.blobs().manifest(&blob_hex(blob)).ok().flatten()
    }
}

impl NodeStore for CoreStore {
    fn joined_spaces(&self) -> Vec<hermod_node::store::SpaceId> {
        // Home is local only: joining its topic would advertise that it exists.
        self.core
            .spaces()
            .unwrap_or_default()
            .into_iter()
            .filter(|s| !s.home)
            .filter_map(|s| s.space_id.parse::<SpaceId>().ok())
            .map(|s| s.0)
            .collect()
    }

    fn vector(&self, space: &hermod_node::store::SpaceId) -> BTreeMap<Author, u64> {
        self.core
            .vector(&SpaceId(*space))
            .unwrap_or_default()
            .into_iter()
            .map(|(u, n)| (u.to_string(), n))
            .collect()
    }

    fn events_after(
        &self,
        space: &hermod_node::store::SpaceId,
        vector: &BTreeMap<Author, u64>,
        limit: usize,
        max_bytes: usize,
    ) -> Vec<Vec<u8>> {
        let mut remote: BTreeMap<UserId, u64> = vector
            .iter()
            .filter_map(|(a, n)| a.parse::<UserId>().ok().map(|u| (u, *n)))
            .collect();
        let mut out: Vec<Vec<u8>> = Vec::new();
        let mut total = 0usize;
        // Small SQL pages in `(author, seq)` order (the receiver applies per author), each
        // continuing from the last seq taken, so the byte budget stops the reading instead of
        // a full page of maximum-size events being loaded and cut afterwards.
        while out.len() < limit {
            let room = (limit - out.len()).min(SYNC_READ_STEP);
            let Ok(page) = self.core.missing_page(&SpaceId(*space), &remote, room) else {
                break;
            };
            let got = page.len();
            for e in page {
                let Ok(bytes) = e.to_bytes() else { continue };
                if !out.is_empty() && total + bytes.len() > max_bytes {
                    return out;
                }
                total += bytes.len();
                out.push(bytes);
                remote.insert(e.author, e.seq);
            }
            if got < room {
                break;
            }
        }
        out
    }

    fn ingest(
        &self,
        space: &hermod_node::store::SpaceId,
        bytes: &[u8],
    ) -> StoreResult<IngestOutcome> {
        self.ingest_with(space, bytes, Core::ingest_sync)
    }

    fn ingest_gossip(
        &self,
        space: &hermod_node::store::SpaceId,
        bytes: &[u8],
    ) -> StoreResult<IngestOutcome> {
        // Live gossip: the per-author rate cap applies (backfill via `ingest` is exempt).
        self.ingest_with(space, bytes, Core::ingest)
    }

    fn blob_has(&self, blob: &BlobId) -> bool {
        self.core
            .blobs()
            .is_complete(&blob_hex(blob))
            .unwrap_or(false)
    }

    fn blob_manifest(&self, blob: &BlobId) -> Option<Vec<u8>> {
        self.manifest(blob).map(|m| m.to_bytes())
    }

    fn blob_put_manifest(&self, blob: &BlobId, bytes: &[u8]) -> StoreResult<ManifestInfo> {
        let m = self
            .core
            .blobs()
            .put_manifest(&blob_hex(blob), bytes)
            .map_err(serr)?;
        Ok(ManifestInfo {
            size: m.size,
            chunks: m.chunks,
        })
    }

    fn blob_missing(&self, blob: &BlobId) -> Vec<u32> {
        self.core
            .blobs()
            .missing(&blob_hex(blob))
            .unwrap_or_default()
    }

    fn event_author(&self, bytes: &[u8]) -> Option<Author> {
        SignedEvent::from_bytes(bytes)
            .ok()
            .map(|e| e.author.to_string())
    }

    fn blob_chunk(&self, blob: &BlobId, idx: u32) -> Option<Vec<u8>> {
        self.core.blobs().read_chunk(&blob_hex(blob), idx).ok()
    }

    fn blob_put_chunk(&self, blob: &BlobId, idx: u32, bytes: &[u8]) -> StoreResult<()> {
        let m = self.manifest(blob).ok_or_else(|| serr("unknown blob"))?;
        let hash = m
            .chunks
            .get(idx as usize)
            .ok_or_else(|| serr("chunk index out of range"))?;
        self.core
            .blobs()
            .put_chunk(&blob_hex(hash), bytes)
            .map_err(serr)
    }
}

/// Persistent identity seed for the libp2p keypair, taken from the open `Core` so it works in
/// every key storage mode (file, keychain, passphrase).
pub fn identity_seed(core: &hermod_core::Core) -> [u8; 32] {
    core.identity_seed()
}

/// libp2p peer id of a user (their ed25519 key).
pub fn peer_of_user(user: &UserId) -> Option<hermod_node::PeerId> {
    let pk = libp2p::identity::ed25519::PublicKey::try_from_bytes(&user.0).ok()?;
    Some(libp2p::identity::PublicKey::from(pk).to_peer_id())
}

/// User id behind an ed25519 peer id (identity multihash of the protobuf public key).
pub fn user_of_peer(peer: &hermod_node::PeerId) -> Option<UserId> {
    let b = peer.to_bytes();
    // [0x00 identity code][0x24 len 36][0x08 0x01 0x12 0x20 ed25519 key type + len][32 key bytes]
    if b.len() == 38 && b[..6] == [0x00, 0x24, 0x08, 0x01, 0x12, 0x20] {
        let key: [u8; 32] = b[6..].try_into().ok()?;
        Some(UserId(key))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peer_user_round_trip() {
        let kp = libp2p::identity::ed25519::Keypair::generate();
        let peer = libp2p::identity::PublicKey::from(kp.public()).to_peer_id();
        let user = user_of_peer(&peer).expect("ed25519 peer id");
        assert_eq!(peer_of_user(&user), Some(peer));
    }

    #[test]
    fn notices_open_events_sealed_under_a_later_epoch() {
        use hermod_core::crypto::SpaceKey;
        use hermod_core::identity::Identity;
        use hermod_core::store::SpaceRow;
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db")).unwrap();
        let space = SpaceId([7; 32]);
        let (old, new) = (SpaceKey::random(), SpaceKey::random());
        store
            .add_space(&SpaceRow {
                id: space,
                key: old,
                epoch: 0,
                name: "t".into(),
                kind: "Team".into(),
                is_home: false,
                joined_at: 0,
                left: false,
            })
            .unwrap();
        store.add_key(&space, 1, &new).unwrap();
        let author = Identity::generate();
        let body = EventBody::Unknown;
        let ev = SignedEvent::create(&author, &new, 1, space, 1, 1, 0, &body).unwrap();
        assert!(open_notice(&store, &ev).is_some());
    }

    fn post(text: &str, id: &str) -> EventBody {
        EventBody::MessagePost {
            channel_id: "general".into(),
            msg_id: id.into(),
            text: text.into(),
            reply_to: None,
            attachments: vec![],
            snap: None,
            mentions: vec![],
            preview: None,
            target: None,
            ext: None,
        }
    }

    /// E-010: Core's rate and size caps reach the node as `Rejected` (which earns a strike) for
    /// live gossip only; the same events pass via backfill.
    #[test]
    fn gossip_over_the_caps_is_rejected_but_backfill_is_not() {
        use hermod_core::CoreConfig;
        use hermod_core::ratelimit::RateConfig;
        let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let cfg = CoreConfig {
            rate: RateConfig {
                events_per_sec: 0.001,
                burst: 1,
                max_event_bytes: 1024,
            },
            ..Default::default()
        };
        let a = Core::open(da.path()).unwrap();
        let b = Arc::new(Core::open_with(db.path(), cfg).unwrap());
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let store = CoreStore::new(b.clone(), tx, Touched::default());
        let sp = a.space_create("Caps", "", "Team").unwrap().id;
        b.invite_accept(&a.invite_create(&sp, None, vec![]).unwrap().code)
            .unwrap();
        a.append(&sp, post("one", "m1")).unwrap();
        a.append(&sp, post("two", "m2")).unwrap();
        a.append(&sp, post(&"x".repeat(4096), "big")).unwrap();
        let evs = a.missing_since(&sp, &b.vector(&sp).unwrap()).unwrap();
        let bytes: Vec<Vec<u8>> = evs.iter().map(|e| e.to_bytes().unwrap()).collect();
        let (big, rest) = bytes.split_last().unwrap();
        // The size cap trips before any token is taken.
        let out = store.ingest_gossip(&sp.0, big).unwrap();
        assert!(matches!(out, IngestOutcome::Rejected(ref m) if m.contains("too large")));
        // Burst of 1: the first applies, a second in the same instant is rate limited.
        let outs: Vec<_> = rest
            .iter()
            .map(|e| store.ingest_gossip(&sp.0, e).unwrap())
            .collect();
        assert!(
            outs.iter()
                .any(|o| matches!(o, IngestOutcome::Rejected(m) if m.contains("rate"))),
            "rate limit surfaces as Rejected: {outs:?}"
        );
        // Backfill bypasses both caps.
        for e in rest.iter().chain(std::iter::once(big)) {
            assert!(!matches!(
                store.ingest(&sp.0, e).unwrap(),
                IngestOutcome::Rejected(_)
            ));
        }
    }

    /// A sync page stops at the byte budget (never loading the rest) yet is never empty.
    #[test]
    fn events_after_stops_at_the_byte_budget_but_is_never_empty() {
        const EVENTS: usize = 10;
        const TEXT_BYTES: usize = 50 * 1024;
        let dir = tempfile::tempdir().unwrap();
        let core = Arc::new(Core::open(dir.path()).unwrap());
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let store = CoreStore::new(core.clone(), tx, Touched::default());
        let sp = core.space_create("Big", "", "Team").unwrap().id;
        for i in 0..EVENTS {
            core.append(&sp, post(&"x".repeat(TEXT_BYTES), &format!("m{i}")))
                .unwrap();
        }
        let none = BTreeMap::new();
        let all = store.events_after(&sp.0, &none, EVENTS * 2, usize::MAX);
        assert!(all.len() >= EVENTS);
        let one = all.iter().map(Vec::len).max().unwrap();
        let budget = one * 3 + one / 2;
        let page = store.events_after(&sp.0, &none, EVENTS * 2, budget);
        let total: usize = page.iter().map(Vec::len).sum();
        assert!(!page.is_empty() && page.len() < all.len(), "{}", page.len());
        assert!(total <= budget, "{total} > {budget}");
        assert_eq!(page, all[..page.len()], "a prefix, in order");
        let tiny = store.events_after(&sp.0, &none, EVENTS * 2, 1);
        assert_eq!(tiny.len(), 1, "an oversize first event still goes");
        assert!(store.events_after(&sp.0, &none, 0, budget).is_empty());
    }
}
