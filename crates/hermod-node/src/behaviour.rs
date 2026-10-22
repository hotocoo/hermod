//! The composed libp2p behaviour.

use std::error::Error;
use std::time::Duration;

use libp2p::swarm::NetworkBehaviour;
use libp2p::swarm::behaviour::toggle::Toggle;
use libp2p::{
    PeerId, StreamProtocol, allow_block_list, autonat, connection_limits, dcutr, gossipsub,
    identify, identity, kad, mdns, ping, relay, request_response, upnp,
};

use crate::config::{Limits, NodeConfig};
use crate::proto::*;

pub type Kad = kad::Behaviour<kad::store::MemoryStore>;
pub type Rpc<Q, R> = request_response::cbor::Behaviour<Q, R>;

#[derive(NetworkBehaviour)]
pub struct Behaviour {
    pub limits: connection_limits::Behaviour,
    /// Banned (flooding) peers: refused before a connection is established, in both directions.
    pub blocked: allow_block_list::Behaviour<allow_block_list::BlockedPeers>,
    pub identify: identify::Behaviour,
    pub ping: ping::Behaviour,
    pub autonat: autonat::v1::Behaviour,
    pub upnp: Toggle<upnp::tokio::Behaviour>,
    pub mdns: Toggle<mdns::tokio::Behaviour>,
    /// Hermod-only routing table (volunteer nodes), custom protocol name.
    pub kad_hermod: Kad,
    /// Standard IPFS routing, client mode: finds peers and rendezvous records via public nodes.
    pub kad_ipfs: Toggle<Kad>,
    pub gossipsub: gossipsub::Behaviour,
    pub sync: Rpc<SyncReq, SyncResp>,
    pub blob: Rpc<BlobReq, BlobResp>,
    pub signal: Rpc<SignalReq, SignalAck>,
    pub relay_server: Toggle<relay::Behaviour>,
    pub relay_client: relay::client::Behaviour,
    pub dcutr: dcutr::Behaviour,
}

pub fn conn_limits(l: &Limits) -> connection_limits::ConnectionLimits {
    connection_limits::ConnectionLimits::default()
        .with_max_established(Some(l.max_connections))
        .with_max_pending_incoming(Some(l.max_connections.min(32)))
        .with_max_pending_outgoing(Some(l.max_connections.min(32)))
        .with_max_established_per_peer(Some(4))
}

pub fn relay_config(l: &Limits) -> relay::Config {
    let circuits = l.relay_circuits as usize;
    relay::Config {
        max_reservations: (circuits * 4).max(1),
        max_reservations_per_peer: 1,
        max_circuits: circuits,
        max_circuits_per_peer: circuits.clamp(1, 2),
        max_circuit_duration: Duration::from_secs(l.relay_circuit_secs),
        max_circuit_bytes: l.circuit_byte_budget(),
        ..relay::Config::default()
    }
}

pub fn relay_server(local: PeerId, l: &Limits) -> Toggle<relay::Behaviour> {
    Toggle::from((l.relay_circuits > 0).then(|| relay::Behaviour::new(local, relay_config(l))))
}

fn rpc<Q, R>(proto: &'static str, timeout: Duration) -> Rpc<Q, R>
where
    Q: serde::Serialize + for<'a> serde::Deserialize<'a> + Send + 'static,
    R: serde::Serialize + for<'a> serde::Deserialize<'a> + Send + 'static,
{
    request_response::cbor::Behaviour::new(
        [(
            StreamProtocol::new(proto),
            request_response::ProtocolSupport::Full,
        )],
        request_response::Config::default().with_request_timeout(timeout),
    )
}

impl Behaviour {
    pub fn new(
        key: &identity::Keypair,
        relay_client: relay::client::Behaviour,
        cfg: &NodeConfig,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let local = key.public().to_peer_id();
        let kad_cfg = |proto: StreamProtocol| {
            let mut c = kad::Config::new(proto);
            c.set_query_timeout(Duration::from_secs(30));
            c
        };
        let mut kad_hermod = kad::Behaviour::with_config(
            local,
            kad::store::MemoryStore::new(local),
            kad_cfg(StreamProtocol::new(KAD_PROTOCOL)),
        );
        if cfg.allow_private_addrs {
            kad_hermod.set_mode(Some(kad::Mode::Server));
        }
        let kad_ipfs = cfg.enable_dht.then(|| {
            let mut k = kad::Behaviour::with_config(
                local,
                kad::store::MemoryStore::new(local),
                kad_cfg(kad::PROTOCOL_NAME),
            );
            k.set_mode(Some(kad::Mode::Client));
            k
        });
        let mdns = if cfg.enable_mdns {
            Some(mdns::tokio::Behaviour::new(mdns::Config::default(), local)?)
        } else {
            None
        };
        let gossip_cfg = gossipsub::ConfigBuilder::default()
            .heartbeat_interval(cfg.gossip_heartbeat)
            .validation_mode(gossipsub::ValidationMode::Strict)
            .max_transmit_size(2 * 1024 * 1024)
            .build()
            .map_err(|e| e.to_string())?;
        let gossipsub = gossipsub::Behaviour::new(
            gossipsub::MessageAuthenticity::Signed(key.clone()),
            gossip_cfg,
        )?;
        let an = autonat::v1::Config {
            only_global_ips: !cfg.allow_private_addrs,
            ..Default::default()
        };
        Ok(Self {
            limits: connection_limits::Behaviour::new(conn_limits(&cfg.limits)),
            blocked: allow_block_list::Behaviour::default(),
            identify: identify::Behaviour::new(
                identify::Config::new(IDENTIFY_PROTOCOL.into(), key.public())
                    .with_agent_version(format!("hermod-node/{}", env!("CARGO_PKG_VERSION"))),
            ),
            ping: ping::Behaviour::default(),
            autonat: autonat::v1::Behaviour::new(local, an),
            upnp: Toggle::from(cfg.enable_upnp.then(upnp::tokio::Behaviour::default)),
            mdns: Toggle::from(mdns),
            kad_hermod,
            kad_ipfs: Toggle::from(kad_ipfs),
            gossipsub,
            sync: rpc(SYNC_PROTOCOL, Duration::from_secs(30)),
            blob: rpc(BLOB_PROTOCOL, Duration::from_secs(30)),
            signal: rpc(SIGNAL_PROTOCOL, Duration::from_secs(10)),
            relay_server: relay_server(local, &cfg.limits),
            relay_client,
            dcutr: dcutr::Behaviour::new(local),
        })
    }
}
