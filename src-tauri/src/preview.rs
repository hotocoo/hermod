//! Link previews, fetched by the SENDER's node only (docs/MESSAGING.md 3.10).
//!
//! The result travels inside the message, so receivers never contact the site. The fetch is
//! deliberately narrow: http and https only, the host is resolved here and every address must
//! be public (no loopback, private, link-local, unique-local, CGNAT, multicast, mapped or
//! embedded IPv4 that is not public), the connection is pinned to the validated address so it
//! cannot re-resolve to something else, redirects are followed by hand and re-validated, the
//! response is streamed with a hard byte cap, and only the head is scanned for metadata
//! (nothing is parsed as a DOM and nothing is executed).

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::{Duration, Instant};

use hermod_core::{BlobRef, Core};
use reqwest::{Client, StatusCode, Url, redirect::Policy};
use serde::Serialize;

pub const MAX_PAGE_BYTES: usize = 512 * 1024;
pub const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
pub const PAGE_TIMEOUT: Duration = Duration::from_secs(3);
pub const MAX_REDIRECTS: usize = 3;
const MAX_URL_LEN: usize = 2048;
const MAX_TITLE: usize = 200;
const MAX_DESC: usize = 300;
const USER_AGENT: &str = "Mozilla/5.0 (compatible; HermodLinkPreview/1.0)";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PreviewOut {
    pub url: String,
    pub title: String,
    pub description: String,
    pub image: Option<BlobRef>,
}

#[derive(Debug, Clone, Copy)]
struct Opts {
    /// Only the unit tests talk to a loopback server.
    allow_private: bool,
}

/// True for addresses reachable on the public internet.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => public_v4(v),
        IpAddr::V6(v) => public_v6(v),
    }
}

fn public_v4(v: Ipv4Addr) -> bool {
    let o = v.octets();
    !(v.is_unspecified()
        || v.is_loopback()
        || v.is_private()
        || v.is_link_local()
        || v.is_broadcast()
        || v.is_documentation()
        || v.is_multicast()
        || o[0] == 0
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64.0.0/10 carrier-grade NAT
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24 protocol assignments
        || (o[0] == 198 && (o[1] & 0xfe) == 18) // 198.18.0.0/15 benchmarking
        || o[0] >= 240) // reserved
}

fn public_v6(v: Ipv6Addr) -> bool {
    if let Some(m) = v.to_ipv4_mapped() {
        return public_v4(m);
    }
    let s = v.segments();
    // 64:ff9b::/96 NAT64 and 2002::/16 6to4 embed an IPv4 address.
    let embedded =
        |hi: u16, lo: u16| Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8);
    if s[0] == 0x64 && s[1] == 0xff9b && s[2..6].iter().all(|x| *x == 0) {
        return public_v4(embedded(s[6], s[7]));
    }
    if s[0] == 0x2002 {
        return public_v4(embedded(s[1], s[2]));
    }
    !(v.is_unspecified()
        || v.is_loopback()
        || v.is_multicast()
        || (s[0] & 0xfe00) == 0xfc00 // unique local
        || (s[0] & 0xffc0) == 0xfe80 // link-local
        || (s[0] & 0xffc0) == 0xfec0 // deprecated site-local
        || (s[0] == 0x2001 && s[1] == 0x0db8) // documentation
        || (s[0] == 0x2001 && s[1] == 0) // teredo
        || s[0] == 0x0100 && s[1..4].iter().all(|x| *x == 0)) // discard-only
}

