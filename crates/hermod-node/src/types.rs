//! Public value types: events, status, errors.

use libp2p::PeerId;
use serde::Serialize;

use crate::store::SpaceId;

#[derive(Debug, thiserror::Error)]
pub enum NodeError {
    #[error("node is shut down")]
    Closed,
    #[error("invalid argument: {0}")]
    Invalid(String),
    #[error("dial failed: {0}")]
    Dial(String),
    #[error("blob transfer failed: {0}")]
    Blob(String),
    #[error("startup failed: {0}")]
    Startup(String),
    #[error("publish failed: {0}")]
    Publish(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Reachability {
    Unknown,
    Public,
    Private,
}

/// Snapshot for the network panel (`node_status`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NodeStatus {
    pub peer_id: String,
    /// Connected peers.
    pub peers: u32,
    pub spaces: u32,
    /// Circuits this node currently relays for others.
    pub relaying_circuits: u32,
    /// True while the relay server behaviour is active.
    pub relay_serving: bool,
    pub reachability: Reachability,
    pub external_addrs: Vec<String>,
    /// Relay circuit addresses we listen on (we are NATed and reachable through them).
    pub relay_listen: Vec<String>,
    /// External address mapped by UPnP, if any.
    pub upnp: Option<String>,
    /// Application payload bytes (events, blobs, signals) received and sent in total.
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub rate_in_bps: u64,
    pub rate_out_bps: u64,
    /// Syncs with peers still running.
    pub sync_pending: u32,
    /// Events queued because no peer was reachable yet.
    pub outbox: u32,
    /// Peers currently banned for flooding.
    pub banned: u32,
}

#[derive(Debug, Clone)]
pub enum NodeEvent {
    EventsIngested {
        space: SpaceId,
        count: usize,
    },
    Signal {
        space: SpaceId,
        from: PeerId,
        payload: Vec<u8>,
    },
    /// Ephemeral gossip (presence, typing, hearts): never stored.
    Ephemeral {
        space: SpaceId,
        from: PeerId,
        kind: String,
        payload: Vec<u8>,
    },
    Status(NodeStatus),
    PeerJoined {
        space: SpaceId,
        peer: PeerId,
    },
    PeerLeft {
        space: SpaceId,
        peer: PeerId,
    },
    /// Events queued for peers plus syncs in flight, for the `hermod://sync` indicator.
    SyncPending {
        count: u32,
    },
}
