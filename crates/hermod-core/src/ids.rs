//! Identifier newtypes and hex/bytes serde helpers.

use std::fmt;
use std::str::FromStr;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::{Error, Result};

/// Lowercase hex encoding.
pub fn hex_encode(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
    out
}

fn nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    }
}

/// Strict (lowercase only) hex decoding to a byte vector.
pub fn hex_decode(s: &str) -> Result<Vec<u8>> {
    let b = s.as_bytes();
    if !b.len().is_multiple_of(2) {
        return Err(Error::invalid("hex", "odd length"));
    }
    b.chunks(2)
        .map(|p| match (nibble(p[0]), nibble(p[1])) {
            (Some(h), Some(l)) => Ok(h << 4 | l),
            _ => Err(Error::invalid("hex", "non-hex character")),
        })
        .collect()
}

/// Strict hex decoding to a fixed-size array.
pub fn hex_decode_array<const N: usize>(s: &str) -> Result<[u8; N]> {
    hex_decode(s)?
        .try_into()
        .map_err(|_| Error::invalid("hex", format!("expected {N} bytes")))
}

struct BytesVisitor;

impl<'de> Visitor<'de> for BytesVisitor {
    type Value = Vec<u8>;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a byte string")
    }
    fn visit_bytes<E: de::Error>(self, v: &[u8]) -> std::result::Result<Vec<u8>, E> {
        Ok(v.to_vec())
    }
    fn visit_byte_buf<E: de::Error>(self, v: Vec<u8>) -> std::result::Result<Vec<u8>, E> {
        Ok(v)
    }
    fn visit_seq<A: de::SeqAccess<'de>>(
        self,
        mut seq: A,
    ) -> std::result::Result<Vec<u8>, A::Error> {
        let mut out = Vec::new();
        while let Some(b) = seq.next_element::<u8>()? {
            out.push(b);
        }
        Ok(out)
    }
}

fn bytes_or_hex<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Vec<u8>, D::Error> {
    if d.is_human_readable() {
        let s = String::deserialize(d)?;
        hex_decode(&s).map_err(de::Error::custom)
    } else {
        d.deserialize_byte_buf(BytesVisitor)
    }
}

/// serde adapter for `[u8; N]`: hex in JSON, raw bytes in CBOR.
pub mod fixed {
    use super::*;

    pub fn serialize<S: Serializer, const N: usize>(
        v: &[u8; N],
        s: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        if s.is_human_readable() {
            s.serialize_str(&hex_encode(v))
        } else {
            s.serialize_bytes(v)
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>, const N: usize>(
        d: D,
    ) -> std::result::Result<[u8; N], D::Error> {
        bytes_or_hex(d)?
            .try_into()
            .map_err(|_| de::Error::custom(format!("expected {N} bytes")))
    }
}

/// serde adapter for `Vec<u8>`: hex in JSON, raw bytes in CBOR.
pub mod bytes {
    use super::*;

    pub fn serialize<S: Serializer>(v: &[u8], s: S) -> std::result::Result<S::Ok, S::Error> {
        if s.is_human_readable() {
            s.serialize_str(&hex_encode(v))
        } else {
            s.serialize_bytes(v)
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Vec<u8>, D::Error> {
        bytes_or_hex(d)
    }
}

/// A user: base58 of an ed25519 public key.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct UserId(pub [u8; 32]);

impl UserId {
    /// First 8 characters of the base58 form, for display.
    pub fn short(&self) -> String {
        self.to_string().chars().take(8).collect()
    }
}

impl fmt::Display for UserId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&bs58::encode(self.0).into_string())
    }
}

impl fmt::Debug for UserId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "UserId({})", self.short())
    }
}

impl FromStr for UserId {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        if s.len() > 64 {
            return Err(Error::invalid("user id", "too long"));
        }
        let v = bs58::decode(s)
            .into_vec()
            .map_err(|e| Error::invalid("user id", e.to_string()))?;
        let arr: [u8; 32] = v
            .try_into()
            .map_err(|_| Error::invalid("user id", "expected 32 bytes"))?;
        Ok(UserId(arr))
    }
}

impl Serialize for UserId {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for UserId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(de::Error::custom)
    }
}

/// A space: random 32 bytes, hex in text forms.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SpaceId(pub [u8; 32]);

impl SpaceId {
    pub fn random() -> Self {
        SpaceId(crate::crypto::random_bytes())
    }
}

impl fmt::Display for SpaceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&hex_encode(&self.0))
    }
}

impl fmt::Debug for SpaceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SpaceId({})", hex_encode(&self.0[..4]))
    }
}

impl FromStr for SpaceId {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self> {
        hex_decode_array::<32>(s).map(SpaceId)
    }
}

impl Serialize for SpaceId {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        fixed::serialize(&self.0, s)
    }
}

impl<'de> Deserialize<'de> for SpaceId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        fixed::deserialize(d).map(SpaceId)
    }
}
