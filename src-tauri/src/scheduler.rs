//! Background work for messaging that needs the app running (docs/MESSAGING.md 3.12, 3.22):
//! the scheduled-message queue and automation rules authored by this user. Both only append
//! ordinary signed events, so no peer ever runs anything.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use serde_json::json;
use tokio::sync::broadcast::error::RecvError;

use crate::ctx::{ALL_COLLECTIONS, Ctx, Emitted};

const CHANGED_EVENT: &str = "hermod://changed";
/// Marks a `changed` event the scheduler itself raised, so it does not wake itself again.
const SELF_ORIGIN: &str = "scheduler";

/// A message sent this long after its time is flagged `late`.
const LATE_AFTER_MS: i64 = 60_000;
/// Longest sleep between queue checks.
const MAX_SLEEP: Duration = Duration::from_secs(30);
const DEBOUNCE: Duration = Duration::from_millis(400);
/// Automation output cap per rule.
const RULE_BURST: usize = 5;
const RULE_WINDOW: Duration = Duration::from_secs(60);
/// How often the cache kept for others is checked against the `blob_cache_bytes` setting.
const CACHE_TRIM_EVERY: Duration = Duration::from_secs(60);
/// How often per-space retention windows (D-004) are applied; a window passing needs no finer grain.
const RETENTION_PRUNE_EVERY: Duration = Duration::from_secs(3600);

fn now_ms() -> i64 {
    hermod_core::api::now_ms()
}

/// Spaces whose automation rules must be looked at again: everything at start, then only the
/// spaces other code changed.
#[derive(Default)]
pub struct Dirty {
    all: bool,
    spaces: HashSet<String>,
}

impl Dirty {
    fn everything() -> Self {
        Dirty {
            all: true,
            spaces: HashSet::new(),
        }
    }

    fn is_clean(&self) -> bool {
        !self.all && self.spaces.is_empty()
    }

    /// Records a UI event; the scheduler's own `changed` events are ignored.
    pub fn note(&mut self, ev: &Emitted) {
        if ev.name != CHANGED_EVENT || ev.payload["origin"] == SELF_ORIGIN {
            return;
        }
        match ev.payload["space_id"].as_str() {
            Some(s) => {
                self.spaces.insert(s.to_string());
            }
            None => self.all = true,
        }
    }
}

pub async fn run(weak: Weak<Ctx>) {
    let Some(mut rx) = weak.upgrade().map(|c| c.subscribe()) else {
        return;
    };
    let mut fired: HashMap<String, Vec<Instant>> = HashMap::new();
    let mut dirty = Dirty::everything();
    let mut last_trim: Option<Instant> = None;
    let mut last_prune: Option<Instant> = None;
    loop {
        let Some(ctx) = weak.upgrade() else { return };
        run_schedule(&ctx).await;
        if last_trim.is_none_or(|t| t.elapsed() >= CACHE_TRIM_EVERY) {
            last_trim = Some(Instant::now());
            trim_cache(&ctx).await;
        }
        if last_prune.is_none_or(|t| t.elapsed() >= RETENTION_PRUNE_EVERY) {
            last_prune = Some(Instant::now());
            prune_retention(&ctx).await;
        }
        if !dirty.is_clean() {
            let todo = std::mem::take(&mut dirty);
            run_automation(&ctx, &mut fired, &todo).await;
        }
        let wait = next_wait(&ctx).await;
        drop(ctx);
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            ev = rx.recv() => match ev {
                Ok(e) if e.name == CHANGED_EVENT => {
                    dirty.note(&e);
                    tokio::time::sleep(DEBOUNCE).await;
                    while let Ok(e) = rx.try_recv() {
                        dirty.note(&e);
                    }
                }
                Ok(_) => {}
                // Missed events: cannot tell which spaces changed.
                Err(RecvError::Lagged(_)) => dirty.all = true,
                Err(RecvError::Closed) => return,
            }
        }
    }
}

