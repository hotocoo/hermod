//! Remote events that applied, decrypted on arrival. The UI owns notification policy (mute,
//! do not disturb) and asks for an OS notification through `notify_send`; here we only learn
//! each blob's content type from the event that referenced it, so `hermod-blob://` can serve it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use hermod_core::Core;
use tokio::sync::mpsc::UnboundedReceiver;

use crate::adapter::Notice;

const MAX_REMEMBERED: usize = 100_000;

pub async fn run(
    core: Arc<Core>,
    mime: Arc<Mutex<HashMap<String, String>>>,
    mut rx: UnboundedReceiver<Notice>,
) {
    while let Some(n) = rx.recv().await {
        let refs: Vec<_> = n
            .body
            .blob_refs()
            .into_iter()
            .filter(|r| !r.mime.is_empty())
            .cloned()
            .collect();
        if refs.is_empty() {
            continue;
        }
        {
            let mut m = mime.lock().unwrap_or_else(|e| e.into_inner());
            for r in &refs {
                if m.len() < MAX_REMEMBERED {
                    m.insert(r.hash.clone(), r.mime.clone());
                }
            }
        }
        let c = core.clone();
        // Persist so the type survives a restart; one small insert per blob.
        let _ = tokio::task::spawn_blocking(move || {
            for r in &refs {
                if let Err(e) = c.blob_meta_put(r) {
                    tracing::warn!("blob type not saved: {e}");
                }
            }
        })
        .await;
    }
}
