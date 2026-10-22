//! Public entry point: [`Node::start`] and the cloneable [`NodeHandle`].

use std::sync::Arc;
use std::time::Duration;

use libp2p::{Multiaddr, PeerId, identity, noise, tcp, yamux};
use tokio::sync::{mpsc, oneshot};

use crate::behaviour::Behaviour;
use crate::config::{Limits, NodeConfig};
use crate::driver::{Command, Driver};
use crate::store::{BlobId, NodeStore, SpaceId};
use crate::types::{NodeError, NodeEvent, NodeStatus};

pub struct Node;

impl Node {
    /// Start the swarm on the current tokio runtime and return a handle plus the event stream.
    ///
    /// All network work is cooperative on that runtime, so the host should run it on a small
    /// dedicated runtime (2 worker threads, see the crate docs). Store calls run on blocking
    /// threads. `keypair_bytes` is the 32-byte ed25519 secret, so `PeerId` equals the user key.
    pub async fn start(
        config: NodeConfig,
        keypair_bytes: [u8; 32],
        store: Arc<dyn NodeStore>,
    ) -> Result<(NodeHandle, mpsc::UnboundedReceiver<NodeEvent>), NodeError> {
        let mut secret = keypair_bytes;
        let sk = identity::ed25519::SecretKey::try_from_bytes(&mut secret)
            .map_err(|e| NodeError::Startup(e.to_string()))?;
        let key = identity::Keypair::from(identity::ed25519::Keypair::from(sk));
        let peer_id = key.public().to_peer_id();
        let mut config = config;
        config.limits = config.limits.clone().clamped();

        let startup = |e: &dyn std::fmt::Display| NodeError::Startup(e.to_string());
        let swarm = libp2p::SwarmBuilder::with_existing_identity(key)
            .with_tokio()
            .with_tcp(
                tcp::Config::default().nodelay(true),
                noise::Config::new,
                yamux::Config::default,
            )
            .map_err(|e| startup(&e))?
            .with_quic()
            .with_dns()
            .map_err(|e| startup(&e))?
            .with_relay_client(noise::Config::new, yamux::Config::default)
            .map_err(|e| startup(&e))?
            .with_behaviour(|key, relay_client| Behaviour::new(key, relay_client, &config))
            .map_err(|e| startup(&e))?
            .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(300)))
            .build();

        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
        let (ev_tx, ev_rx) = mpsc::unbounded_channel();
        let (int_tx, int_rx) = mpsc::unbounded_channel();
        let driver = Driver::new(swarm, config, store, ev_tx, int_tx);
        tokio::spawn(driver.run(cmd_rx, int_rx));
        Ok((
            NodeHandle {
                tx: cmd_tx,
                peer_id,
            },
            ev_rx,
        ))
    }
}

#[derive(Clone)]
pub struct NodeHandle {
    tx: mpsc::UnboundedSender<Command>,
    peer_id: PeerId,
}

impl NodeHandle {
    pub fn peer_id(&self) -> PeerId {
        self.peer_id
    }

    async fn ask<T>(&self, f: impl FnOnce(oneshot::Sender<T>) -> Command) -> Result<T, NodeError> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(f(tx)).map_err(|_| NodeError::Closed)?;
        rx.await.map_err(|_| NodeError::Closed)
    }

    pub async fn join_space(&self, id: SpaceId) -> Result<(), NodeError> {
        self.ask(|r| Command::Join(id, r)).await?
    }

    pub async fn leave_space(&self, id: SpaceId) -> Result<(), NodeError> {
        self.ask(|r| Command::Leave(id, r)).await?
    }

    /// Gossip an already-stored event. Queued in the outbox until a peer is reachable.
    pub async fn publish_event(&self, space: SpaceId, bytes: Vec<u8>) -> Result<(), NodeError> {
        self.ask(|r| Command::Publish(space, bytes, r)).await?
    }

    /// Fetch a whole blob from peers into the store; resolves once every chunk is verified.
    pub async fn request_blob(&self, hash: BlobId) -> Result<(), NodeError> {
        self.ask(|r| Command::RequestBlob(hash, None, r)).await?
    }

    /// Fetch chunks `first..=last` of a blob (clamped to its size, manifest included) and
    /// resolve once they are verified and stored; the rest keeps downloading in the background.
    /// This is what a seek needs: the bytes under the playhead, not the whole file.
    pub async fn request_blob_chunks(
        &self,
        hash: BlobId,
        first: u32,
        last: u32,
    ) -> Result<(), NodeError> {
        self.ask(|r| Command::RequestBlob(hash, Some((first, last)), r))
            .await?
    }

    pub async fn announce_blob(&self, space: SpaceId, hash: BlobId) -> Result<(), NodeError> {
        self.ask(|r| Command::AnnounceBlob(space, hash, r)).await?
    }

    /// WebRTC signalling passthrough. `to: None` broadcasts to the space.
    pub async fn send_signal(
        &self,
        space: SpaceId,
        to: Option<PeerId>,
        payload: Vec<u8>,
    ) -> Result<(), NodeError> {
        self.ask(|r| Command::Signal(space, to, payload, r)).await?
    }

    /// Ephemeral broadcast (presence, typing, hearts). Rate limited, never stored.
    pub async fn send_ephemeral(
        &self,
        space: SpaceId,
        kind: &str,
        payload: Vec<u8>,
    ) -> Result<(), NodeError> {
        self.ask(|r| Command::Ephemeral(space, kind.to_string(), payload, r))
            .await?
    }

    /// Dial each address in turn; returns the first peer reached.
    pub async fn dial(&self, addrs: Vec<Multiaddr>) -> Result<PeerId, NodeError> {
        let mut last = NodeError::Dial("no addresses".into());
        for a in addrs {
            match self.ask(|r| Command::Dial(a, r)).await? {
                Ok(p) => return Ok(p),
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    /// Addresses worth putting in an invite: public and relay first, each ending in `/p2p/<me>`.
    pub async fn local_addrs(&self) -> Result<Vec<Multiaddr>, NodeError> {
        self.ask(Command::LocalAddrs).await
    }

    pub async fn status(&self) -> Result<NodeStatus, NodeError> {
        self.ask(Command::Status).await
    }

    /// Apply new caps (clamped to the hard ceilings) without restarting.
    pub async fn set_limits(&self, limits: Limits) -> Result<(), NodeError> {
        self.ask(|r| Command::SetLimits(limits, r)).await
    }

    pub async fn shutdown(&self) {
        let _ = self.ask(Command::Shutdown).await;
    }
}
