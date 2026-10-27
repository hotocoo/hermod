//! G-006: the node is neither started nor listening before the Terms are accepted.

use std::net::TcpListener;
use std::time::Duration;

use hermodr_lib::api;
use hermodr_lib::ctx::{Ctx, Options};
use serde_json::json;
use tokio::net::TcpStream;

const POLL: Duration = Duration::from_millis(100);
const WAIT: Duration = Duration::from_secs(20);

/// A port nothing listens on right now (bound, read, released).
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

async fn open(port: u16) -> (tempfile::TempDir, std::sync::Arc<Ctx>) {
    let dir = tempfile::tempdir().unwrap();
    let addr = format!("/ip4/127.0.0.1/tcp/{port}").parse().unwrap();
    let ctx = Ctx::open(
        dir.path().to_path_buf(),
        Options::localhost(None, vec![addr]),
        None,
    )
    .await
    .unwrap();
    (dir, ctx)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_node_and_no_peer_port_until_terms_are_accepted() {
    let port = free_port();
    let (_dir, ctx) = open(port).await;

    // Before accept: gate shows, node is down, nothing listens on the configured peer port.
    let legal = api::handle(&ctx, "legal_status", json!({})).await.unwrap();
    assert!(
        legal["accepted_version"].is_null(),
        "fresh run has no accepted Terms"
    );
    let st = api::handle(&ctx, "node_status", json!({})).await.unwrap();
    assert_eq!(st["running"], false);
    assert_eq!(st["listen"], json!([]));
    assert!(ctx.node().await.is_none());
    assert!(
        ctx.start_node().await.is_err(),
        "start_node refuses before accept"
    );
    assert!(ctx.node().await.is_none(), "refused start leaves no node");
    assert!(
        TcpStream::connect(("127.0.0.1", port)).await.is_err(),
        "peer port must be closed before accept"
    );

    // After accept: node runs and the peer port opens.
    api::handle(
        &ctx,
        "legal_accept",
        json!({"version": "1", "shareResources": true}),
    )
    .await
    .unwrap();
    assert!(ctx.node().await.is_some(), "accept starts the node");
    let start = std::time::Instant::now();
    loop {
        if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            break;
        }
        assert!(
            start.elapsed() < WAIT,
            "peer port never opened after accept"
        );
        tokio::time::sleep(POLL).await;
    }
    let st = api::handle(&ctx, "node_status", json!({})).await.unwrap();
    assert_eq!(st["running"], true);
    ctx.shutdown().await;
}
