//! ed25519 identity: key generation, 0600 persistence, sign and verify.

use std::fs;
use std::io::Write;
use std::path::Path;

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};

use crate::crypto::random_bytes;
use crate::error::{Error, Result};
use crate::ids::UserId;

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

    /// Loads the key at `path`, tightening its permissions to 0600 if needed.
    pub fn load(path: &Path) -> Result<Self> {
        let raw = fs::read(path)?;
        let seed: [u8; 32] = raw
            .try_into()
            .map_err(|_| Error::invalid("identity key", "expected 32 bytes"))?;
        restrict(path)?;
        Ok(Self::from_seed(seed))
    }

    /// Writes the key atomically with mode 0600 (unix).
    pub fn save(&self, path: &Path) -> Result<()> {
        let tmp = path.with_extension("tmp");
        let _ = fs::remove_file(&tmp);
        let mut f = open_private(&tmp)?;
        f.write_all(&self.seed())?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Loads `dir/identity.key`, generating and saving a new key on first run.
    pub fn load_or_create(dir: &Path) -> Result<Self> {
        fs::create_dir_all(dir)?;
        let path = dir.join(KEY_FILE);
        if path.exists() {
            return Self::load(&path);
        }
        let id = Self::generate();
        id.save(&path)?;
        Ok(id)
    }
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
}
