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
/// Longest accepted ephemeral `kind` label ("presence", "typing", ...).
pub const MAX_EPHEMERAL_KIND: usize = 32;
/// Inbound events per author, refill per second and burst. A backstop above every user-set
/// per-author cap (settings ceilings stay below it) so the store's own limit trips first.
pub const EVENT_IN_RATE: (f64, f64) = (100.0, 400.0);
/// Ephemeral messages (presence, typing) per peer, in and out: refill per second and burst.
pub const EPHEMERAL_RATE: (f64, f64) = (20.0, 60.0);
/// Inbound sync requests per peer: refill per second and burst.
pub const SYNC_IN_RATE: (f64, f64) = (10.0, 20.0);
/// Inbound signals (gossip and RPC) per peer: refill per second and burst.
pub const SIGNAL_IN_RATE: (f64, f64) = (10.0, 30.0);
/// Blob requests a single peer may have in flight with us; more are answered `data: None`.
pub const BLOB_SERVE_INFLIGHT_PER_PEER: u32 = 16;
/// Announced providers remembered per blob with an active fetch job.
pub const MAX_PROVIDERS_PER_BLOB: usize = 32;
/// Strikes (rate floods, rejected or undecodable gossip) within a maintenance interval that earn a ban.
pub const STRIKE_LIMIT: u32 = 50;
/// How long a peer that hit `STRIKE_LIMIT` stays banned.
pub const BAN_SECS: u64 = 600;
/// Parallel chunk requests per blob.
pub const BLOB_WINDOW: usize = 8;
/// Inbound gossip messages per propagation source (any author), refill per second and burst.
/// Above the per-author cap because an honest forwarder relays several authors, but bounded so
/// rotating the unauthenticated author header buys no extra budget.
pub const PEER_GOSSIP_IN_RATE: (f64, f64) = (300.0, 1200.0);
/// Most keys one `RateMap` tracks; at the cap the least recently seen key is evicted.
pub const RATE_MAP_MAX_KEYS: usize = 4096;
/// Seconds without traffic after which a `RateMap` key is dropped by `gc`.
pub const RATE_MAP_IDLE_SECS: u64 = 120;
/// Gossiped events being ingested on blocking threads at once; more are ignored (not forwarded).
pub const INGEST_QUEUE_CAP: usize = 64;
/// Sync pages served at once across all peers; more are answered empty.
pub const SYNC_SERVE_GLOBAL_MAX: usize = 8;
/// Blob requests served at once across all peers; more are answered `data: None`.
pub const BLOB_SERVE_GLOBAL_MAX: usize = 64;
/// Request-response timeout for sync and blob requests.
pub const RPC_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// A blob reply that the serve rate limiter would delay longer than this is refused instead.
pub const BLOB_SERVE_MAX_WAIT: std::time::Duration = std::time::Duration::from_secs(15);
/// Rejected (bad signature, malformed) events in one sync page tolerated before the sender is struck.
pub const SYNC_REJECT_TOLERANCE: usize = 8;
/// Share of `max_connections` that may be inbound, in percent, so dialers cannot fill every slot.
pub const INCOMING_CONN_PERCENT: u32 = 75;
/// Connected share of `max_connections`, in percent, above which idle non-space peers are dropped.
pub const EVICT_CONN_PERCENT: u32 = 90;
/// Provider dials started per rendezvous key between maintenance ticks.
pub const KAD_PROVIDER_DIALS_PER_KEY: u32 = 8;
/// Addresses remembered per peer (peer book, relay reservation targets).
pub const MAX_ADDRS_PER_PEER: usize = 4;
/// Peers asked for a blob that are neither announced providers nor space members.
pub const BLOB_FALLBACK_PEERS: usize = 2;
/// Misses (no data, bad data, failure) after which a peer is no longer asked for a blob job.
pub const BLOB_PEER_MISS_LIMIT: u32 = 3;

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

impl Ephemeral {
    /// Within the size caps on both `kind` and `payload`.
    pub fn fits(&self) -> bool {
        self.kind.len() <= MAX_EPHEMERAL_KIND && self.payload.len() <= MAX_EPHEMERAL_BYTES
    }
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
    fn ephemeral_kind_is_capped() {
        let e = |kind: String| Ephemeral {
            kind,
            payload: ByteBuf::new(),
        };
        assert!(e("x".repeat(MAX_EPHEMERAL_KIND)).fits());
        assert!(!e("x".repeat(MAX_EPHEMERAL_KIND + 1)).fits());
    }

    #[test]
    fn rendezvous_differs_from_space() {
        let s = [7u8; 32];
        assert_ne!(rendezvous_key(&s), s.to_vec());
    }
}
