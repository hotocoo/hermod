//! Encrypted backup of an install: identity, spaces and keys, event log, local state, blobs.
//!
//! File layout: `"HRMDBK1\0" || m_cost(u32 LE) || t_cost(u32 LE) || p_cost(u32 LE) || salt(16) ||
//! nonce(24) || XChaCha20-Poly1305(argon2id(passphrase), CBOR(Payload))`. The KDF cost is stored
//! so old backups stay readable when defaults change.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};

use crate::crypto::{self, NONCE_LEN, SpaceKey, random_bytes};
use crate::error::{Error, Result};
use crate::ids;

const MAGIC: &[u8; 8] = b"HRMDBK1\0";
const SALT_LEN: usize = 16;
const HEADER_LEN: usize = 8 + 12 + SALT_LEN + NONCE_LEN;
/// Ceiling on KDF cost accepted from a file, so a crafted backup cannot exhaust memory.
const MAX_M_COST_KIB: u32 = 1 << 20;
const MAX_T_COST: u32 = 20;
const MAX_P_COST: u32 = 16;
const MIN_PASSPHRASE_CHARS: usize = 8;

/// Argon2id cost parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        KdfParams {
            m_cost_kib: 64 * 1024,
            t_cost: 3,
            p_cost: 1,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SpaceBackup {
    pub id: ids::SpaceId,
    pub name: String,
    pub kind: String,
    pub is_home: bool,
    pub joined_at: i64,
    pub left: bool,
    /// `(epoch, key)` pairs.
    pub keys: Vec<(u32, SpaceKey)>,
    /// CBOR wire form of every stored event.
    pub events: Vec<serde_bytes_compat::Bytes>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BlobBackup {
    pub id: String,
    #[serde(with = "ids::bytes")]
    pub manifest: Vec<u8>,
    pub chunks: Vec<(String, serde_bytes_compat::Bytes)>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Payload {
    pub v: u8,
    #[serde(with = "ids::fixed")]
    pub identity_seed: [u8; 32],
    pub spaces: Vec<SpaceBackup>,
    pub kv: BTreeMap<String, String>,
    pub read_markers: Vec<(ids::SpaceId, String, u64)>,
    pub blocks: Vec<String>,
    pub follows: Vec<(String, String)>,
    pub blobs: Vec<BlobBackup>,
}

/// Raw bytes as a CBOR byte string (and hex in JSON), for fields that are not fixed size.
pub mod serde_bytes_compat {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct Bytes(pub Vec<u8>);

    impl Serialize for Bytes {
        fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
            crate::ids::bytes::serialize(&self.0, s)
        }
    }

    impl<'de> Deserialize<'de> for Bytes {
        fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
            crate::ids::bytes::deserialize(d).map(Bytes)
        }
    }
}

fn derive_key(passphrase: &str, salt: &[u8], p: KdfParams) -> Result<SpaceKey> {
    let params = Params::new(p.m_cost_kib, p.t_cost, p.p_cost, Some(32))
        .map_err(|e| Error::invalid("backup", e.to_string()))?;
    let mut out = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, &mut out)
        .map_err(|e| Error::invalid("backup", e.to_string()))?;
    Ok(SpaceKey(out))
}

/// Encrypts `payload` into the file format above.
pub fn seal(payload: &Payload, passphrase: &str, params: KdfParams) -> Result<Vec<u8>> {
    if passphrase.chars().count() < MIN_PASSPHRASE_CHARS {
        return Err(Error::invalid(
            "passphrase",
            format!("use at least {MIN_PASSPHRASE_CHARS} characters"),
        ));
    }
    let mut plain = Vec::new();
    ciborium::into_writer(payload, &mut plain).map_err(|e| Error::Cbor(e.to_string()))?;
    let salt: [u8; SALT_LEN] = random_bytes();
    let nonce: [u8; NONCE_LEN] = random_bytes();
    let key = derive_key(passphrase, &salt, params)?;
    let ct = crypto::seal_with_nonce(&key, &nonce, &plain)?;
    let mut out = MAGIC.to_vec();
    for n in [params.m_cost_kib, params.t_cost, params.p_cost] {
        out.extend_from_slice(&n.to_le_bytes());
    }
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Decrypts a backup. A wrong passphrase or a damaged file is reported the same way.
pub fn open(file: &[u8], passphrase: &str) -> Result<Payload> {
    let bad = || Error::invalid("backup", "wrong passphrase or damaged file");
    if file.len() <= HEADER_LEN || &file[..8] != MAGIC {
        return Err(Error::invalid("backup", "not a Hermod backup"));
    }
    let n = |i: usize| u32::from_le_bytes(file[8 + i * 4..12 + i * 4].try_into().expect("4 bytes"));
    let params = KdfParams {
        m_cost_kib: n(0),
        t_cost: n(1),
        p_cost: n(2),
    };
    if params.m_cost_kib > MAX_M_COST_KIB
        || params.t_cost > MAX_T_COST
        || params.p_cost > MAX_P_COST
    {
        return Err(Error::invalid("backup", "unreasonable key derivation cost"));
    }
    let salt = &file[20..20 + SALT_LEN];
    let nonce: [u8; NONCE_LEN] = file[20 + SALT_LEN..HEADER_LEN]
        .try_into()
        .expect("24 bytes");
    let key = derive_key(passphrase, salt, params)?;
    let plain = crypto::open(&key, &nonce, &file[HEADER_LEN..]).map_err(|_| bad())?;
    let payload: Payload = ciborium::from_reader(plain.as_slice()).map_err(|_| bad())?;
    if payload.v != 1 {
        return Err(Error::invalid(
            "backup",
            format!("unsupported backup version {}", payload.v),
        ));
    }
    Ok(payload)
}

pub fn write_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}
