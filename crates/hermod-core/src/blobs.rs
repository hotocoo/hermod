//! Content-addressed blob store: 256 KiB BLAKE3 chunks, manifests, have/missing, range reads.
//!
//! A blob id is `BLAKE3("hermod/blob/v1" || manifest bytes)` where the manifest is the size
//! (u64 LE) followed by the chunk hashes. A manifest is therefore verifiable on its own, and each
//! chunk is verifiable against its entry, so peers can fetch chunks from untrusted sources.

use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::crypto::{blake3_hash, random_bytes};
use crate::error::{Error, Result};
use crate::ids::{hex_decode_array, hex_encode};

/// Chunk size in bytes.
pub const CHUNK_SIZE: usize = 256 * 1024;

const DOMAIN: &[u8] = b"hermod/blob/v1";

/// Ordered list of chunk hashes plus the total size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub size: u64,
    pub chunks: Vec<[u8; 32]>,
}

impl Manifest {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + self.chunks.len() * 32);
        out.extend_from_slice(&self.size.to_le_bytes());
        for c in &self.chunks {
            out.extend_from_slice(c);
        }
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < 8 || !(bytes.len() - 8).is_multiple_of(32) {
            return Err(Error::invalid("manifest", "bad length"));
        }
        let size = u64::from_le_bytes(bytes[..8].try_into().expect("8 bytes"));
        let chunks: Vec<[u8; 32]> = bytes[8..].as_chunks::<32>().0.to_vec();
        if chunks.len() as u64 != size.div_ceil(CHUNK_SIZE as u64) {
            return Err(Error::invalid(
                "manifest",
                "chunk count does not match size",
            ));
        }
        Ok(Manifest { size, chunks })
    }

    /// Blob id, hex.
    pub fn id(&self) -> String {
        let mut buf = DOMAIN.to_vec();
        buf.extend_from_slice(&self.to_bytes());
        hex_encode(&blake3_hash(&buf))
    }
}

/// Result of storing a blob.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobInfo {
    pub hash: String,
    pub size: u64,
}

/// Filesystem backed store rooted at `<dir>/blobs`.
#[derive(Debug, Clone)]
pub struct BlobStore {
    manifests: PathBuf,
    chunks: PathBuf,
}

impl BlobStore {
    pub fn open(dir: &Path) -> Result<Self> {
        let root = dir.join("blobs");
        let s = BlobStore {
            manifests: root.join("manifests"),
            chunks: root.join("chunks"),
        };
        fs::create_dir_all(&s.manifests)?;
        fs::create_dir_all(&s.chunks)?;
        Ok(s)
    }

    fn manifest_path(&self, id: &str) -> Result<PathBuf> {
        Ok(self
            .manifests
            .join(hex_encode(&hex_decode_array::<32>(id)?)))
    }

    fn chunk_path(&self, hash: &[u8; 32]) -> PathBuf {
        let h = hex_encode(hash);
        self.chunks.join(&h[..2]).join(h)
    }

