//! Storage seam. `hermod-core` implements [`NodeStore`] through an adapter; this crate
//! never parses event bodies, it only moves opaque bytes.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;

/// 32-byte space id (raw bytes of `space_id`).
pub type SpaceId = [u8; 32];
/// Blob id: BLAKE3 of the encoded manifest.
pub type BlobId = [u8; 32];
/// Author key (base58 `UserId`), opaque to the node.
pub type Author = String;

/// Result of handing one encoded `SignedEvent` to the store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IngestOutcome {
    /// New valid event stored.
    Applied,
    /// Already known.
    Duplicate,
    /// Valid shape but an earlier `seq` of the same author is missing: a sync is needed.
    MissingPrior,
    /// Bad signature, wrong space, oversize or malformed. Not stored.
    Rejected(String),
}

/// Parsed manifest: total size and the BLAKE3 hash of every chunk, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestInfo {
    pub size: u64,
    pub chunks: Vec<[u8; 32]>,
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct StoreError(pub String);

pub type StoreResult<T> = Result<T, StoreError>;

/// Node to storage contract. All methods may block briefly (SQLite, disk); the node calls
/// them from `spawn_blocking`.
pub trait NodeStore: Send + Sync + 'static {
    /// Spaces this install is a member of.
    fn joined_spaces(&self) -> Vec<SpaceId>;
    /// Highest contiguous `seq` held per author.
    fn vector(&self, space: &SpaceId) -> BTreeMap<Author, u64>;
    /// Encoded events the remote vector lacks, at most `limit`, in per-author seq order.
    fn events_after(
        &self,
        space: &SpaceId,
        vector: &BTreeMap<Author, u64>,
        limit: usize,
    ) -> Vec<Vec<u8>>;
    /// Verify and store one encoded event.
    fn ingest(&self, space: &SpaceId, bytes: &[u8]) -> StoreResult<IngestOutcome>;
    /// Like [`NodeStore::ingest`] for an event that arrived live over gossip, so the store can
    /// apply its per-author rate cap (backfill from sync is exempt). Defaults to `ingest`.
    fn ingest_gossip(&self, space: &SpaceId, bytes: &[u8]) -> StoreResult<IngestOutcome> {
        self.ingest(space, bytes)
    }
    /// True when the manifest and every chunk are present.
    fn blob_has(&self, blob: &BlobId) -> bool;
    /// Encoded manifest bytes, if known.
    fn blob_manifest(&self, blob: &BlobId) -> Option<Vec<u8>>;
    /// Verify `bytes` hash to `blob`, store, and return the parsed manifest.
    fn blob_put_manifest(&self, blob: &BlobId, bytes: &[u8]) -> StoreResult<ManifestInfo>;
    /// Chunk indices still missing (empty when complete or the manifest is unknown).
    fn blob_missing(&self, blob: &BlobId) -> Vec<u32>;
    /// Author named in the plaintext header of an encoded event, for per-author rate caps.
    /// `None` makes the node fall back to the sending peer.
    fn event_author(&self, _bytes: &[u8]) -> Option<Author> {
        None
    }
    /// Chunk `idx` of `blob`, if held.
    fn blob_chunk(&self, blob: &BlobId, idx: u32) -> Option<Vec<u8>>;
    /// Store chunk `idx` (the node already verified its hash against the manifest).
    fn blob_put_chunk(&self, blob: &BlobId, idx: u32, bytes: &[u8]) -> StoreResult<()>;
}

/// Store for a relay/bootstrap-only peer: joins no spaces, holds no events or blobs.
#[derive(Debug, Default, Clone, Copy)]
pub struct RelayOnlyStore;

