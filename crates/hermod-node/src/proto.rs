//! Wire types: request-response payloads and gossip envelopes.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;

use crate::store::{Author, BlobId, SpaceId};

pub const SYNC_PROTOCOL: &str = "/hermod/sync/1";
pub const BLOB_PROTOCOL: &str = "/hermod/blob/1";
pub const SIGNAL_PROTOCOL: &str = "/hermod/signal/1";
pub const KAD_PROTOCOL: &str = "/hermod/kad/1";
pub const IDENTIFY_PROTOCOL: &str = "/hermod/id/1";

/// Events per sync page.
pub const SYNC_PAGE_EVENTS: usize = 128;
/// Soft byte ceiling per sync page.
pub const SYNC_PAGE_BYTES: usize = 4 * 1024 * 1024;
/// Largest signal payload accepted.
pub const MAX_SIGNAL_BYTES: usize = 64 * 1024;
/// Largest event accepted for gossip (matches `MAX_EVENT_BYTES` in hermod-core).
pub const MAX_GOSSIP_EVENT: usize = (1 << 20) + 4096;
/// Largest ephemeral message (presence, typing, hearts).
pub const MAX_EPHEMERAL_BYTES: usize = 2048;
/// Parallel chunk requests per blob.
pub const BLOB_WINDOW: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncReq {
    pub space: SpaceId,
    pub vector: BTreeMap<Author, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResp {
    pub events: Vec<ByteBuf>,
    /// True when the page was cut and the requester should ask again with its new vector.
    pub more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobReq {
    pub blob: BlobId,
    /// `None` asks for the manifest, `Some(i)` for chunk `i`.
    pub idx: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobResp {
    pub data: Option<ByteBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalReq {
    pub space: SpaceId,
    pub payload: ByteBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalAck {
    pub ok: bool,
}

/// Gossip envelope on `hermod/space/<hex>`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Gossip {
    Event(ByteBuf),
    /// Sender holds this blob and will serve it.
    Provide(BlobId),
    /// WebRTC signalling or presence. `to` is a base58 PeerId, `None` means everyone.
    Signal {
        to: Option<String>,
        payload: ByteBuf,
    },
}

/// Ephemeral message on `hermod/eph/<hex>`: never stored, rate limited.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ephemeral {
    pub kind: String,
    pub payload: ByteBuf,
}

pub fn eph_topic_name(space: &SpaceId) -> String {
    format!("hermod/eph/{}", hex::encode(space))
}

pub fn topic_name(space: &SpaceId) -> String {
    format!("hermod/space/{}", hex::encode(space))
}

/// DHT rendezvous key: hash of the space id, never the key.
pub fn rendezvous_key(space: &SpaceId) -> Vec<u8> {
    blake3::hash(&[b"hermod/rendezvous/1".as_slice(), space].concat())
        .as_bytes()
        .to_vec()
}

pub fn encode<T: Serialize>(v: &T) -> Vec<u8> {
    let mut out = Vec::new();
    // Serializing into a Vec cannot fail for these types.
    let _ = ciborium::into_writer(v, &mut out);
    out
}

pub fn decode<T: for<'a> Deserialize<'a>>(b: &[u8]) -> Option<T> {
    ciborium::from_reader(b).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gossip_roundtrip() {
        let g = Gossip::Signal {
            to: Some("x".into()),
            payload: ByteBuf::from(vec![1, 2, 3]),
        };
        match decode::<Gossip>(&encode(&g)) {
            Some(Gossip::Signal { to, payload }) => {
                assert_eq!(to.as_deref(), Some("x"));
                assert_eq!(payload.as_ref(), &[1, 2, 3]);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn rendezvous_differs_from_space() {
        let s = [7u8; 32];
        assert_ne!(rendezvous_key(&s), s.to_vec());
    }
}
