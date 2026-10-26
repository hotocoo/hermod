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
        Ok(Self::from_seed(seed))
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
        write_private(path, &self.seed())
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
        let was = Self::mode_in(dir)?;
        let bytes = keyguard::encode(&self.seed(), mode, unlock, kdf)?;
        write_private(&path, &bytes)?;
        // The file now points elsewhere or holds the sealed key; drop a keychain copy nothing uses.
        if was == Some(KeyMode::Keychain)
            && mode != KeyMode::Keychain
            && let Some(store) = &unlock.store
        {
            let _ = store.delete();
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

    #[derive(Debug, Default)]
    struct MemStore(std::sync::Mutex<Option<Vec<u8>>>);

    impl keyguard::SecretStore for MemStore {
        fn get(&self) -> Result<Option<Vec<u8>>> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, secret: &[u8]) -> Result<()> {
            *self.0.lock().unwrap() = Some(secret.to_vec());
            Ok(())
        }
        fn delete(&self) -> Result<()> {
            *self.0.lock().unwrap() = None;
            Ok(())
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
            passphrase: pass.map(str::to_string),
        }
    }

    use crate::keyguard::SecretStore;
    use std::sync::Arc;

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
            KeyMode::File,
        ] {
            id.protect(dir.path(), mode, &u, FAST_KDF).unwrap();
            assert_eq!(Identity::mode_in(dir.path()).unwrap(), Some(mode));
            let back = Identity::load_or_create_with(dir.path(), &u).unwrap();
            assert_eq!(back.user_id(), want);
        }
        // Back on a plain file the unused keychain copy is gone.
        assert!(store.get().unwrap().is_none());
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
    fn failed_migration_keeps_the_old_key_readable() {
        let dir = tempfile::tempdir().unwrap();
        let id = Identity::load_or_create(dir.path()).unwrap();
        // No keychain available, and a passphrase that is too short.
        for (mode, pass) in [
            (KeyMode::Keychain, None),
            (KeyMode::Passphrase, Some("short")),
        ] {
            let u = Unlock {
                store: None,
                passphrase: pass.map(str::to_string),
            };
            assert!(id.protect(dir.path(), mode, &u, FAST_KDF).is_err());
            let still = Identity::load_or_create(dir.path()).unwrap();
            assert_eq!(still.user_id(), id.user_id());
        }
    }
}
