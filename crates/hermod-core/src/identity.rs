//! ed25519 identity: key generation, 0600 persistence (or keychain or passphrase, see
//! [`crate::keyguard`]), sign and verify.

use std::fs;
use std::io::Write;
use std::path::Path;

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};

use crate::backup::KdfParams;
use crate::crypto::random_bytes;
use crate::error::{Error, Result};
use crate::ids::UserId;
use crate::keyguard::{self, KeyMode, Unlock};

/// File name of the persisted identity inside the app data dir.
pub const KEY_FILE: &str = "identity.key";

/// The local user's keypair. The secret never leaves this type except through [`Identity::seed`].
pub struct Identity {
    key: SigningKey,
}

impl std::fmt::Debug for Identity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Identity({})", self.user_id().short())
    }
}

impl Identity {
    pub fn generate() -> Self {
        Self::from_seed(random_bytes())
    }

    pub fn from_seed(seed: [u8; 32]) -> Self {
        Identity {
            key: SigningKey::from_bytes(&seed),
        }
    }

    /// The 32 byte secret seed. Exposed so the node can derive its libp2p keypair from the same key.
    pub fn seed(&self) -> [u8; 32] {
        self.key.to_bytes()
    }

    /// Clamped X25519/signing scalar derived from the seed (see [`crate::keywrap`]).
    pub fn scalar_bytes(&self) -> [u8; 32] {
        self.key.to_scalar_bytes()
    }

    pub fn user_id(&self) -> UserId {
        UserId(self.key.verifying_key().to_bytes())
    }

    pub fn sign(&self, msg: &[u8]) -> [u8; 64] {
        self.key.sign(msg).to_bytes()
    }

    /// Loads a plain-file key at `path`, tightening its permissions to 0600 if needed.
    pub fn load(path: &Path) -> Result<Self> {
        Self::load_with(path, &Unlock::default())
    }

    /// Loads the key at `path` whatever its mode; `unlock` supplies the keychain and passphrase.
    pub fn load_with(path: &Path, unlock: &Unlock) -> Result<Self> {
        let raw = fs::read(path)?;
        let seed = keyguard::read_seed(&raw, unlock)?;
        restrict(path)?;
        Ok(Self::from_seed(*seed))
    }

    /// Keychain account the key file at `dir` points at, if it is a keychain marker.
    pub fn keychain_account_in(dir: &Path, unlock: &Unlock) -> Option<String> {
        let raw = fs::read(dir.join(KEY_FILE)).ok()?;
        keyguard::keychain_account(&raw, unlock)
    }

