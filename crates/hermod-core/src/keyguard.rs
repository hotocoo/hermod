//! How the identity seed is kept at rest: a plain 0600 file, the OS keychain, or a file sealed
//! with a passphrase.
//!
//! `identity.key` is self-describing. 32 bytes is the raw seed ([`KeyMode::File`]);
//! [`MAGIC_KEYCHAIN`] `|| account(16)` means the seed lives in the OS keychain under that random
//! account id (so moving the data dir does not lose it); the old 8 byte [`MARKER_KEYCHAIN_V1`]
//! keyed the entry by the data dir path and is still read; [`MAGIC_PASSPHRASE`] starts a sealed
//! file: `magic || m_cost(u32 LE) || t_cost(u32 LE) || p_cost(u32 LE) || salt(16) || nonce(24) ||
//! XChaCha20-Poly1305(argon2id(passphrase), seed)`, the same KDF as backups.

use std::fmt;
use std::str::FromStr;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::backup::{KdfParams, MIN_PASSPHRASE_CHARS, derive_key, kdf_in_bounds};
use crate::crypto::{self, NONCE_LEN, random_bytes};
use crate::error::{Error, Result};
use crate::ids::hex_encode;

const MARKER_KEYCHAIN_V1: &[u8; 8] = b"HRMDKC1\0";
const MAGIC_KEYCHAIN: &[u8; 8] = b"HRMDKC2\0";
const ACCOUNT_LEN: usize = 16;
const KEYCHAIN_FILE_LEN: usize = 8 + ACCOUNT_LEN;
const MAGIC_PASSPHRASE: &[u8; 8] = b"HRMDPW1\0";
const SALT_LEN: usize = 16;
const HEADER_LEN: usize = 8 + 12 + SALT_LEN + NONCE_LEN;
const SEED_LEN: usize = 32;

/// A seed that wipes itself when dropped.
pub type Seed = Zeroizing<[u8; SEED_LEN]>;

/// Where the identity seed lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyMode {
    File,
    Keychain,
    Passphrase,
}

impl FromStr for KeyMode {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "file" => Ok(KeyMode::File),
            "keychain" => Ok(KeyMode::Keychain),
            "passphrase" => Ok(KeyMode::Passphrase),
            _ => Err(Error::invalid(
                "key mode",
                "use file, keychain or passphrase",
            )),
        }
    }
}

impl KeyMode {
    pub fn as_str(self) -> &'static str {
        match self {
            KeyMode::File => "file",
            KeyMode::Keychain => "keychain",
            KeyMode::Passphrase => "passphrase",
        }
    }
}

/// The OS keychain (or a stand-in): one secret per `account`. Implementations must not log the
/// value.
pub trait SecretStore: fmt::Debug + Send + Sync {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>>;
    fn set(&self, account: &str, secret: &[u8]) -> Result<()>;
    fn delete(&self, account: &str) -> Result<()>;
}

/// What is needed to read the key file: the keychain, and the passphrase once the person has
/// typed it. The passphrase is wiped on drop and must not outlive opening the data dir.
#[derive(Clone, Default)]
pub struct Unlock {
    pub store: Option<Arc<dyn SecretStore>>,
    pub passphrase: Option<Zeroizing<String>>,
    /// Keychain account of installs whose key file predates account ids (derived from the data
    /// dir path).
    pub legacy_account: Option<String>,
}

impl fmt::Debug for Unlock {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Unlock")
            .field("store", &self.store.is_some())
            .field("passphrase", &self.passphrase.is_some())
            .finish()
    }
}

/// Mode of a key file's bytes.
pub fn mode_of(raw: &[u8]) -> Result<KeyMode> {
    if raw.len() == SEED_LEN {
        Ok(KeyMode::File)
    } else if raw == MARKER_KEYCHAIN_V1
        || (raw.len() == KEYCHAIN_FILE_LEN && raw.starts_with(MAGIC_KEYCHAIN))
    {
        Ok(KeyMode::Keychain)
    } else if raw.starts_with(MAGIC_PASSPHRASE) {
        Ok(KeyMode::Passphrase)
    } else {
        Err(Error::invalid("identity key", "unrecognized key file"))
    }
}

/// Keychain account a key file's bytes point at, if they are a keychain marker.
pub fn keychain_account(raw: &[u8], unlock: &Unlock) -> Option<String> {
    if raw.len() == KEYCHAIN_FILE_LEN && raw.starts_with(MAGIC_KEYCHAIN) {
        Some(hex_encode(&raw[8..]))
    } else if raw == MARKER_KEYCHAIN_V1 {
        unlock.legacy_account.clone()
    } else {
        None
    }
}

