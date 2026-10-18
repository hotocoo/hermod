//! Serving blobs to the WebView: HTTP Range parsing, reading only the chunks a range touches,
//! content type detection, and on-demand fetching of missing chunks through the node.
//! Shared by the `hermod-blob://` URI scheme and the devhost `/blob/:hash` route.

use std::time::Duration;

use hermod_core::blobs::CHUNK_SIZE;
use hermod_core::ids;

use crate::ctx::Ctx;

/// Largest single response body. Bigger blobs are served as partial content, which media
/// elements and browsers handle by following up with further ranges.
pub const MAX_RESPONSE: u64 = 8 * 1024 * 1024;
/// Whole-body (non Range) responses up to this size are sent as 200.
pub const MAX_FULL: u64 = 64 * 1024 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RangeReq {
    /// No usable Range header: whole blob.
    Full,
    /// Inclusive byte range, already clamped to the blob.
    Bytes(u64, u64),
    /// Valid syntax but outside the blob (HTTP 416).
    Unsatisfiable,
}

/// Parse a single `bytes=a-b`, `bytes=a-` or `bytes=-n` range. Multi-range is treated as the
/// first range, which every media client accepts.
pub fn parse_range(header: Option<&str>, size: u64) -> RangeReq {
    let Some(h) = header else {
        return RangeReq::Full;
    };
    let Some(spec) = h.trim().strip_prefix("bytes=") else {
        return RangeReq::Full;
    };
    let first = spec.split(',').next().unwrap_or("").trim();
    let Some((a, b)) = first.split_once('-') else {
        return RangeReq::Full;
    };
    if size == 0 {
        return RangeReq::Unsatisfiable;
    }
    let last = size - 1;
    match (a.trim(), b.trim()) {
        ("", n) => match n.parse::<u64>() {
            Ok(n) if n > 0 => RangeReq::Bytes(size.saturating_sub(n), last),
            _ => RangeReq::Unsatisfiable,
        },
        (a, "") => match a.parse::<u64>() {
            Ok(a) if a <= last => RangeReq::Bytes(a, last),
            _ => RangeReq::Unsatisfiable,
        },
        (a, b) => match (a.parse::<u64>(), b.parse::<u64>()) {
            (Ok(a), Ok(b)) if a <= b && a <= last => RangeReq::Bytes(a, b.min(last)),
            _ => RangeReq::Unsatisfiable,
        },
    }
}

/// A response ready to write out.
#[derive(Debug)]
pub struct BlobResponse {
    pub status: u16,
    pub mime: String,
    pub total: u64,
    /// `Some((start, end))` for 206.
    pub range: Option<(u64, u64)>,
    pub body: Vec<u8>,
}

impl BlobResponse {
    pub fn headers(&self) -> Vec<(&'static str, String)> {
        let mut h = vec![
            ("Content-Type", self.mime.clone()),
            ("Accept-Ranges", "bytes".to_string()),
            ("Content-Length", self.body.len().to_string()),
            (
                "Cache-Control",
                "private, max-age=31536000, immutable".to_string(),
            ),
            ("X-Content-Type-Options", "nosniff".to_string()),
            ("Access-Control-Allow-Origin", "*".to_string()),
            ("Cross-Origin-Resource-Policy", "cross-origin".to_string()),
            // A blob is data: whatever it is, it may not run script or load anything.
            (
                "Content-Security-Policy",
                "default-src 'none'; style-src 'unsafe-inline'; sandbox".to_string(),
            ),
        ];
        match (self.status, self.range) {
            (206, Some((a, b))) => {
                h.push(("Content-Range", format!("bytes {a}-{b}/{}", self.total)))
            }
            (416, _) => h.push(("Content-Range", format!("bytes */{}", self.total))),
            _ => {}
        }
        h
    }

    fn error(status: u16) -> Self {
        BlobResponse {
            status,
            mime: "text/plain".into(),
            total: 0,
            range: None,
            body: Vec::new(),
        }
    }
}

pub fn is_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Find the blob hash in a request URI: `hermod-blob://<hash>` (host) or
/// `http://hermod-blob.localhost/<hash>` (path, Windows and Android).
pub fn hash_from_uri(host: Option<&str>, path: &str) -> Option<String> {
    let p = path.trim_matches('/');
    if is_hash(p) {
        return Some(p.to_ascii_lowercase());
    }
    host.filter(|h| is_hash(h)).map(str::to_ascii_lowercase)
}

/// Content type: a type recorded from the event that referenced the blob wins, then content
/// sniffing of the first bytes, then `application/octet-stream`.
pub fn mime_of(recorded: Option<&str>, head: &[u8]) -> String {
    if let Some(m) = recorded.filter(|m| !m.is_empty() && *m != "application/octet-stream") {
        return m.to_string();
    }
    infer::get(head)
        .map(|t| t.mime_type().to_string())
        .unwrap_or_else(|| "application/octet-stream".into())
}