/// Parses and validates the scheme, host and shape of a URL.
fn parse_url(raw: &str) -> Result<Url, String> {
    if raw.len() > MAX_URL_LEN {
        return Err("that link is too long".into());
    }
    let url = Url::parse(raw.trim()).map_err(|_| "that is not a valid link".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only http and https links get previews".into());
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err("that link has no host".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("links with a login are not previewed".into());
    }
    Ok(url)
}

/// Resolves the host and returns one address, refusing when any answer is not public.
async fn resolve(url: &Url, deadline: Instant, opts: Opts) -> Result<(String, SocketAddr), String> {
    let host = url.host_str().ok_or("that link has no host")?.to_string();
    let port = url.port_or_known_default().ok_or("that link has no port")?;
    let addrs: Vec<SocketAddr> = match host.trim_matches(['[', ']']).parse::<IpAddr>() {
        Ok(ip) => vec![SocketAddr::new(ip, port)],
        Err(_) => tokio::time::timeout(
            deadline.saturating_duration_since(Instant::now()),
            tokio::net::lookup_host((host.as_str(), port)),
        )
        .await
        .map_err(|_| "that site took too long".to_string())?
        .map_err(|_| "that site could not be found".to_string())?
        .collect(),
    };
    let first = *addrs.first().ok_or("that site could not be found")?;
    if !opts.allow_private && addrs.iter().any(|a| !is_public_ip(a.ip())) {
        return Err("that address is not on the public internet".into());
    }
    Ok((host, first))
}

struct Fetched {
    final_url: Url,
    content_type: String,
    body: Vec<u8>,
    truncated: bool,
}

/// One GET with validation, manual redirects and a streamed byte cap.
async fn get(
    start: &Url,
    max_bytes: usize,
    deadline: Instant,
    opts: Opts,
) -> Result<Fetched, String> {
    let mut url = start.clone();
    for _ in 0..=MAX_REDIRECTS {
        let (host, addr) = resolve(&url, deadline, opts).await?;
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err("that site took too long".into());
        }
        let client = Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .timeout(left)
            .user_agent(USER_AGENT)
            .resolve(&host, addr)
            .build()
            .map_err(|_| "preview could not start".to_string())?;
        let mut resp = client
            .get(url.clone())
            .header("accept", "text/html,application/xhtml+xml,image/*;q=0.8")
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    "that site took too long".to_string()
                } else {
                    "that site could not be reached".to_string()
                }
            })?;
        if resp.status().is_redirection() {
            let next = resp
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or("that site redirected nowhere")?;
            url = url
                .join(next)
                .map_err(|_| "that site redirected somewhere invalid".to_string())?;
            parse_url(url.as_str())?;
            continue;
        }
        if resp.status() != StatusCode::OK {
            return Err(format!("that site answered {}", resp.status().as_u16()));
        }
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let mut body = Vec::new();
        let mut truncated = false;
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|_| "that site took too long".to_string())?
        {
            let room = max_bytes - body.len();
            if chunk.len() >= room {
                body.extend_from_slice(&chunk[..room]);
                truncated = true;
                break;
            }
            body.extend_from_slice(&chunk);
        }
        return Ok(Fetched {
            final_url: url,
            content_type,
            body,
            truncated,
        });
    }
    Err("that link redirects too many times".into())
}

#[derive(Debug, Default, PartialEq)]
pub struct Meta {
    pub title: String,
    pub description: String,
    pub image: String,
}

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        // Search bytes: a fixed byte window may end inside a multi-byte character.
        let Some(end) = rest.as_bytes()[..rest.len().min(12)]
            .iter()
            .position(|&b| b == b';')
        else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..end];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            _ => ent
                .strip_prefix("#x")
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| ent.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn clean(s: &str, max: usize) -> String {
    let s = decode_entities(s);
    let s: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    s.chars().filter(|c| !c.is_control()).take(max).collect()
}

/// Attributes of one tag body (`name="v" other=v`), lowercased names.
fn attrs(tag: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let b = tag.as_bytes();
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
            i += 1;
        }
        let ns = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' && b[i] != b'/' {
            i += 1;
        }
        let name = tag[ns..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() {
                i += 1;
            }
            let val = if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i];
                i += 1;
                let vs = i;
                while i < b.len() && b[i] != q {
                    i += 1;
                }
                let v = &tag[vs..i];
                i = (i + 1).min(b.len());
                v
            } else {
                let vs = i;
                while i < b.len() && !b[i].is_ascii_whitespace() {
                    i += 1;
                }
                &tag[vs..i]
            };
            if !name.is_empty() {
                out.push((name, val.to_string()));
            }
        } else if !name.is_empty() {
            out.push((name, String::new()));
        }
    }
    out
}

