//! Hermod network node: one libp2p swarm per install.
//!
//! * gossipsub topic per space (`hermod/space/<hex>`) for new events, blob provider
//!   announcements and signalling; `hermod/eph/<hex>` for ephemeral presence/typing/hearts.
//! * request-response `/hermod/sync/1`, `/hermod/blob/1`, `/hermod/signal/1`.
//! * discovery: mDNS, Kademlia (standard IPFS DHT in client mode plus `/hermod/kad/1`),
//!   rendezvous provider record per space (hash of the space id, never the key).
//! * NAT: AutoNAT, UPnP, circuit relay (server when Public, client reservations otherwise), DCUtR.
//! * resource governor: [`config::Limits`] with hard ceilings.
//!
//! # Runtime
//! The caller supplies the tokio runtime; the node spawns one driver task on it. Run it on a
//! dedicated 2-worker runtime (`tokio::runtime::Builder::new_multi_thread().worker_threads(2)`)
//! so network work never takes more than two threads. Store calls use `spawn_blocking`.
//!
//! # Known limits
//! Relay bandwidth is enforced as a per-circuit byte budget (`rate * duration`), circuit
//! count and duration, because rust-libp2p exposes no per-byte hook in the relay server.
//! Bandwidth counters in [`NodeStatus`] count application payload bytes, not wire bytes.

mod addr;
mod behaviour;
mod blobjob;
pub mod bucket;
pub mod config;
mod driver;
mod node;
pub mod proto;
pub mod store;
mod types;

pub use libp2p::{Multiaddr, PeerId};
pub use node::{Node, NodeHandle};
pub use types::{NodeError, NodeEvent, NodeStatus, Reachability};

/// Crate version, for diagnostics.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