fn read_span(
    ctx_blobs: &hermod_core::blobs::BlobStore,
    id: &str,
    a: u64,
    b: u64,
) -> Result<Vec<u8>, String> {
    let cs = CHUNK_SIZE as u64;
    let mut out = Vec::with_capacity((b - a + 1) as usize);
    for idx in (a / cs)..=(b / cs) {
        let chunk = ctx_blobs
            .read_chunk(id, idx as u32)
            .map_err(|e| e.to_string())?;
        let base = idx * cs;
        let from = a.saturating_sub(base) as usize;
        let to = ((b + 1).min(base + chunk.len() as u64) - base) as usize;
        if from > to || to > chunk.len() {
            return Err("blob chunk is shorter than its manifest says".into());
        }
        out.extend_from_slice(&chunk[from..to]);
    }
    Ok(out)
}

/// Make sure the blob is complete locally, asking peers for the rest when it is not.
pub async fn ensure_local(ctx: &Ctx, hash: &str) -> Result<(), String> {
    let live = ctx.live().await?;
    let blobs = live.core.blobs();
    if blobs.is_complete(hash).unwrap_or(false) {
        return Ok(());
    }
    let id: [u8; 32] = ids::hex_decode_array(hash).map_err(|e| e.to_string())?;
    let node = ctx
        .node()
        .await
        .ok_or("this file is not on this device yet and the network is off")?;
    match tokio::time::timeout(FETCH_TIMEOUT, node.request_blob(id)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(format!("could not fetch this file from peers: {e}")),
        Err(_) => Err("timed out fetching this file from peers".into()),
    }
}

/// Serve `hash` for an optional `Range` header.
pub async fn serve(ctx: &Ctx, hash: &str, range: Option<&str>) -> BlobResponse {
    if !is_hash(hash) {
        return BlobResponse::error(400);
    }
    if let Err(e) = ensure_local(ctx, hash).await {
        tracing::warn!("blob {hash}: {e}");
        return BlobResponse::error(404);
    }
    let Ok(live) = ctx.live().await else {
        return BlobResponse::error(503);
    };
    let blobs = live.core.blobs();
    let manifest = match blobs.manifest(hash) {
        Ok(Some(m)) => m,
        _ => return BlobResponse::error(404),
    };
    let total = manifest.size;
    let recorded = live.blob_mime(hash);
    let head_len = total.min(512);
    let head = if head_len > 0 {
        read_span(blobs, hash, 0, head_len - 1).unwrap_or_default()
    } else {
        Vec::new()
    };
    let mime = mime_of(recorded.as_deref(), &head);
    let (status, span) = match parse_range(range, total) {
        RangeReq::Unsatisfiable => {
            return BlobResponse {
                status: 416,
                mime,
                total,
                range: None,
                body: Vec::new(),
            };
        }
        RangeReq::Bytes(a, b) => (206, Some((a, b.min(a + MAX_RESPONSE - 1)))),
        RangeReq::Full if total > MAX_FULL => (206, Some((0, MAX_RESPONSE - 1))),
        RangeReq::Full => (200, None),
    };
    let (a, b) = span.unwrap_or((0, total.saturating_sub(1)));
    let body = if total == 0 {
        Ok(Vec::new())
    } else {
        read_span(blobs, hash, a, b)
    };
    match body {
        Ok(body) => BlobResponse {
            status,
            mime,
            total,
            range: span,
            body,
        },
        Err(e) => {
            tracing::error!("blob {hash} read failed: {e}");
            BlobResponse::error(500)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range(None, 100), RangeReq::Full);
        assert_eq!(parse_range(Some("bytes=0-9"), 100), RangeReq::Bytes(0, 9));
        assert_eq!(parse_range(Some("bytes=90-"), 100), RangeReq::Bytes(90, 99));
        assert_eq!(parse_range(Some("bytes=-10"), 100), RangeReq::Bytes(90, 99));
        assert_eq!(
            parse_range(Some("bytes=50-500"), 100),
            RangeReq::Bytes(50, 99)
        );
        assert_eq!(
            parse_range(Some("bytes=100-"), 100),
            RangeReq::Unsatisfiable
        );
        assert_eq!(parse_range(Some("bytes=9-3"), 100), RangeReq::Unsatisfiable);
        assert_eq!(
            parse_range(Some("bytes=0-1,5-6"), 100),
            RangeReq::Bytes(0, 1)
        );
        assert_eq!(parse_range(Some("items=0-1"), 100), RangeReq::Full);
        assert_eq!(parse_range(Some("bytes=0-1"), 0), RangeReq::Unsatisfiable);
    }

    #[test]
    fn hash_in_host_or_path() {
        let h = "ab".repeat(32);
        assert_eq!(hash_from_uri(Some(&h), ""), Some(h.clone()));
        assert_eq!(
            hash_from_uri(Some("hermod-blob.localhost"), &format!("/{h}")),
            Some(h.clone())
        );
        assert_eq!(hash_from_uri(Some("x"), "/nothex"), None);
    }

    #[test]
    fn mime_prefers_recorded_then_sniffs() {
        let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
        assert_eq!(mime_of(Some("video/mp4"), &png), "video/mp4");
        assert_eq!(mime_of(None, &png), "image/png");
        assert_eq!(mime_of(Some("application/octet-stream"), &png), "image/png");
        assert_eq!(mime_of(None, b"plain"), "application/octet-stream");
    }
}