/// Title, description and image from `<title>` and `og:` or `twitter:` meta tags. Plain text
/// scanning: no DOM, no script execution.
pub fn parse_meta(html: &str) -> Meta {
    let lower = html.to_ascii_lowercase();
    let mut m = Meta::default();
    let (mut og_title, mut tw_title) = (String::new(), String::new());
    let (mut og_desc, mut tw_desc, mut name_desc) = (String::new(), String::new(), String::new());
    let (mut og_img, mut tw_img) = (String::new(), String::new());
    let mut pos = 0;
    while let Some(off) = lower[pos..].find("<meta") {
        let start = pos + off + 5;
        let Some(end) = lower[start..].find('>') else {
            break;
        };
        pos = start + end;
        if !lower[start..].starts_with(|c: char| c.is_ascii_whitespace()) {
            continue;
        }
        let a = attrs(&html[start..start + end]);
        let get = |k: &str| a.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        let Some(content) = get("content") else {
            continue;
        };
        let key = get("property")
            .or(get("name"))
            .unwrap_or("")
            .to_ascii_lowercase();
        let slot = match key.as_str() {
            "og:title" => &mut og_title,
            "twitter:title" => &mut tw_title,
            "og:description" => &mut og_desc,
            "twitter:description" => &mut tw_desc,
            "description" => &mut name_desc,
            "og:image" | "og:image:url" | "og:image:secure_url" => &mut og_img,
            "twitter:image" | "twitter:image:src" => &mut tw_img,
            _ => continue,
        };
        if slot.is_empty() {
            *slot = content.to_string();
        }
    }
    let page_title = lower.find("<title").and_then(|i| {
        let open = lower[i..].find('>')? + i + 1;
        let close = lower[open..].find("</title")? + open;
        Some(html[open..close].to_string())
    });
    let pick = |xs: &[&String]| {
        xs.iter()
            .find(|s| !s.trim().is_empty())
            .map(|s| (*s).clone())
            .unwrap_or_default()
    };
    m.title = clean(
        &pick(&[&og_title, &tw_title, &page_title.unwrap_or_default()]),
        MAX_TITLE,
    );
    m.description = clean(&pick(&[&og_desc, &tw_desc, &name_desc]), MAX_DESC);
    m.image = pick(&[&og_img, &tw_img]).trim().to_string();
    m
}

