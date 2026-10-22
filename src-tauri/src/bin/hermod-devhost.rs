//! Dev and E2E host: the exact Tauri command set over HTTP on 127.0.0.1, backed by a real
//! `Core` and a real `Node`. Never shipped (cargo feature `devhost`, excluded from bundles).
//!
//! `POST /invoke/{command}` (JSON args) -> JSON result or an error string with HTTP 400,
//! `GET /events` SSE (`event:` is the Tauri event name), `GET /blob/{hash}` with Range.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Extension;
use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use clap::Parser;
use futures::Stream;
use hermodr_lib::ctx::{Ctx, Options};
use hermodr_lib::{api, blob};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;
use tower_http::cors::{AllowOrigin, CorsLayer};

#[derive(Parser)]
#[command(
    version,
    about = "Hermod devhost: real Core and Node behind HTTP, for E2E tests"
)]
struct Args {
    /// Holds the identity, database, blobs and log.
    #[arg(long)]
    data_dir: PathBuf,
    /// HTTP port on 127.0.0.1.
    #[arg(long)]
    port: u16,
    /// libp2p listen multiaddr (repeatable). Default: 127.0.0.1 on a free TCP port.
    #[arg(long)]
    listen: Vec<hermod_node::Multiaddr>,
}

type Shared = Arc<Ctx>;

/// A JSON body (a cross-site form cannot send one without a CORS preflight) addressed to
/// `127.0.0.1:<port>` (a DNS-rebound hostname fails this).
fn invoke_allowed(headers: &HeaderMap, port: u16) -> bool {
    let json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(';')
                .next()
                .is_some_and(|m| m.trim().eq_ignore_ascii_case("application/json"))
        });
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok());
    json && host == Some(format!("127.0.0.1:{port}").as_str())
}

async fn invoke(
    State(ctx): State<Shared>,
    Extension(port): Extension<u16>,
    headers: HeaderMap,
    Path(cmd): Path<String>,
    body: axum::body::Bytes,
) -> Response {
    if !invoke_allowed(&headers, port) {
        return (StatusCode::FORBIDDEN, "request not allowed").into_response();
    }
    let args: serde_json::Value = if body.is_empty() {
        serde_json::json!({})
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return (StatusCode::BAD_REQUEST, format!("bad json: {e}")).into_response(),
        }
    };
    match api::handle(&ctx, &cmd, args).await {
        Ok(v) => axum::Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

async fn events(State(ctx): State<Shared>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = BroadcastStream::new(ctx.subscribe()).filter_map(|m| {
        m.ok()
            .map(|ev| Ok(Event::default().event(ev.name).data(ev.payload.to_string())))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn blob_route(
    State(ctx): State<Shared>,
    Path(hash): Path<String>,
    headers: HeaderMap,
) -> Response {
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let r = blob::serve(&ctx, &hash, range).await;
    let mut resp = Response::new(Body::from(r.body.clone()));
    *resp.status_mut() =
        StatusCode::from_u16(r.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    for (k, v) in r.headers() {
        if let (Ok(k), Ok(v)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(&v),
        ) {
            resp.headers_mut().insert(k, v);
        }
    }
    resp
}

fn origin_ok(o: &HeaderValue) -> bool {
    o.to_str().is_ok_and(|s| {
        ["http://localhost:", "http://127.0.0.1:"]
            .iter()
            .any(|pre| {
                s.strip_prefix(pre)
                    .is_some_and(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
            })
    })
}

#[tokio::main]
async fn main() -> anyhow_free::Result<()> {
    let a = Args::parse();
    std::fs::create_dir_all(&a.data_dir)?;
    let log = a.data_dir.join("hermod.log");
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)?;
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with_writer(std::sync::Mutex::new(file))
        .with_ansi(false)
        .init();
    let ctx = Ctx::open(
        a.data_dir.clone(),
        Options::localhost(Some(log), a.listen),
        None,
    )
    .await?;
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|o, _| origin_ok(o)))
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
        .allow_headers([header::CONTENT_TYPE, header::RANGE]);
    let app = Router::new()
        .route("/invoke/{command}", post(invoke))
        .route("/events", get(events))
        .route("/blob/{hash}", get(blob_route))
        .layer(Extension(a.port))
        .layer(cors)
        .with_state(ctx.clone());
    let addr = SocketAddr::from(([127, 0, 0, 1], a.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("hermod-devhost listening on http://{addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    ctx.shutdown().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(ct: Option<&str>, host: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(header::HOST, host.parse().unwrap());
        if let Some(ct) = ct {
            h.insert(header::CONTENT_TYPE, ct.parse().unwrap());
        }
        h
    }

    #[test]
    fn invoke_needs_json_and_the_loopback_host() {
        assert!(invoke_allowed(
            &headers(Some("application/json"), "127.0.0.1:7000"),
            7000
        ));
        assert!(invoke_allowed(
            &headers(Some("Application/JSON; charset=utf-8"), "127.0.0.1:7000"),
            7000
        ));
        assert!(!invoke_allowed(
            &headers(Some("text/plain"), "127.0.0.1:7000"),
            7000
        ));
        assert!(!invoke_allowed(&headers(None, "127.0.0.1:7000"), 7000));
        assert!(!invoke_allowed(
            &headers(Some("application/json"), "evil.example:7000"),
            7000
        ));
        assert!(!invoke_allowed(
            &headers(Some("application/json"), "127.0.0.1:7001"),
            7000
        ));
    }
}

mod anyhow_free {
    pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
}