    /// Mode the key at `dir/identity.key` is stored in, or `None` before the first run.
    pub fn mode_in(dir: &Path) -> Result<Option<KeyMode>> {
        match fs::read(dir.join(KEY_FILE)) {
            Ok(raw) => keyguard::mode_of(&raw).map(Some),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Writes the key atomically with mode 0600 (unix).
    pub fn save(&self, path: &Path) -> Result<()> {
        write_private(path, &*zeroize::Zeroizing::new(self.seed()))
    }

    /// Moves the stored key to `mode`. The new store is written and read back first, and the old
    /// key file is replaced (atomically) only after that succeeds, so a failure at any step
    /// leaves the previous key readable. `unlock` carries the keychain and the new passphrase.
    pub fn protect(
        &self,
        dir: &Path,
        mode: KeyMode,
        unlock: &Unlock,
        kdf: KdfParams,
    ) -> Result<()> {
        let path = dir.join(KEY_FILE);
        let old_account = Self::keychain_account_in(dir, unlock);
        let bytes = keyguard::encode(&zeroize::Zeroizing::new(self.seed()), mode, unlock, kdf)?;
        write_private(&path, &bytes)?;
        // Only now, with the new file durable, drop the keychain copy nothing points at any more.
        let new_account = keyguard::keychain_account(&bytes, unlock);
        if let (Some(old), Some(store)) = (old_account, &unlock.store)
            && Some(&old) != new_account.as_ref()
        {
            store.delete(&old)?;
        }
        Ok(())
    }

    /// Loads `dir/identity.key`, generating and saving a new key on first run.
    pub fn load_or_create(dir: &Path) -> Result<Self> {
        Self::load_or_create_with(dir, &Unlock::default())
    }

    pub fn load_or_create_with(dir: &Path, unlock: &Unlock) -> Result<Self> {
        fs::create_dir_all(dir)?;
        let path = dir.join(KEY_FILE);
        if path.exists() {
            return Self::load_with(&path, unlock);
        }
        let id = Self::generate();
        id.save(&path)?;
        Ok(id)
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    let _ = fs::remove_file(&tmp);
    let mut f = open_private(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    drop(f);
    fs::rename(&tmp, path)?;
    sync_parent(path)
}

/// Makes the rename itself durable: without it a crash can bring back the old key file.
#[cfg(unix)]
fn sync_parent(path: &Path) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::File::open(dir)?.sync_all()?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn open_private(path: &Path) -> std::io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
}

#[cfg(not(unix))]
fn open_private(path: &Path) -> std::io::Result<fs::File> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
}

#[cfg(unix)]
fn restrict(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mode = fs::metadata(path)?.permissions().mode();
    if mode & 0o077 != 0 {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn restrict(_path: &Path) -> Result<()> {
    Ok(())
}

/// Verifies an ed25519 signature (strict: rejects malleable encodings).
pub fn verify(user: &UserId, msg: &[u8], sig: &[u8; 64]) -> Result<()> {
    let vk = VerifyingKey::from_bytes(&user.0).map_err(|_| Error::BadSignature)?;
    vk.verify_strict(msg, &Signature::from_bytes(sig))
        .map_err(|_| Error::BadSignature)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_verify_and_reject() {
        let id = Identity::generate();
        let sig = id.sign(b"msg");
        verify(&id.user_id(), b"msg", &sig).unwrap();
        assert!(verify(&id.user_id(), b"other", &sig).is_err());
        assert!(verify(&Identity::generate().user_id(), b"msg", &sig).is_err());
    }

    #[test]
    fn persists_with_private_mode() {
        let dir = tempfile::tempdir().unwrap();
        let a = Identity::load_or_create(dir.path()).unwrap();
        let b = Identity::load_or_create(dir.path()).unwrap();
        assert_eq!(a.user_id(), b.user_id());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let p = dir.path().join(KEY_FILE);
            assert_eq!(
                fs::metadata(&p).unwrap().permissions().mode() & 0o777,
                0o600
            );
            fs::set_permissions(&p, fs::Permissions::from_mode(0o644)).unwrap();
            Identity::load(&p).unwrap();
            assert_eq!(
                fs::metadata(&p).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn user_id_round_trips_base58() {
        let id = Identity::generate().user_id();
        assert_eq!(id.to_string().parse::<UserId>().unwrap(), id);
        assert!("not base58 !".parse::<UserId>().is_err());
    }

    /// In-memory keychain that can be told to fail or lose entries.
    #[derive(Debug, Default)]
    struct MemStore {
        map: std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>,
        fail_set: std::sync::atomic::AtomicBool,
        fail_get: std::sync::atomic::AtomicBool,
    }

    impl SecretStore for MemStore {
        fn get(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
            if self.fail_get.load(std::sync::atomic::Ordering::Relaxed) {
                return Err(Error::Forbidden("access denied".into()));
            }
            Ok(self
                .map
                .lock()
                .unwrap()
                .get(account)
                .map(|v| Zeroizing::new(v.clone())))
        }
        fn set(&self, account: &str, secret: &[u8]) -> Result<()> {
            if self.fail_set.load(std::sync::atomic::Ordering::Relaxed) {
                return Err(Error::Forbidden("access denied".into()));
            }
            self.map
                .lock()
                .unwrap()
                .insert(account.to_string(), secret.to_vec());
            Ok(())
        }
        fn delete(&self, account: &str) -> Result<()> {
            self.map.lock().unwrap().remove(account);
            Ok(())
        }
    }

    impl MemStore {
        fn entries(&self) -> usize {
            self.map.lock().unwrap().len()
        }
    }

    const FAST_KDF: KdfParams = KdfParams {
        m_cost_kib: 8,
        t_cost: 1,
        p_cost: 1,
    };

    fn unlock(store: &Arc<MemStore>, pass: Option<&str>) -> Unlock {
        Unlock {
            store: Some(store.clone()),
            passphrase: pass.map(|p| Zeroizing::new(p.to_string())),
            legacy_account: None,
        }
    }

    use crate::keyguard::SecretStore;
    use std::sync::Arc;
    use zeroize::Zeroizing;

    #[test]
    fn every_mode_round_trips_and_migrates_without_loss() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(MemStore::default());
        let id = Identity::load_or_create(dir.path()).unwrap();
        let want = id.user_id();
        assert_eq!(Identity::mode_in(dir.path()).unwrap(), Some(KeyMode::File));

        let u = unlock(&store, Some("correct horse"));
        for mode in [
            KeyMode::Keychain,
            KeyMode::Passphrase,
            KeyMode::Keychain,
            KeyMode::Keychain,
            KeyMode::File,
        ] {
            id.protect(dir.path(), mode, &u, FAST_KDF).unwrap();
            assert_eq!(Identity::mode_in(dir.path()).unwrap(), Some(mode));
            let back = Identity::load_or_create_with(dir.path(), &u).unwrap();
            assert_eq!(back.user_id(), want);
            // Never more than the one live keychain entry, and none once off the keychain.
            assert_eq!(store.entries(), usize::from(mode == KeyMode::Keychain));
        }
    }

    #[test]
    fn keychain_key_survives_moving_the_data_dir() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let store = Arc::new(MemStore::default());
        let id = Identity::load_or_create(a.path()).unwrap();
        id.protect(a.path(), KeyMode::Keychain, &unlock(&store, None), FAST_KDF)
            .unwrap();
        fs::copy(a.path().join(KEY_FILE), b.path().join(KEY_FILE)).unwrap();
        let moved = Identity::load_or_create_with(b.path(), &unlock(&store, None)).unwrap();
        assert_eq!(moved.user_id(), id.user_id());
    }

    #[test]
    fn legacy_keychain_marker_reads_through_the_old_account() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(MemStore::default());
        let id = Identity::generate();
        store.set("old-dir-hash", &id.seed()).unwrap();
        fs::write(dir.path().join(KEY_FILE), b"HRMDKC1\0").unwrap();
        let mut u = unlock(&store, None);
        assert!(Identity::load_or_create_with(dir.path(), &u).is_err());
        u.legacy_account = Some("old-dir-hash".into());
        let back = Identity::load_or_create_with(dir.path(), &u).unwrap();
        assert_eq!(back.user_id(), id.user_id());
    }

    #[test]
    fn sealed_key_needs_the_right_passphrase() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(MemStore::default());
        let id = Identity::load_or_create(dir.path()).unwrap();
        id.protect(
            dir.path(),
            KeyMode::Passphrase,
            &unlock(&store, Some("correct horse")),
            FAST_KDF,
        )
        .unwrap();
        let path = dir.path().join(KEY_FILE);
        assert!(matches!(
            Identity::load_with(&path, &unlock(&store, None)),
            Err(Error::Locked)
        ));
        assert!(Identity::load_with(&path, &unlock(&store, Some("wrong horse!"))).is_err());
        assert!(Identity::load(&path).is_err());
    }

    #[test]
    fn truncated_or_garbled_sealed_file_is_refused_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(MemStore::default());
        let u = unlock(&store, Some("correct horse"));
        let id = Identity::load_or_create(dir.path()).unwrap();
        id.protect(dir.path(), KeyMode::Passphrase, &u, FAST_KDF)
            .unwrap();
        let path = dir.path().join(KEY_FILE);
        let good = fs::read(&path).unwrap();
        let mut cases: Vec<Vec<u8>> = (8..good.len())
            .step_by(7)
            .map(|n| good[..n].to_vec())
            .collect();
        let mut flipped = good.clone();
        *flipped.last_mut().unwrap() ^= 1;
        cases.push(flipped);
        let mut huge_cost = good.clone();
        huge_cost[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
        cases.push(huge_cost);
        for bad in cases {
            fs::write(&path, &bad).unwrap();
            assert!(
                Identity::load_with(&path, &u).is_err(),
                "{} bytes",
                bad.len()
            );
        }
        fs::write(&path, &good).unwrap();
        assert_eq!(
            Identity::load_with(&path, &u).unwrap().user_id(),
            id.user_id()
        );
    }

    #[test]
    fn failed_migration_keeps_the_old_key_readable() {
        let dir = tempfile::tempdir().unwrap();
        let id = Identity::load_or_create(dir.path()).unwrap();
        let before = fs::read(dir.path().join(KEY_FILE)).unwrap();
        let store = Arc::new(MemStore::default());
        store
            .fail_set
            .store(true, std::sync::atomic::Ordering::Relaxed);
        let cases = [
            (Unlock::default(), KeyMode::Keychain),
            (unlock(&store, Some("short")), KeyMode::Passphrase),
            (unlock(&store, None), KeyMode::Keychain),
        ];
        for (u, mode) in &cases {
            assert!(id.protect(dir.path(), *mode, u, FAST_KDF).is_err());
            assert_eq!(fs::read(dir.path().join(KEY_FILE)).unwrap(), before);
        }
    }

    #[test]
    fn keychain_entry_gone_is_reported_as_key_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(MemStore::default());
        let id = Identity::load_or_create(dir.path()).unwrap();
        id.protect(
            dir.path(),
            KeyMode::Keychain,
            &unlock(&store, None),
            FAST_KDF,
        )
        .unwrap();
        let empty = Arc::new(MemStore::default());
        let path = dir.path().join(KEY_FILE);
        assert!(matches!(
            Identity::load_with(&path, &unlock(&empty, None)),
            Err(Error::KeyUnavailable(_))
        ));
        store
            .fail_get
            .store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(matches!(
            Identity::load_with(&path, &unlock(&store, None)),
            Err(Error::KeyUnavailable(_))
        ));
        assert!(matches!(
            Identity::load_with(&path, &Unlock::default()),
            Err(Error::KeyUnavailable(_))
        ));
    }
}
