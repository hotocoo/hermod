//! Background work for messaging that needs the app running (docs/MESSAGING.md 3.12, 3.22):
//! the scheduled-message queue and automation rules authored by this user. Both only append
//! ordinary signed events, so no peer ever runs anything.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;
use tokio::sync::broadcast::error::RecvError;

use crate::ctx::Ctx;

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

pub async fn run(ctx: Arc<Ctx>) {
    let mut rx = ctx.subscribe();
    let mut fired: HashMap<String, Vec<Instant>> = HashMap::new();
    let mut dirty = true;
    let mut last_trim: Option<Instant> = None;
    let mut last_prune: Option<Instant> = None;
    loop {
        run_schedule(&ctx).await;
        if last_trim.is_none_or(|t| t.elapsed() >= CACHE_TRIM_EVERY) {
            last_trim = Some(Instant::now());
            trim_cache(&ctx).await;
        }
        if last_prune.is_none_or(|t| t.elapsed() >= RETENTION_PRUNE_EVERY) {
            last_prune = Some(Instant::now());
            prune_retention(&ctx).await;
        }
        if dirty {
            dirty = false;
            run_automation(&ctx, &mut fired).await;
        }
        let wait = next_wait(&ctx).await;
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            ev = rx.recv() => match ev {
                Ok(e) if e.name == "hermod://changed" => {
                    tokio::time::sleep(DEBOUNCE).await;
                    while rx.try_recv().is_ok() {}
                    dirty = true;
                }
                Ok(_) | Err(RecvError::Lagged(_)) => {}
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

async fn run_automation(ctx: &Arc<Ctx>, fired: &mut HashMap<String, Vec<Instant>>) {
    let Ok(live) = ctx.live().await else { return };
    let core = live.core.clone();
    let plans = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for s in core.spaces().unwrap_or_default() {
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
                ctx.changed(&label, crate::ctx::ALL_COLLECTIONS);
            }
            Ok(Err(e)) => tracing::warn!("automation {} could not run: {e}", plan.rule),
            Err(e) => tracing::warn!("automation task failed: {e}"),
        }
    }
}