impl NodeStore for RelayOnlyStore {
    fn joined_spaces(&self) -> Vec<SpaceId> {
        Vec::new()
    }
    fn vector(&self, _: &SpaceId) -> BTreeMap<Author, u64> {
        BTreeMap::new()
    }
    fn events_after(&self, _: &SpaceId, _: &BTreeMap<Author, u64>, _: usize) -> Vec<Vec<u8>> {
        Vec::new()
    }
    fn ingest(&self, _: &SpaceId, _: &[u8]) -> StoreResult<IngestOutcome> {
        Ok(IngestOutcome::Rejected(
            "relay-only node stores nothing".into(),
        ))
    }
    fn blob_has(&self, _: &BlobId) -> bool {
        false
    }
    fn blob_manifest(&self, _: &BlobId) -> Option<Vec<u8>> {
        None
    }
    fn blob_put_manifest(&self, _: &BlobId, _: &[u8]) -> StoreResult<ManifestInfo> {
        Err(StoreError("relay-only node stores nothing".into()))
    }
    fn blob_missing(&self, _: &BlobId) -> Vec<u32> {
        Vec::new()
    }
    fn blob_chunk(&self, _: &BlobId, _: u32) -> Option<Vec<u8>> {
        None
    }
    fn blob_put_chunk(&self, _: &BlobId, _: u32, _: &[u8]) -> StoreResult<()> {
        Err(StoreError("relay-only node stores nothing".into()))
    }
}

/// Key under which peers not tied to a space (DHT neighbours, relays) are remembered.
pub const GLOBAL_PEERS: SpaceId = [0u8; 32];

/// Persistence of known peer addresses (full multiaddrs ending in `/p2p/<id>`), so a restart
/// reconnects without waiting for discovery.
pub trait PeerBook: Send + Sync + 'static {
    fn load(&self, space: &SpaceId) -> Vec<String>;
    fn save(&self, space: &SpaceId, addrs: &[String]);
}

/// JSON file peer book: `{ "<space hex>": ["/ip4/...", ...] }`, written atomically.
pub struct FilePeerBook {
    path: PathBuf,
    state: Mutex<BTreeMap<String, Vec<String>>>,
}

impl FilePeerBook {
    pub fn open(path: impl Into<PathBuf>) -> io::Result<Self> {
        let path = path.into();
        let state = match fs::read(&path) {
            Ok(b) => serde_json::from_slice(&b).unwrap_or_default(),
            Err(e) if e.kind() == io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e),
        };
        Ok(Self {
            path,
            state: Mutex::new(state),
        })
    }

    fn flush(&self, state: &BTreeMap<String, Vec<String>>) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("tmp");
        fs::write(
            &tmp,
            serde_json::to_vec_pretty(state).map_err(io::Error::other)?,
        )?;
        fs::rename(tmp, &self.path)
    }
}

impl PeerBook for FilePeerBook {
    fn load(&self, space: &SpaceId) -> Vec<String> {
        let g = self.state.lock().unwrap_or_else(|e| e.into_inner());
        g.get(&hex::encode(space)).cloned().unwrap_or_default()
    }

    fn save(&self, space: &SpaceId, addrs: &[String]) {
        let mut g = self.state.lock().unwrap_or_else(|e| e.into_inner());
        g.insert(hex::encode(space), addrs.to_vec());
        if let Err(e) = self.flush(&g) {
            tracing::warn!("peer book write failed: {e}");
        }
    }
}

/// Peer book that remembers nothing (callers that do not want persistence).
pub struct NoPeerBook;

impl PeerBook for NoPeerBook {
    fn load(&self, _: &SpaceId) -> Vec<String> {
        Vec::new()
    }
    fn save(&self, _: &SpaceId, _: &[String]) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peer_book_persists_across_reopen() {
        let dir = std::env::temp_dir().join(format!("hermod-pb-{}", std::process::id()));
        let path = dir.join("peers.json");
        let space = [3u8; 32];
        FilePeerBook::open(&path)
            .unwrap()
            .save(&space, &["/ip4/1.2.3.4/tcp/1".to_string()]);
        let again = FilePeerBook::open(&path).unwrap();
        assert_eq!(again.load(&space), vec!["/ip4/1.2.3.4/tcp/1".to_string()]);
        assert!(again.load(&[4u8; 32]).is_empty());
        let _ = fs::remove_dir_all(dir);
    }
}