fn seed_from(bytes: Zeroizing<Vec<u8>>) -> Result<Seed> {
    let seed: [u8; SEED_LEN] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| Error::invalid("identity key", "expected 32 bytes"))?;
    Ok(Zeroizing::new(seed))
}

fn unavailable(detail: impl fmt::Display) -> Error {
    Error::KeyUnavailable(detail.to_string())
}

/// Reads the seed out of a key file's bytes.
pub fn read_seed(raw: &[u8], unlock: &Unlock) -> Result<Seed> {
    match mode_of(raw)? {
        KeyMode::File => seed_from(Zeroizing::new(raw.to_vec())),
        KeyMode::Keychain => {
            let store = unlock
                .store
                .as_ref()
                .ok_or_else(|| unavailable("no keychain on this system"))?;
            let account = keychain_account(raw, unlock)
                .ok_or_else(|| unavailable("keychain entry is unknown"))?;
            let got = store
                .get(&account)
                .map_err(unavailable)?
                .ok_or_else(|| unavailable("the keychain entry is missing"))?;
            seed_from(got)
        }
        KeyMode::Passphrase => {
            let pass = unlock.passphrase.as_deref().ok_or(Error::Locked)?;
            open_sealed(raw, pass)
        }
    }
}

fn open_sealed(raw: &[u8], pass: &str) -> Result<Seed> {
    let bad = || Error::invalid("passphrase", "wrong passphrase or damaged key file");
    if raw.len() <= HEADER_LEN {
        return Err(bad());
    }
    let n = |i: usize| u32::from_le_bytes(raw[8 + i * 4..12 + i * 4].try_into().expect("4 bytes"));
    let params = KdfParams {
        m_cost_kib: n(0),
        t_cost: n(1),
        p_cost: n(2),
    };
    if !kdf_in_bounds(&params) {
        return Err(bad());
    }
    let salt = &raw[20..20 + SALT_LEN];
    let nonce: [u8; NONCE_LEN] = raw[20 + SALT_LEN..HEADER_LEN].try_into().expect("24 bytes");
    let key = derive_key(pass, salt, params)?;
    let plain = crypto::open(&key, &nonce, &raw[HEADER_LEN..]).map_err(|_| bad())?;
    seed_from(Zeroizing::new(plain)).map_err(|_| bad())
}

fn seal_seed(seed: &[u8; SEED_LEN], pass: &str, params: KdfParams) -> Result<Vec<u8>> {
    if pass.chars().count() < MIN_PASSPHRASE_CHARS {
        return Err(Error::invalid(
            "passphrase",
            format!("use at least {MIN_PASSPHRASE_CHARS} characters"),
        ));
    }
    if !kdf_in_bounds(&params) {
        return Err(Error::invalid(
            "passphrase",
            "unreasonable key derivation cost",
        ));
    }
    let salt: [u8; SALT_LEN] = random_bytes();
    let key = derive_key(pass, &salt, params)?;
    let (nonce, ct) = crypto::seal(&key, seed)?;
    let mut out = MAGIC_PASSPHRASE.to_vec();
    for v in [params.m_cost_kib, params.t_cost, params.p_cost] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Bytes to write to the key file for `mode`, already proven readable with `unlock`: a keychain
/// write (under a fresh account id) is read back and compared, a sealed file is opened again.
/// Nothing is written to disk here.
pub fn encode(
    seed: &[u8; SEED_LEN],
    mode: KeyMode,
    unlock: &Unlock,
    params: KdfParams,
) -> Result<Vec<u8>> {
    let bytes = match mode {
        KeyMode::File => seed.to_vec(),
        KeyMode::Keychain => {
            let store = unlock
                .store
                .as_ref()
                .ok_or_else(|| unavailable("no keychain on this system"))?;
            let id: [u8; ACCOUNT_LEN] = random_bytes();
            store.set(&hex_encode(&id), seed).map_err(unavailable)?;
            let mut out = MAGIC_KEYCHAIN.to_vec();
            out.extend_from_slice(&id);
            out
        }
        KeyMode::Passphrase => {
            let pass = unlock
                .passphrase
                .as_deref()
                .ok_or_else(|| Error::invalid("passphrase", "enter a passphrase"))?;
            seal_seed(seed, pass, params)?
        }
    };
    if *read_seed(&bytes, unlock)? != *seed {
        return Err(Error::invalid(
            "identity key",
            "new store did not read back",
        ));
    }
    Ok(bytes)
}
