//! Headless relay/bootstrap peer. Joins no spaces: it serves circuit relay, DHT and
//! AutoNAT for the network. Identity and known peers persist under `--data-dir`.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use hermod_node::config::{Limits, NodeConfig, RelayMode};
use hermod_node::store::{FilePeerBook, RelayOnlyStore};
use hermod_node::{Multiaddr, Node, NodeEvent};
use libp2p::identity::ed25519;

#[derive(Clone, Copy, ValueEnum)]
enum Mode {
    Auto,
    Always,
    Never,
}

#[derive(Parser)]
#[command(version, about = "Hermod relay/bootstrap peer")]
struct Args {
    /// Holds `identity.key` (0600) and `peers.json`.
    #[arg(long, default_value = "./hermod-node-data")]
    data_dir: PathBuf,
    /// Listen address; repeatable. Default: TCP and QUIC on port 4001.
    #[arg(long)]
    listen: Vec<Multiaddr>,
    /// Address reachable from outside (static IP or DNS name); repeatable.
    #[arg(long)]
    external_addr: Vec<Multiaddr>,
    /// Replace the public IPFS bootstrap list; repeatable.
    #[arg(long)]
    bootstrap: Vec<Multiaddr>,
    #[arg(long)]
    no_bootstrap: bool,
    /// `auto` serves only when AutoNAT reports Public.
    #[arg(long, value_enum, default_value = "auto")]
    relay: Mode,
    #[arg(long, default_value_t = 8)]
    relay_circuits: u32,
    /// Average relay bytes per second per circuit.
    #[arg(long, default_value_t = 256 * 1024)]
    relay_bps: u64,
    #[arg(long, default_value_t = 64)]
    max_connections: u32,
    #[arg(long)]
    no_mdns: bool,
    #[arg(long)]
    no_upnp: bool,
    /// Treat private and loopback addresses as shareable (LAN or testing).
    #[arg(long)]
    allow_private: bool,
}

fn load_or_create_key(path: &PathBuf) -> Result<[u8; 32]> {
    if let Ok(b) = fs::read(path) {
        return b
            .try_into()
            .map_err(|_| anyhow::anyhow!("{} must hold exactly 32 bytes", path.display()));
    }
    let kp = ed25519::Keypair::generate();
    let secret: [u8; 32] = kp.secret().as_ref().try_into().context("secret length")?;
    fs::write(path, secret)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(secret)
}

// Two worker threads: the network never takes more than that.
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let a = Args::parse();
    fs::create_dir_all(&a.data_dir)?;
    let key = load_or_create_key(&a.data_dir.join("identity.key"))?;

    let mut cfg = NodeConfig::default();
    if !a.listen.is_empty() {
        cfg.listen = a.listen;
    } else {
        cfg.listen = vec![
            "/ip4/0.0.0.0/tcp/4001".parse()?,
            "/ip4/0.0.0.0/udp/4001/quic-v1".parse()?,
        ];
    }
    cfg.external_addrs = a.external_addr;
    if a.no_bootstrap {
        cfg.bootstrap.clear();
    } else if !a.bootstrap.is_empty() {
        cfg.bootstrap = a.bootstrap;
    }
    cfg.relay_mode = match a.relay {
        Mode::Auto => RelayMode::Auto,
        Mode::Always => RelayMode::Always,
        Mode::Never => RelayMode::Never,
    };
    cfg.enable_mdns = !a.no_mdns;
    cfg.enable_upnp = !a.no_upnp;
    cfg.allow_private_addrs = a.allow_private;
    cfg.limits = Limits {
        relay_circuits: a.relay_circuits,
        relay_bandwidth_bps: a.relay_bps,
        max_connections: a.max_connections,
        ..Limits::default()
    };
    cfg.peer_book =
        Arc::new(FilePeerBook::open(a.data_dir.join("peers.json")).context("open peers.json")?);

    let (handle, mut events) = Node::start(cfg, key, Arc::new(RelayOnlyStore)).await?;
    println!("peer id: {}", handle.peer_id());

    let mut printed = Vec::new();
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => break,
            ev = events.recv() => match ev {
                Some(NodeEvent::Status(s)) => {
                    let addrs = handle.local_addrs().await.unwrap_or_default();
                    if addrs != printed {
                        for ad in &addrs { println!("listen: {ad}"); }
                        if addrs.is_empty() { println!("no shareable address yet (waiting for AutoNAT or --external-addr)"); }
                        printed = addrs;
                    }
                    tracing::info!(peers = s.peers, circuits = s.relaying_circuits, relay = s.relay_serving, reach = ?s.reachability, "status");
                }
                Some(_) => {}
                None => break,
            }
        }
    }
    handle.shutdown().await;
    Ok(())
}