/// Keep the encrypted cache held for others within the person's `blob_cache_bytes` limit.
async fn trim_cache(ctx: &Arc<Ctx>) {
    let Ok(live) = ctx.live().await else { return };
    let l = live.clone();
    let freed = tokio::task::spawn_blocking(move || {
        let limit = crate::settings::node_settings(&l.core)?.blob_cache_bytes;
        l.core.storage_trim_cache(limit).map_err(|e| e.to_string())
    })
    .await;
    match freed {
        Ok(Ok(0)) => {}
        Ok(Ok(n)) => {
            tracing::info!("cache over its limit: freed {n} bytes");
            live.forget_blob_info();
        }
        Ok(Err(e)) => tracing::warn!("cache trim failed: {e}"),
        Err(e) => tracing::warn!("cache trim task failed: {e}"),
    }
}

/// Apply every space's retention window: hide old messages and free their unreferenced blobs.
async fn prune_retention(ctx: &Arc<Ctx>) {
    let Ok(live) = ctx.live().await else { return };
    let l = live.clone();
    let done = tokio::task::spawn_blocking(move || {
        let freed = l.core.retention_prune().map_err(|e| e.to_string())?;
        let mut labels = Vec::new();
        for s in l.core.spaces().map_err(|e| e.to_string())? {
            let id = l.core.resolve_space(&s.label).map_err(|e| e.to_string())?;
            if l.core
                .retention_get(&id)
                .map_err(|e| e.to_string())?
                .is_some()
            {
                labels.push(s.label);
            }
        }
        Ok::<_, String>((freed, labels))
    })
    .await;
    match done {
        Ok(Ok((freed, labels))) => {
            if freed > 0 {
                tracing::info!("retention: freed {freed} bytes");
                live.forget_blob_info();
            }
            for label in labels {
                ctx.changed(&label, crate::ctx::ALL_COLLECTIONS);
            }
        }
        Ok(Err(e)) => tracing::warn!("retention prune failed: {e}"),
        Err(e) => tracing::warn!("retention prune task failed: {e}"),
    }
}

async fn next_wait(ctx: &Arc<Ctx>) -> Duration {
    let Ok(live) = ctx.live().await else {
        return MAX_SLEEP;
    };
    let core = live.core.clone();
    let next = tokio::task::spawn_blocking(move || core.schedule_next().ok().flatten())
        .await
        .ok()
        .flatten();
    match next {
        Some(at) => {
            Duration::from_millis((at - now_ms()).clamp(50, MAX_SLEEP.as_millis() as i64) as u64)
        }
        None => MAX_SLEEP,
    }
}

async fn run_schedule(ctx: &Arc<Ctx>) {
    let Ok(live) = ctx.live().await else { return };
    let core = live.core.clone();
    let due =
        tokio::task::spawn_blocking(move || core.schedule_run_due(now_ms(), LATE_AFTER_MS)).await;
    let Ok(Ok(outcomes)) = due else { return };
    for o in outcomes {
        let label = crate::ctx::space_label(ctx, &o.space).await;
        match o.result {
            Ok(ev) => {
                ctx.publish(&o.space, &[ev]).await;
                ctx.changed(&label, crate::ctx::collections_for("message"));
                ctx.emit(
                    "scheduled",
                    json!({ "id": o.id, "space_id": label, "ok": true, "late": o.late }),
                );
            }
            Err(msg) => {
                tracing::warn!("scheduled message {} failed: {msg}", o.id);
                ctx.emit(
                    "scheduled",
                    json!({ "id": o.id, "space_id": label, "ok": false, "error": msg }),
                );
            }
        }
    }
}

