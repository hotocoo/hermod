//! Node configuration and the resource governor limits (defaults and hard ceilings come
//! from ARCHITECTURE.md section 7).

use std::sync::Arc;
use std::time::Duration;

use libp2p::Multiaddr;

use crate::store::{NoPeerBook, PeerBook};

pub const CEIL_RELAY_CIRCUITS: u32 = 32;
pub const CEIL_RELAY_BPS: u64 = 2 * 1024 * 1024;
pub const CEIL_CONNECTIONS: u32 = 256;

/// Public IPFS bootstrap peers: entry points into the DHT.
pub const IPFS_BOOTSTRAP: &[&str] = &[
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
];

/// Resource caps. Values above the hard ceilings are clamped, never rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Limits {
    /// Simultaneous relayed circuits (default 8, ceiling 32).
    pub relay_circuits: u32,
    /// Average relay rate per circuit in bytes/s (default 256 KiB/s, ceiling 2 MiB/s).
    /// Enforced as a per-circuit byte budget (`rate * circuit_secs`), see crate docs.
    pub relay_bandwidth_bps: u64,
    /// Bytes per circuit before it is cut (default 64 MiB).
    pub relay_bytes_per_circuit: u64,
    /// Seconds a circuit may live.
    pub relay_circuit_secs: u64,
    /// Established connections (default 64, ceiling 256).
    pub max_connections: u32,
    /// Blob serving rate for other peers in bytes/s (0 = unlimited).
    pub blob_serve_bps: u64,
    /// When true the relay server is off regardless of reachability (battery, user switch).
    pub relay_paused: bool,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            relay_circuits: 8,
            relay_bandwidth_bps: 256 * 1024,
            relay_bytes_per_circuit: 64 * 1024 * 1024,
            relay_circuit_secs: 30 * 60,
            max_connections: 64,
            blob_serve_bps: 2 * 1024 * 1024,
            relay_paused: false,
        }
    }
}

impl Limits {
    pub fn clamped(mut self) -> Self {
        self.relay_circuits = self.relay_circuits.min(CEIL_RELAY_CIRCUITS);
        self.relay_bandwidth_bps = self.relay_bandwidth_bps.clamp(1, CEIL_RELAY_BPS);
        self.max_connections = self.max_connections.clamp(8, CEIL_CONNECTIONS);
        self.relay_circuit_secs = self.relay_circuit_secs.max(1);
        self
    }

    /// Effective per-circuit byte budget: the smaller of the explicit cap and rate*duration.
    pub fn circuit_byte_budget(&self) -> u64 {
        self.relay_bytes_per_circuit.min(
            self.relay_bandwidth_bps
                .saturating_mul(self.relay_circuit_secs),
        )
    }
}

/// Whether this node acts as a circuit relay server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayMode {
    /// Serve only while AutoNAT reports Public and relaying is not paused.
    Auto,
    /// Serve whenever not paused (volunteer servers, tests).
    Always,
    /// Never serve.
    Never,
}

#[derive(Clone)]
pub struct NodeConfig {
    pub listen: Vec<Multiaddr>,
    /// DHT entry points. Empty disables public bootstrap (tests).
    pub bootstrap: Vec<Multiaddr>,
    /// Known relay servers (full addr ending in `/p2p/<id>`) to reserve a slot on when NATed.
    pub relays: Vec<Multiaddr>,
    /// Addresses known to be reachable from outside (static IP, port forward, DNS name).
    pub external_addrs: Vec<Multiaddr>,
    pub relay_mode: RelayMode,
    /// Reserve on `relays` at start instead of waiting for AutoNAT to say Private.
    pub reserve_always: bool,
    pub enable_mdns: bool,
    pub enable_upnp: bool,
    pub enable_dht: bool,
    /// Accept/advertise loopback and private ranges (local testing, LAN-only deployments).
    pub allow_private_addrs: bool,
    pub gossip_heartbeat: Duration,
    /// How often the DHT is re-queried and the peer book flushed.
    pub maintenance_interval: Duration,
    pub blob_timeout: Duration,
    pub limits: Limits,
    pub peer_book: Arc<dyn PeerBook>,
}

impl Default for NodeConfig {
    fn default() -> Self {
        let p = |s: &str| s.parse().expect("static multiaddr");
        Self {
            listen: vec![p("/ip4/0.0.0.0/tcp/0"), p("/ip4/0.0.0.0/udp/0/quic-v1")],
            bootstrap: IPFS_BOOTSTRAP.iter().map(|s| p(s)).collect(),
            relays: Vec::new(),
            external_addrs: Vec::new(),
            relay_mode: RelayMode::Auto,
            reserve_always: false,
            enable_mdns: true,
            enable_upnp: true,
            enable_dht: true,
            allow_private_addrs: false,
            gossip_heartbeat: Duration::from_secs(1),
            maintenance_interval: Duration::from_secs(60),
            blob_timeout: Duration::from_secs(120),
            limits: Limits::default(),
            peer_book: Arc::new(NoPeerBook),
        }
    }
}