    fn write_atomic(path: &Path, data: &[u8]) -> Result<()> {
        if path.exists() {
            return Ok(());
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension(format!("{}.tmp", hex_encode(&random_bytes::<8>())));
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Streams `reader` into chunks and stores the manifest.
    pub fn put_reader<R: Read>(&self, mut reader: R) -> Result<BlobInfo> {
        let mut chunks = Vec::new();
        let mut size = 0u64;
        let mut buf = vec![0u8; CHUNK_SIZE];
        loop {
            let mut filled = 0;
            while filled < CHUNK_SIZE {
                let n = reader.read(&mut buf[filled..])?;
                if n == 0 {
                    break;
                }
                filled += n;
            }
            if filled == 0 {
                break;
            }
            let hash = blake3_hash(&buf[..filled]);
            Self::write_atomic(&self.chunk_path(&hash), &buf[..filled])?;
            chunks.push(hash);
            size += filled as u64;
            if filled < CHUNK_SIZE {
                break;
            }
        }
        let manifest = Manifest { size, chunks };
        let hash = manifest.id();
        Self::write_atomic(&self.manifest_path(&hash)?, &manifest.to_bytes())?;
        Ok(BlobInfo { hash, size })
    }

    pub fn put_bytes(&self, data: &[u8]) -> Result<BlobInfo> {
        self.put_reader(data)
    }

    pub fn put_path(&self, path: &Path) -> Result<BlobInfo> {
        self.put_reader(fs::File::open(path)?)
    }

    /// Stores a manifest received from a peer after checking it hashes to `id`.
    pub fn put_manifest(&self, id: &str, bytes: &[u8]) -> Result<Manifest> {
        let manifest = Manifest::from_bytes(bytes)?;
        if manifest.id() != id {
            return Err(Error::invalid("manifest", "does not match blob id"));
        }
        Self::write_atomic(&self.manifest_path(id)?, bytes)?;
        Ok(manifest)
    }

    /// Stores a chunk received from a peer after checking its hash.
    pub fn put_chunk(&self, hash_hex: &str, data: &[u8]) -> Result<()> {
        let hash = hex_decode_array::<32>(hash_hex)?;
        if data.len() > CHUNK_SIZE || blake3_hash(data) != hash {
            return Err(Error::invalid("chunk", "hash mismatch"));
        }
        Self::write_atomic(&self.chunk_path(&hash), data)
    }

    pub fn manifest(&self, id: &str) -> Result<Option<Manifest>> {
        match fs::read(self.manifest_path(id)?) {
            Ok(b) => Ok(Some(Manifest::from_bytes(&b)?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn require(&self, id: &str) -> Result<Manifest> {
        self.manifest(id)?
            .ok_or_else(|| Error::NotFound(format!("blob {id}")))
    }

    pub fn has_chunk(&self, hash: &[u8; 32]) -> bool {
        self.chunk_path(hash).exists()
    }

    /// Indexes of chunks not yet present. Empty means complete.
    pub fn missing(&self, id: &str) -> Result<Vec<u32>> {
        let m = self.require(id)?;
        Ok(m.chunks
            .iter()
            .enumerate()
            .filter(|(_, h)| !self.has_chunk(h))
            .map(|(i, _)| i as u32)
            .collect())
    }

    pub fn is_complete(&self, id: &str) -> Result<bool> {
        Ok(self.manifest(id)?.is_some() && self.missing(id)?.is_empty())
    }

    pub fn size(&self, id: &str) -> Result<u64> {
        Ok(self.require(id)?.size)
    }

    /// Reads one chunk, re-verifying its hash.
    pub fn read_chunk(&self, id: &str, idx: u32) -> Result<Vec<u8>> {
        self.read_chunk_in(&self.require(id)?, id, idx)
    }

    /// [`Self::read_chunk`] for a manifest the caller already holds (no manifest re-read).
    pub fn read_chunk_in(&self, m: &Manifest, id: &str, idx: u32) -> Result<Vec<u8>> {
        let hash = m
            .chunks
            .get(idx as usize)
            .ok_or_else(|| Error::NotFound(format!("chunk {idx}")))?;
        let data = fs::read(self.chunk_path(hash)).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => Error::NotFound(format!("chunk {idx} of {id}")),
            _ => e.into(),
        })?;
        if blake3_hash(&data) != *hash {
            return Err(Error::invalid("chunk", "stored data is corrupt"));
        }
        Ok(data)
    }

    /// Reads `[start, start + len)`, clamped to the blob size. Only the needed chunks are touched.
    pub fn read_range(&self, id: &str, start: u64, len: u64) -> Result<Vec<u8>> {
        self.read_range_in(&self.require(id)?, id, start, len)
    }

    /// [`Self::read_range`] for a manifest the caller already holds.
    pub fn read_range_in(&self, m: &Manifest, id: &str, start: u64, len: u64) -> Result<Vec<u8>> {
        let end = start.saturating_add(len).min(m.size);
        if start >= end {
            return Ok(Vec::new());
        }
        let cs = CHUNK_SIZE as u64;
        let mut out = Vec::with_capacity((end - start) as usize);
        for idx in (start / cs)..=((end - 1) / cs) {
            let chunk = self.read_chunk_in(m, id, idx as u32)?;
            let base = idx * cs;
            let from = start.saturating_sub(base) as usize;
            let to = (end - base).min(chunk.len() as u64) as usize;
            out.extend_from_slice(&chunk[from..to]);
        }
        Ok(out)
    }

    pub fn read_all(&self, id: &str) -> Result<Vec<u8>> {
        self.read_range(id, 0, u64::MAX)
    }

    /// Bytes used on disk by manifests and chunks.
    pub fn disk_bytes(&self) -> Result<u64> {
        fn walk(dir: &Path) -> std::io::Result<u64> {
            let mut total = 0;
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let meta = entry.metadata()?;
                total += if meta.is_dir() {
                    walk(&entry.path())?
                } else {
                    meta.len()
                };
            }
            Ok(total)
        }
        Ok(walk(&self.manifests)? + walk(&self.chunks)?)
    }

    /// Deletes every blob not in `keep` that is older than `min_age`, plus chunks no kept or
    /// recent manifest references. Returns the bytes freed. The age floor protects uploads that
    /// are not attached to an event yet.
    pub fn gc(&self, keep: &HashSet<String>, min_age: Duration) -> Result<u64> {
        let now = SystemTime::now();
        let old_enough = |meta: &fs::Metadata| {
            meta.modified()
                .ok()
                .and_then(|m| now.duration_since(m).ok())
                .is_some_and(|age| age >= min_age)
        };
        let mut referenced: HashSet<[u8; 32]> = HashSet::new();
        let mut freed = 0;
        for entry in fs::read_dir(&self.manifests)? {
            let entry = entry?;
            let meta = entry.metadata()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let doomed = !keep.contains(&name) && old_enough(&meta);
            match (doomed, Manifest::from_bytes(&fs::read(entry.path())?)) {
                (true, _) | (false, Err(_)) => {
                    freed += meta.len();
                    fs::remove_file(entry.path())?;
                }
                (false, Ok(m)) => referenced.extend(m.chunks),
            }
        }
        for dir in fs::read_dir(&self.chunks)? {
            let dir = dir?;
            if !dir.metadata()?.is_dir() {
                continue;
            }
            for chunk in fs::read_dir(dir.path())? {
                let chunk = chunk?;
                let meta = chunk.metadata()?;
                let hash = hex_decode_array::<32>(&chunk.file_name().to_string_lossy()).ok();
                if hash.is_none_or(|h| !referenced.contains(&h)) && old_enough(&meta) {
                    freed += meta.len();
                    fs::remove_file(chunk.path())?;
                }
            }
        }
        Ok(freed)
    }

    /// Oldest-first blobs outside `keep` (and at least `min_age` old) whose sizes add up to at
    /// least `need` bytes, or all of them when they total less.
    pub fn oldest_unreferenced(
        &self,
        keep: &HashSet<String>,
        min_age: Duration,
        need: u64,
    ) -> Result<Vec<String>> {
        let now = SystemTime::now();
        let mut found = Vec::new();
        for entry in fs::read_dir(&self.manifests)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(age) = entry
                .metadata()?
                .modified()
                .ok()
                .and_then(|m| now.duration_since(m).ok())
            else {
                continue;
            };
            if keep.contains(&name) || age < min_age {
                continue;
            }
            let size = Manifest::from_bytes(&fs::read(entry.path())?).map_or(0, |m| m.size);
            found.push((age, name, size));
        }
        found.sort_by_key(|f| std::cmp::Reverse(f.0));
        let mut sum = 0;
        let mut out = Vec::new();
        for (_, name, size) in found {
            if sum >= need {
                break;
            }
            sum += size;
            out.push(name);
        }
        Ok(out)
    }

    /// Every stored blob id.
    pub fn list(&self) -> Result<Vec<String>> {
        let mut out = Vec::new();
        for entry in fs::read_dir(&self.manifests)? {
            out.push(entry?.file_name().to_string_lossy().into_owned());
        }
        out.sort();
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i * 31 % 251) as u8).collect()
    }