async fn run_automation(ctx: &Arc<Ctx>, fired: &mut HashMap<String, Vec<Instant>>, dirty: &Dirty) {
    let Ok(live) = ctx.live().await else { return };
    let core = live.core.clone();
    let (all, only) = (dirty.all, dirty.spaces.clone());
    let plans = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for s in core.spaces().unwrap_or_default() {
            if !all && !only.contains(&s.label) && !only.contains(&s.space_id) {
                continue;
            }
            let Ok(id) = s.space_id.parse::<hermod_core::SpaceId>() else {
                continue;
            };
            for p in core.automation_plan(&id).unwrap_or_default() {
                out.push((id, p));
            }
        }
        out
    })
    .await
    .unwrap_or_default();
    for (space, plan) in plans {
        let hist = fired.entry(plan.rule.clone()).or_default();
        hist.retain(|t| t.elapsed() < RULE_WINDOW);
        if hist.len() >= RULE_BURST {
            continue;
        }
        hist.push(Instant::now());
        let core = live.core.clone();
        let body = plan.body.clone();
        let res = tokio::task::spawn_blocking(move || core.append(&space, body)).await;
        match res {
            Ok(Ok(ev)) => {
                let label = crate::ctx::space_label(ctx, &space).await;
                ctx.publish(&space, &[ev]).await;
                ctx.emit(
                    "changed",
                    json!({ "space_id": label, "collections": ALL_COLLECTIONS, "origin": SELF_ORIGIN }),
                );
            }
            Ok(Err(e)) => tracing::warn!("automation {} could not run: {e}", plan.rule),
            Err(e) => tracing::warn!("automation task failed: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(name: &str, payload: serde_json::Value) -> Emitted {
        Emitted {
            name: name.into(),
            payload,
        }
    }

    #[test]
    fn own_changes_do_not_rearm_and_foreign_ones_mark_only_their_space() {
        let mut d = Dirty::default();
        d.note(&ev(
            CHANGED_EVENT,
            json!({ "space_id": "a", "origin": SELF_ORIGIN }),
        ));
        assert!(d.is_clean(), "the scheduler's own emit must not wake it");
        d.note(&ev("hermod://node", json!({ "space_id": "a" })));
        assert!(d.is_clean());
        d.note(&ev(CHANGED_EVENT, json!({ "space_id": "b" })));
        assert!(!d.all && d.spaces.len() == 1 && d.spaces.contains("b"));
        d.note(&ev(CHANGED_EVENT, json!({})));
        assert!(d.all);
    }

    use crate::ctx::Options;
    use serde_json::Value;

    async fn call(c: &Arc<Ctx>, name: &str, args: Value) -> Value {
        crate::api::handle(c, name, args)
            .await
            .unwrap_or_else(|e| panic!("{name}: {e}"))
    }

    fn post(space: &str, msg_id: &str, text: &str) -> Value {
        json!({"spaceId": space, "body": {
            "t": "message.post", "channel_id": "general", "msg_id": msg_id, "text": text, "attachments": []}})
    }

    /// M-052: a keyword rule authored by this user answers a matching message once, and not a
    /// message that does not match.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn keyword_rule_fires_a_reply_once() {
        let dir = tempfile::tempdir().unwrap();
        let c = Ctx::open(
            dir.path().to_path_buf(),
            Options::localhost(None, vec![]),
            None,
        )
        .await
        .unwrap();
        let sp = call(
            &c,
            "space_create",
            json!({"name": "Bots", "tagline": "t", "kind": "Team"}),
        )
        .await;
        let space = sp["space_id"].as_str().unwrap().to_string();
        call(&c, "event_append", json!({"spaceId": space, "body": {
            "t": "automation.set", "id": "r1", "name": "Kiln alerts", "enabled": true,
            "trigger": {"kind": "keyword", "channel": "general", "words": ["kiln"]},
            "action": {"kind": "post_message", "channel": "general", "text": "Ticket noted: {{text}}"}}})).await;
        // A rule only answers events newer than itself.
        tokio::time::sleep(Duration::from_millis(5)).await;
        call(&c, "event_append", post(&space, "m1", "the kiln is hot")).await;
        call(&c, "event_append", post(&space, "m2", "lunch?")).await;

        let mut fired = HashMap::new();
        run_automation(&c, &mut fired, &Dirty::everything()).await;
        let page = |c: Arc<Ctx>, space: String| async move {
            call(
                &c,
                "messages_page",
                json!({"spaceId": space, "channelId": "general"}),
            )
            .await
            .to_string()
        };
        let after = page(c.clone(), space.clone()).await;
        assert_eq!(
            after.matches("Ticket noted: the kiln is hot").count(),
            1,
            "{after}"
        );
        assert!(!after.contains("Ticket noted: lunch?"));

        run_automation(&c, &mut fired, &Dirty::everything()).await;
        let again = page(c.clone(), space.clone()).await;
        assert_eq!(again.matches("Ticket noted:").count(), 1, "answered once");
    }
}
