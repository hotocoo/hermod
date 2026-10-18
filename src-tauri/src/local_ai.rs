//! Optional local-model hook for translation and summaries (docs/MESSAGING.md 3.24, M-055).
//! Off by default. When switched on it talks only to an OpenAI-compatible server on this machine
//! (llama.cpp `llama-server`, Ollama, LM Studio). No cloud, no key, no other host: the endpoint must be a loopback address.

use std::net::IpAddr;
use std::time::Duration;

use reqwest::{Client, Url};
use serde_json::{Value, json};

pub const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:11434";
const MAX_INPUT_CHARS: usize = 12_000;
const TIMEOUT: Duration = Duration::from_secs(120);

/// Accepts `http://localhost`, `127.0.0.0/8` and `::1` only.
pub fn validate_endpoint(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim())
        .map_err(|_| "the local model address is not a valid URL".to_string())?;
    if url.scheme() != "http" {
        return Err("the local model address must start with http://".into());
    }
    let local = match url.host_str() {
        Some("localhost") => true,
        Some(h) => h
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.is_loopback()),
        None => false,
    };
    if !local || !url.username().is_empty() || url.password().is_some() {
        return Err(
            "only a model server on this computer (localhost or 127.0.0.1) is allowed".into(),
        );
    }
    Ok(url)
}

/// Chat request for one task. `target` is the language name for translation.
pub fn request_body(model: &str, task: &str, text: &str, target: &str) -> Result<Value, String> {
    let system = match task {
        "translate" => format!("Translate the user's message into {}. Reply with the translation only.", if target.trim().is_empty() { "English" } else { target.trim() }),
        "summarize" => "Summarize the following chat in at most five short bullet points. Reply with the summary only.".to_string(),
        _ => return Err("unknown task".into()),
    };
    let text: String = text.chars().take(MAX_INPUT_CHARS).collect();
    if text.trim().is_empty() {
        return Err("nothing to process".into());
    }
    Ok(
        json!({ "model": model, "stream": false, "messages": [{ "role": "system", "content": system }, { "role": "user", "content": text }] }),
    )
}

/// Pulls the assistant text out of an OpenAI-style reply.
pub fn reply_text(v: &Value) -> Option<String> {
    v.pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub async fn run(
    endpoint: &str,
    model: &str,
    task: &str,
    text: &str,
    target: &str,
) -> Result<String, String> {
    let base = validate_endpoint(endpoint)?;
    if model.trim().is_empty() {
        return Err("choose a model name in the local AI settings".into());
    }
    let body = request_body(model.trim(), task, text, target)?;
    let url = base
        .join("/v1/chat/completions")
        .map_err(|_| "bad address".to_string())?;
    let client = Client::builder()
        .no_proxy()
        .timeout(TIMEOUT)
        .build()
        .map_err(|_| "could not start".to_string())?;
    let resp = client
        .post(url)
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| {
            "no local model server answered, start Ollama or llama-server first".to_string()
        })?;
    if !resp.status().is_success() {
        return Err(format!("the local model server said {}", resp.status()));
    }
    let v: Value = serde_json::from_str(
        &resp
            .text()
            .await
            .map_err(|_| "unreadable reply".to_string())?,
    )
    .map_err(|_| "unreadable reply".to_string())?;
    reply_text(&v).ok_or_else(|| "the model returned nothing".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_loopback_http_endpoints_pass() {
        for ok in [
            "http://127.0.0.1:11434",
            "http://localhost:8080",
            "http://[::1]:8080",
            "http://127.5.5.5",
        ] {
            assert!(validate_endpoint(ok).is_ok(), "{ok}");
        }
        for bad in [
            "https://127.0.0.1",
            "http://example.com",
            "http://192.168.1.4:11434",
            "http://127.0.0.1.evil.com",
            "http://user:pw@127.0.0.1",
            "file:///x",
            "nonsense",
            "http://0.0.0.0",
        ] {
            assert!(validate_endpoint(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn requests_are_bounded_and_replies_parse() {
        let b = request_body("m", "translate", &"x".repeat(50_000), "French").unwrap();
        assert_eq!(
            b["messages"][1]["content"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            MAX_INPUT_CHARS
        );
        assert!(
            b["messages"][0]["content"]
                .as_str()
                .unwrap()
                .contains("French")
        );
        assert!(request_body("m", "summarize", "  ", "").is_err());
        assert!(request_body("m", "nope", "hi", "").is_err());
        assert_eq!(
            reply_text(&json!({"choices":[{"message":{"content":" hola "}}]})).as_deref(),
            Some("hola")
        );
        assert!(reply_text(&json!({})).is_none());
    }
}
