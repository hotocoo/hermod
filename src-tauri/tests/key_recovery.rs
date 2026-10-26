//! E-013: a key that cannot be read must leave a way out. The app starts limited, and restore or
//! reset still work. Also: what the sealed file holds, and JSON null arguments.

use std::sync::Arc;

use hermodr_lib::api;
use hermodr_lib::ctx::{Ctx, Options};
use serde_json::{Value, json};

const PASS: &str = "correct horse battery";
const LOCKED: &str = "identity locked";

async fn open(dir: &std::path::Path) -> Arc<Ctx> {
    Ctx::open(dir.to_path_buf(), Options::localhost(None, vec![]), None)
        .await
        .unwrap()
}

async fn call(c: &Arc<Ctx>, name: &str, args: Value) -> Result<Value, String> {
    api::handle(c, name, args).await
}

/// In-memory keychain: no test touches a real one.
#[derive(Debug, Default)]
struct MemKeychain(std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>);

impl hermod_core::keyguard::SecretStore for MemKeychain {
    fn get(&self, account: &str) -> hermod_core::Result<Option<zeroize::Zeroizing<Vec<u8>>>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(account)
            .map(|v| zeroize::Zeroizing::new(v.clone())))
    }
    fn set(&self, account: &str, secret: &[u8]) -> hermod_core::Result<()> {
        self.0
            .lock()
            .unwrap()
            .insert(account.to_string(), secret.to_vec());
        Ok(())
    }
    fn delete(&self, account: &str) -> hermod_core::Result<()> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

async fn open_with_keychain(dir: &std::path::Path, kc: &Arc<MemKeychain>) -> Arc<Ctx> {
    let mut opts = Options::localhost(None, vec![]);
    opts.keystore = Some(kc.clone());
    Ctx::open(dir.to_path_buf(), opts, None).await.unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sealed_key_file_holds_no_plaintext_seed() {
    let dir = tempfile::tempdir().unwrap();
    let c = open(dir.path()).await;
    let key = dir.path().join("identity.key");
    let plain = std::fs::read(&key).unwrap();
    assert_eq!(plain.len(), 32);
    call(
        &c,
        "identity_protect",
        json!({"mode": "passphrase", "passphrase": PASS}),
    )
    .await
    .unwrap();
    let sealed = std::fs::read(&key).unwrap();
    assert!(sealed.starts_with(b"HRMDPW1\0"));
    assert!(!sealed.windows(32).any(|w| w == plain.as_slice()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn json_null_passphrase_counts_as_absent() {
    let dir = tempfile::tempdir().unwrap();
    let c = open(dir.path()).await;
    let done = call(
        &c,
        "identity_protect",
        json!({"mode": "file", "passphrase": null}),
    )
    .await
    .unwrap();
    assert_eq!(done["key_mode"], "file");
    assert!(
        call(
            &c,
            "identity_protect",
            json!({"mode": "passphrase", "passphrase": null})
        )
        .await
        .is_err(),
        "sealing without a passphrase is refused"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lost_keychain_entry_boots_limited_and_reset_recovers() {
    let dir = tempfile::tempdir().unwrap();
    let kc = Arc::new(MemKeychain::default());
    let c = open_with_keychain(dir.path(), &kc).await;
    let first = call(&c, "identity_get", json!({})).await.unwrap();
    call(&c, "identity_protect", json!({"mode": "keychain"}))
        .await
        .unwrap();
    drop(c);

    // The keychain forgot the entry (wiped, or another machine): the app still starts.
    let empty = Arc::new(MemKeychain::default());
    let c = open_with_keychain(dir.path(), &empty).await;
    let err = call(&c, "identity_get", json!({})).await.unwrap_err();
    assert!(err.starts_with("identity key unavailable"), "{err}");

    // Start over works without a readable key and yields a fresh identity.
    call(&c, "app_reset", json!({})).await.unwrap();
    let fresh = call(&c, "identity_get", json!({})).await.unwrap();
    assert_ne!(fresh["user_id"], first["user_id"]);
    assert_eq!(fresh["key_mode"], "file");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn locked_install_can_still_be_reset() {
    let dir = tempfile::tempdir().unwrap();
    let c = open(dir.path()).await;
    call(
        &c,
        "identity_protect",
        json!({"mode": "passphrase", "passphrase": PASS}),
    )
    .await
    .unwrap();
    drop(c);
    let c = open(dir.path()).await;
    assert_eq!(
        call(&c, "identity_get", json!({})).await.unwrap_err(),
        LOCKED
    );
    call(&c, "app_reset", json!({})).await.unwrap();
    assert_eq!(
        call(&c, "identity_get", json!({})).await.unwrap()["key_mode"],
        "file"
    );
}