    #[test]
    fn chunk_and_reassemble() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::open(dir.path()).unwrap();
        for n in [
            0,
            1,
            CHUNK_SIZE - 1,
            CHUNK_SIZE,
            CHUNK_SIZE + 1,
            3 * CHUNK_SIZE + 17,
        ] {
            let d = data(n);
            let info = store.put_bytes(&d).unwrap();
            assert_eq!(info.size, n as u64);
            let m = store.manifest(&info.hash).unwrap().unwrap();
            assert_eq!(m.chunks.len(), n.div_ceil(CHUNK_SIZE));
            assert!(store.is_complete(&info.hash).unwrap());
            assert_eq!(store.read_all(&info.hash).unwrap(), d);
        }
        let a = store.put_bytes(&data(1000)).unwrap();
        assert_eq!(a, store.put_bytes(&data(1000)).unwrap());
    }

    #[test]
    fn range_reads_cross_chunk_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::open(dir.path()).unwrap();
        let d = data(2 * CHUNK_SIZE + 500);
        let id = store.put_bytes(&d).unwrap().hash;
        let cs = CHUNK_SIZE;
        for (s, l) in [
            (0, 10),
            (cs - 5, 10),
            (cs, cs),
            (cs + 3, cs + 100),
            (2 * cs, 9999),
            (d.len() - 1, 1),
        ] {
            let got = store.read_range(&id, s as u64, l as u64).unwrap();
            let end = (s + l).min(d.len());
            assert_eq!(got, &d[s..end], "range {s}+{l}");
        }
        assert!(
            store
                .read_range(&id, d.len() as u64, 10)
                .unwrap()
                .is_empty()
        );
        assert!(store.read_range(&id, 5, 0).unwrap().is_empty());
    }

    #[test]
    fn transfer_have_missing_and_verification() {
        let (d1, d2) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (src, dst) = (
            BlobStore::open(d1.path()).unwrap(),
            BlobStore::open(d2.path()).unwrap(),
        );
        let data = data(2 * CHUNK_SIZE + 9);
        let id = src.put_bytes(&data).unwrap().hash;
        let m = src.manifest(&id).unwrap().unwrap();

        assert!(dst.missing(&id).is_err());
        let mut wrong = m.to_bytes();
        wrong[0] ^= 1;
        assert!(dst.put_manifest(&id, &wrong).is_err());
        dst.put_manifest(&id, &m.to_bytes()).unwrap();
        assert_eq!(dst.missing(&id).unwrap(), vec![0, 1, 2]);
        assert!(!dst.is_complete(&id).unwrap());

        assert!(dst.put_chunk(&hex_encode(&m.chunks[0]), b"evil").is_err());
        for idx in [2u32, 0] {
            let c = src.read_chunk(&id, idx).unwrap();
            dst.put_chunk(&hex_encode(&m.chunks[idx as usize]), &c)
                .unwrap();
        }
        assert_eq!(dst.missing(&id).unwrap(), vec![1]);
        assert!(matches!(
            dst.read_range(&id, 0, u64::MAX),
            Err(Error::NotFound(_))
        ));
        dst.put_chunk(&hex_encode(&m.chunks[1]), &src.read_chunk(&id, 1).unwrap())
            .unwrap();
        assert!(dst.is_complete(&id).unwrap());
        assert_eq!(dst.read_all(&id).unwrap(), data);
    }

    #[test]
    fn gc_keeps_referenced_blobs_and_frees_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::open(dir.path()).unwrap();
        let keep = store.put_bytes(&data(CHUNK_SIZE + 5)).unwrap();
        let drop = store.put_bytes(&data(777)).unwrap();
        let total = store.disk_bytes().unwrap();
        assert!(total > 0);
        let keep_set: HashSet<String> = [keep.hash.clone()].into();
        assert_eq!(
            store.gc(&keep_set, Duration::from_secs(3600)).unwrap(),
            0,
            "recent uploads are protected"
        );
        let freed = store.gc(&keep_set, Duration::ZERO).unwrap();
        assert!(freed >= 777);
        assert_eq!(store.disk_bytes().unwrap(), total - freed);
        assert!(store.is_complete(&keep.hash).unwrap());
        assert!(store.manifest(&drop.hash).unwrap().is_none());
        assert_eq!(store.list().unwrap(), vec![keep.hash]);
    }

    #[test]
    fn rejects_path_traversal_ids() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::open(dir.path()).unwrap();
        assert!(store.manifest("../../etc/passwd").is_err());
        assert!(store.manifest(&"A".repeat(64)).is_err());
        assert!(store.manifest(&"ab".repeat(32)).unwrap().is_none());
    }
}
