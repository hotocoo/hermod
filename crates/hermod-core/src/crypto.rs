//! XChaCha20-Poly1305 sealing for space keys, BLAKE3 hashing, randomness.

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::{Error, Result};
use crate::ids;

/// Length of the XChaCha20 nonce in bytes.
pub const NONCE_LEN: usize = 24;

/// Cryptographically secure random bytes from the OS.
pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    rand::fill(&mut buf);
    buf
}

/// BLAKE3 digest of `data`.
pub fn blake3_hash(data: &[u8]) -> [u8; 32] {
    *blake3::hash(data).as_bytes()
}

/// Symmetric key of one space.
#[derive(Clone, PartialEq, Eq)]
pub struct SpaceKey(pub [u8; 32]);

impl SpaceKey {
    pub fn random() -> Self {
        SpaceKey(random_bytes())
    }
}

impl std::fmt::Debug for SpaceKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SpaceKey(..)")
    }
}

impl Serialize for SpaceKey {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        ids::fixed::serialize(&self.0, s)
    }
}

impl<'de> Deserialize<'de> for SpaceKey {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        ids::fixed::deserialize(d).map(SpaceKey)
    }
}

/// Encrypts `plaintext` with a fresh random nonce. Returns `(nonce, ciphertext)`.
pub fn seal(key: &SpaceKey, plaintext: &[u8]) -> Result<([u8; NONCE_LEN], Vec<u8>)> {
    let nonce: [u8; NONCE_LEN] = random_bytes();
    let ct = seal_with_nonce(key, &nonce, plaintext)?;
    Ok((nonce, ct))
}

/// Encrypts with a caller supplied nonce (never reuse a nonce under one key).
pub fn seal_with_nonce(
    key: &SpaceKey,
    nonce: &[u8; NONCE_LEN],
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new(&Key::from(key.0));
    cipher
        .encrypt(&XNonce::from(*nonce), plaintext)
        .map_err(|_| Error::Decrypt)
}

/// Decrypts and authenticates. Any tampering yields [`Error::Decrypt`].
pub fn open(key: &SpaceKey, nonce: &[u8; NONCE_LEN], ciphertext: &[u8]) -> Result<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new(&Key::from(key.0));
    cipher
        .decrypt(&XNonce::from(*nonce), ciphertext)
        .map_err(|_| Error::Decrypt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let key = SpaceKey::random();
        let (n, ct) = seal(&key, b"hello hermod").unwrap();
        assert_ne!(&ct[..12], b"hello hermod");
        assert_eq!(open(&key, &n, &ct).unwrap(), b"hello hermod");
    }

    #[test]
    fn tamper_is_rejected() {
        let key = SpaceKey::random();
        let (n, mut ct) = seal(&key, b"payload").unwrap();
        ct[0] ^= 1;
        assert!(matches!(open(&key, &n, &ct), Err(Error::Decrypt)));
        ct[0] ^= 1;
        let mut n2 = n;
        n2[0] ^= 1;
        assert!(open(&key, &n2, &ct).is_err());
        assert!(open(&SpaceKey::random(), &n, &ct).is_err());
        assert!(open(&key, &n, &ct[..ct.len() - 1]).is_err());
    }

    #[test]
    fn nonces_are_fresh() {
        let key = SpaceKey::random();
        let (a, _) = seal(&key, b"x").unwrap();
        let (b, _) = seal(&key, b"x").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn blake3_is_stable() {
        assert_eq!(
            ids::hex_encode(&blake3_hash(b"")),
            "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
        );
    }
}
