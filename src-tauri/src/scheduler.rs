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

fn now_ms() -> i64 {
    hermod_core::api::now_ms()
}

pub async fn run(ctx: Arc<Ctx>) {
    let mut rx = ctx.subscribe();
    let mut fired: HashMap<String, Vec<Instant>> = HashMap::new();
    let mut dirty = true;
    loop {
        run_schedule(&ctx).await;
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
