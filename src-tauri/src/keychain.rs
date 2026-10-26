//! OS keychain backing for the identity key (macOS Keychain, Windows Credential Manager, the
//! Secret Service on Linux), behind core's `SecretStore` so tests never touch a real keychain.

use std::path::Path;
use std::sync::Arc;

use hermod_core::error::{Error, Result};
use hermod_core::keyguard::SecretStore;

/// Service name the entry is filed under.
const SERVICE: &str = "app.hermod.identity";

/// One keychain entry per data dir, so a second install or a test dir never shares a key.
#[derive(Debug)]
pub struct KeyringStore {
    account: String,
}

impl KeyringStore {
    pub fn for_dir(dir: &Path) -> Arc<Self> {
        let digest = hermod_core::crypto::blake3_hash(dir.to_string_lossy().as_bytes());
        Arc::new(KeyringStore {
            account: hex::encode(digest),
        })
    }

    fn entry(&self) -> Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, &self.account).map_err(map_err)
    }
}

fn map_err(e: keyring::Error) -> Error {
    Error::Forbidden(e.to_string())
}

impl SecretStore for KeyringStore {
    fn get(&self) -> Result<Option<Vec<u8>>> {
        match self.entry()?.get_secret() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(map_err(e)),
        }
    }

    fn set(&self, secret: &[u8]) -> Result<()> {
        self.entry()?.set_secret(secret).map_err(map_err)
    }

    fn delete(&self) -> Result<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(map_err(e)),
        }
    }
}