fn image_ext(content_type: &str) -> Option<&'static str> {
    match content_type {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

async fn fetch_inner(core: &Core, raw: &str, opts: Opts) -> Result<PreviewOut, String> {
    let url = parse_url(raw)?;
    let deadline = Instant::now() + PAGE_TIMEOUT;
    let page = get(&url, MAX_PAGE_BYTES, deadline, opts).await?;
    if !matches!(
        page.content_type.as_str(),
        "text/html" | "application/xhtml+xml"
    ) {
        return Err("that link is not a web page".into());
    }
    let html = String::from_utf8_lossy(&page.body);
    let meta = parse_meta(&html);
    let _ = page.truncated;
    if meta.title.is_empty() && meta.description.is_empty() {
        return Err("that page has nothing to preview".into());
    }
    let image = if meta.image.is_empty() {
        None
    } else {
        fetch_image(core, &page.final_url, &meta.image, opts).await
    };
    Ok(PreviewOut {
        url: page.final_url.to_string(),
        title: meta.title,
        description: meta.description,
        image,
    })
}

/// A failed image never fails the preview.
async fn fetch_image(core: &Core, base: &Url, src: &str, opts: Opts) -> Option<BlobRef> {
    let url = base.join(src.trim()).ok()?;
    parse_url(url.as_str()).ok()?;
    let got = get(&url, MAX_IMAGE_BYTES, Instant::now() + PAGE_TIMEOUT, opts)
        .await
        .ok()?;
    if got.truncated || got.body.is_empty() {
        return None;
    }
    let ext = image_ext(&got.content_type)?;
    core.blob_put_bytes(&format!("preview.{ext}"), &got.body)
        .ok()
}

/// Fetches a preview for `url`. Refuses unless the user turned previews on.
pub async fn fetch(core: &Core, url: &str) -> Result<PreviewOut, String> {
    if core
        .setting_get("privacy.previews")
        .ok()
        .flatten()
        .as_deref()
        != Some("1")
    {
        return Err("link previews are off, turn them on in privacy settings".into());
    }
    fetch_inner(
        core,
        url,
        Opts {
            allow_private: false,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn public_ip_table() {
        for bad in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "0.0.0.0",
            "100.64.0.1",
            "224.0.0.1",
            "255.255.255.255",
            "192.0.2.1",
            "198.18.0.1",
            "240.0.0.1",
            "::1",
            "::",
            "fe80::1",
            "fc00::1",
            "fd12:3456::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "64:ff9b::7f00:1",
            "2002:7f00:1::1",
            "2001:db8::1",
            "2001::1",
            "fec0::1",
        ] {
            assert!(!is_public_ip(bad.parse().unwrap()), "{bad} must be refused");
        }
        for good in [
            "93.184.216.34",
            "8.8.8.8",
            "2606:4700:4700::1111",
            "::ffff:8.8.8.8",
            "1.1.1.1",
        ] {
            assert!(is_public_ip(good.parse().unwrap()), "{good} must pass");
        }
    }

    #[test]
    fn url_shapes() {
        assert!(parse_url("ftp://example.org").is_err());
        assert!(parse_url("file:///etc/passwd").is_err());
        assert!(parse_url("javascript:alert(1)").is_err());
        assert!(parse_url("http://user:pw@example.org/").is_err());
        assert!(parse_url("https://").is_err());
        assert!(parse_url(&format!("https://a.org/{}", "x".repeat(3000))).is_err());
        assert!(parse_url("https://example.org/a?b=c").is_ok());
    }

    #[test]
    fn entities_survive_multibyte_text_after_an_ampersand() {
        // The 12th byte after '&' falls inside a CJK character.
        assert_eq!(
            decode_entities("&a漢字漢字漢字 &amp; ok"),
            "&a漢字漢字漢字 & ok"
        );
    }

    #[test]
    fn meta_prefers_open_graph_and_decodes_text() {
        let html = r#"<html><head><title> Fallback &amp; co </title>
            <meta property="og:title" content="Kiln &#38; Clay">
            <meta name="description" content="plain desc">
            <meta property='og:description' content='A   &quot;great&quot;
              page'>
            <meta property="og:image" content="/img/a.png">
            <script>var x = "<meta property='og:title' content='evil'>";</script>
            </head><body><meta property="og:title" content="late"></body></html>"#;
        let m = parse_meta(html);
        assert_eq!(m.title, "Kiln & Clay");
        assert_eq!(m.description, "A \"great\" page");
        assert_eq!(m.image, "/img/a.png");
        let m = parse_meta("<title>Only title</title>");
        assert_eq!(
            (m.title.as_str(), m.description.as_str(), m.image.as_str()),
            ("Only title", "", "")
        );
        assert_eq!(
            parse_meta("<meta property=og:title content=x"),
            Meta::default()
        );
        assert_eq!(
            parse_meta(&format!("<title>{}</title>", "t".repeat(900)))
                .title
                .chars()
                .count(),
            MAX_TITLE
        );
    }

    async fn serve(responses: Vec<Vec<u8>>) -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            for r in responses {
                let Ok((mut s, _)) = l.accept().await else {
                    return;
                };
                let mut buf = [0u8; 2048];
                let _ = s.read(&mut buf).await;
                let _ = s.write_all(&r).await;
                let _ = s.shutdown().await;
            }
        });
        port
    }

    fn http(status: &str, ct: &str, body: &[u8], extra: &str) -> Vec<u8> {
        let mut v = format!(
            "HTTP/1.1 {status}\r\ncontent-type: {ct}\r\ncontent-length: {}\r\nconnection: close\r\n{extra}\r\n",
            body.len()
        )
        .into_bytes();
        v.extend_from_slice(body);
        v
    }

    const OPEN: Opts = Opts {
        allow_private: true,
    };

    #[tokio::test]
    async fn private_hosts_are_refused_in_production_mode() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::open(dir.path()).unwrap();
        core.setting_set("privacy.previews", "1").unwrap();
        for u in [
            "http://127.0.0.1:9/",
            "http://localhost/",
            "http://[::1]/",
            "http://169.254.169.254/latest",
            "http://10.0.0.5/",
        ] {
            let err = fetch(&core, u).await.unwrap_err();
            assert!(
                err.contains("public internet") || err.contains("could not be found"),
                "{u}: {err}"
            );
        }
        core.setting_set("privacy.previews", "0").unwrap();
        assert!(
            fetch(&core, "https://example.org")
                .await
                .unwrap_err()
                .contains("off")
        );
    }

    #[tokio::test]
    async fn fetches_page_and_image_and_follows_safe_redirects() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::open(dir.path()).unwrap();
        let png = [0x89u8, b'P', b'N', b'G', 1, 2, 3, 4];
        let page = http(
            "200 OK",
            "text/html; charset=utf-8",
            b"<title>T</title><meta property=\"og:description\" content=\"D\"><meta property=\"og:image\" content=\"/i.png\">",
            "",
        );
        // Request order on one listener: redirect, page, image.
        let port = serve(vec![
            http("302 Found", "text/plain", b"", "location: /page\r\n"),
            page,
            http("200 OK", "image/png", &png, ""),
        ])
        .await;
        let out = fetch_inner(&core, &format!("http://127.0.0.1:{port}/start"), OPEN)
            .await
            .unwrap();
        assert_eq!((out.title.as_str(), out.description.as_str()), ("T", "D"));
        assert!(out.url.ends_with("/page"));
        let img = out.image.expect("image fetched and stored");
        assert_eq!((img.mime.as_str(), img.size), ("image/png", 8));
        assert_eq!(core.blobs().read_all(&img.hash).unwrap(), png);
    }

    #[tokio::test]
    async fn oversize_non_html_and_error_responses_fail_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::open(dir.path()).unwrap();
        let big = vec![b'a'; MAX_PAGE_BYTES * 2];
        let mut body = b"<title>Big</title>".to_vec();
        body.extend_from_slice(&big);
        let port = serve(vec![http("200 OK", "text/html", &body, "")]).await;
        let out = fetch_inner(&core, &format!("http://127.0.0.1:{port}/"), OPEN)
            .await
            .unwrap();
        assert_eq!(out.title, "Big", "the head is read from the capped prefix");
        let port = serve(vec![http("200 OK", "application/pdf", b"%PDF", "")]).await;
        assert!(
            fetch_inner(&core, &format!("http://127.0.0.1:{port}/"), OPEN)
                .await
                .unwrap_err()
                .contains("not a web page")
        );
        let port = serve(vec![http("404 Not Found", "text/html", b"nope", "")]).await;
        assert!(
            fetch_inner(&core, &format!("http://127.0.0.1:{port}/"), OPEN)
                .await
                .unwrap_err()
                .contains("404")
        );
        let looping: Vec<Vec<u8>> = (0..6)
            .map(|_| http("302 Found", "text/plain", b"", "location: /\r\n"))
            .collect();
        let port = serve(looping).await;
        assert!(
            fetch_inner(&core, &format!("http://127.0.0.1:{port}/"), OPEN)
                .await
                .unwrap_err()
                .contains("too many")
        );
    }

    #[tokio::test]
    async fn a_redirect_to_a_private_address_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::open(dir.path()).unwrap();
        let port = serve(vec![http(
            "302 Found",
            "text/plain",
            b"",
            "location: http://169.254.169.254/latest\r\n",
        )])
        .await;
        // Entry point allowed (test mode), the hop is re-validated with production rules via a
        // second call that disallows private targets.
        let strict = Opts {
            allow_private: false,
        };
        let err = fetch_inner(&core, &format!("http://127.0.0.1:{port}/"), strict)
            .await
            .unwrap_err();
        assert!(err.contains("public internet"), "{err}");
    }

    #[tokio::test]
    async fn slow_sites_time_out() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::open(dir.path()).unwrap();
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (_s, _) = l.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(10)).await;
        });
        let t = Instant::now();
        let err = fetch_inner(&core, &format!("http://127.0.0.1:{port}/"), OPEN)
            .await
            .unwrap_err();
        assert!(t.elapsed() < Duration::from_secs(5));
        assert!(err.contains("too long"), "{err}");
    }
}
