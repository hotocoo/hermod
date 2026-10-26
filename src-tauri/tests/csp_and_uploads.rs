//! The packaged CSP must allow KTX2 transcoding (wasm and blob workers), and JSON byte-array
//! uploads are capped small so they cannot be used to make the bridge allocate hundreds of MiB.

use hermodr_lib::api::{self, MAX_JSON_UPLOAD_BYTES};
use hermodr_lib::blob::{APP_ORIGINS, BlobResponse};
use hermodr_lib::ctx::{Ctx, Options};
use serde_json::json;

#[test]
fn csp_allows_wasm_and_blob_workers_for_ktx2() {
    let conf: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json parses");
    let csp = conf["app"]["security"]["csp"].as_str().expect("csp is set");
    let directive = |name: &str| {
        csp.split(';')
            .map(str::trim)
            .find(|d| d.starts_with(name))
            .unwrap_or_else(|| panic!("{name} missing from csp"))
            .to_string()
    };
    assert!(directive("script-src").contains("'wasm-unsafe-eval'"));
    let worker = directive("worker-src");
    assert!(worker.contains("'self'") && worker.contains("blob:"));
}

#[test]
fn blob_cors_is_limited_to_app_origins() {
    let r = BlobResponse {
        status: 200,
        mime: "text/vtt".into(),
        total: 1,
        range: None,
        body: vec![0],
    };
    let acao = |o: Option<&str>| {
        r.headers(o)
            .into_iter()
            .find(|(k, _)| *k == "Access-Control-Allow-Origin")
            .map(|(_, v)| v)
    };
    assert_eq!(acao(None), None);
    assert_eq!(acao(Some("https://evil.example")), None);
    assert_eq!(acao(Some(APP_ORIGINS[0])), Some(APP_ORIGINS[0].to_string()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn json_byte_arrays_over_the_cap_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let ctx = Ctx::open(
        dir.path().to_path_buf(),
        Options::localhost(None, vec![]),
        None,
    )
    .await
    .unwrap();
    let big = vec![0u8; MAX_JSON_UPLOAD_BYTES + 1];
    let err = api::handle(
        &ctx,
        "blob_put_bytes",
        json!({"name": "a.bin", "bytes": big}),
    )
    .await
    .unwrap_err();
    assert!(err.contains("too large"), "{err}");
}
