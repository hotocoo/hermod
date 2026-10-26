//! OS keychain backing for the identity key (macOS Keychain, Windows Credential Manager, the
//! Secret Service on Linux), behind core's `SecretStore` so tests never touch a real keychain.

use std::path::Path;
use std::sync::Arc;

use hermod_core::error::{Error, Result};
use hermod_core::keyguard::SecretStore;
use zeroize::Zeroizing;

/// Service name the entries are filed under.
const SERVICE: &str = "app.hermod.identity";

/// The system keychain. The account is chosen by core and stored in the key file marker.
#[derive(Debug)]
pub struct KeyringStore;

impl KeyringStore {
    pub fn shared() -> Arc<dyn SecretStore> {
        Arc::new(KeyringStore)
    }
}

/// Account that key files written before account ids were filed under: derived from the data
/// dir path, so such an install only reads back from the same path.
pub fn legacy_account(dir: &Path) -> String {
    hex::encode(hermod_core::crypto::blake3_hash(
        dir.to_string_lossy().as_bytes(),
    ))
}

fn entry(account: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, account).map_err(map_err)
}

fn map_err(e: keyring::Error) -> Error {
    Error::Forbidden(e.to_string())
}

impl SecretStore for KeyringStore {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
        match entry(account)?.get_secret() {
            Ok(v) => Ok(Some(Zeroizing::new(v))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(map_err(e)),
        }
    }

    fn set(&self, account: &str, secret: &[u8]) -> Result<()> {
        entry(account)?.set_secret(secret).map_err(map_err)
    }

    fn delete(&self, account: &str) -> Result<()> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(map_err(e)),
        }
    }
}
