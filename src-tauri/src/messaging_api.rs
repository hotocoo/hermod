//! Messaging commands (docs/MESSAGING.md section 3). Called from `api::dispatch` for any name it
//! does not know; returns `None` for names that are not messaging commands.

use std::sync::Arc;

use hermod_core::event::EventBody;
use hermod_core::ids::UserId;
use hermod_core::invite::InviteV1;
use hermod_core::projections::SearchFilters;
use serde_json::{Value, json};

use crate::api::{self, Res, after_events, blk, e, opt_str, opt_u64, space_of, str_arg, to_json};
use crate::ctx::{ALL_COLLECTIONS, Ctx, Live};
use crate::preview;

const MESSAGING: &[&str] = &["messages", "channels", "inbox", "spaces", "messaging"];

fn users_arg(a: &Value) -> Res<Vec<UserId>> {
    a.get("users")
        .and_then(Value::as_array)
        .ok_or("missing users")?
        .iter()
        .map(|v| {
            v.as_str()
                .and_then(|s| s.parse::<UserId>().ok())
                .ok_or_else(|| "that is not a valid user id".to_string())
        })
        .collect()
}

fn opt_i64(a: &Value, key: &str) -> Option<i64> {
    a.get(key).and_then(Value::as_i64)
}

async fn publish_groups(
    ctx: &Arc<Ctx>,
    groups: &[(hermod_core::SpaceId, Vec<hermod_core::SignedEvent>)],
) {
    for (space, evs) in groups {
        ctx.publish(space, evs).await;
    }
}

pub async fn handle(ctx: &Arc<Ctx>, live: &Arc<Live>, name: &str, a: &Value) -> Option<Res<Value>> {
    Some(match name {
        "messages_page" | "media_gallery" | "messages_search" | "message_hide"
        | "message_unhide" | "chat_prefs_get" | "chat_prefs_set" | "schedule_add"
        | "schedule_list" | "schedule_cancel" | "saved_open" | "dm_start" | "dm_requests"
        | "dm_accept" | "dm_decline" | "contact_card" | "contact_add" | "contact_list"
        | "contact_remove" | "link_preview" | "privacy_get" | "privacy_set" | "ai_local_get"
        | "ai_local_set" | "ai_local_run" => run(ctx, live, name, a).await,
        _ => return None,
    })
}

async fn run(ctx: &Arc<Ctx>, live: &Arc<Live>, name: &str, a: &Value) -> Res<Value> {
    match name {
        "messages_page" => {
            let (id, _) = space_of(live, a).await?;
            let ch = str_arg(a, "channelId")?;
            let before = opt_u64(a, "before");
            let limit = opt_u64(a, "limit").map_or(50, |n| n as usize);
            to_json(
                blk(live, move |c| {
                    c.messages_page(&id, &ch, before, limit).map_err(e)
                })
                .await?,
            )
        }
        "media_gallery" => {
            let (id, _) = space_of(live, a).await?;
            let ch = str_arg(a, "channelId")?;
            let kind = str_arg(a, "kind")?;
            let before = opt_u64(a, "before");
            let limit = opt_u64(a, "limit").map_or(50, |n| n as usize);
            to_json(
                blk(live, move |c| {
                    c.media_gallery(&id, &ch, &kind, before, limit).map_err(e)
                })
                .await?,
            )
        }
        "messages_search" => {
            let space = match opt_str(a, "spaceId") {
                Some(l) => Some(space_of(live, &json!({ "spaceId": l })).await?.0),
                None => None,
            };
            let f = SearchFilters {
                q: opt_str(a, "q").unwrap_or_default(),
                from: opt_str(a, "from"),
                channel: opt_str(a, "in"),
                has: opt_str(a, "has"),
                before_ms: opt_i64(a, "before"),
                after_ms: opt_i64(a, "after"),
                limit: opt_u64(a, "limit").map_or(30, |n| n as usize),
            };
            let labels = blk(live, |c| {
                Ok(c.spaces()
                    .map_err(e)?
                    .into_iter()
                    .map(|s| (s.space_id, s.label))
                    .collect::<std::collections::BTreeMap<_, _>>())
            })
            .await?;
            let hits = blk(live, move |c| {
                c.messages_search(space.as_ref(), &f).map_err(e)
            })
            .await?;
            Ok(Value::Array(
                hits.into_iter()
                    .map(|h| {
                        let mut v = serde_json::to_value(&h).unwrap_or(Value::Null);
                        if let Some(l) = labels.get(&h.space_id) {
                            v["space_id"] = json!(l);
                        }
                        v
                    })
                    .collect(),
            ))
        }
        "message_hide" | "message_unhide" => {
            let (id, label) = space_of(live, a).await?;
            let msg = str_arg(a, "msgId")?;
            let hide = name == "message_hide";
            blk(live, move |c| {
                if hide {
                    c.message_hide(&id, &msg)
                } else {
                    c.message_unhide(&id, &msg)
                }
                .map_err(e)
            })
            .await?;
            ctx.changed(&label, MESSAGING);
            Ok(Value::Null)
        }
        "chat_prefs_get" => blk(live, |c| c.chat_prefs_get().map_err(e)).await,
        "chat_prefs_set" => {
            let patch = a.get("patch").cloned().ok_or("missing patch")?;
            let v = blk(live, move |c| c.chat_prefs_set(&patch).map_err(e)).await?;
            ctx.changed("home", &["messaging"]);
            Ok(v)
        }
        "schedule_add" => {
            let (id, _) = space_of(live, a).await?;
            let at = opt_i64(a, "at").ok_or("missing time")?;
            let body: EventBody =
                serde_json::from_value(a.get("body").cloned().ok_or("missing body")?)
                    .map_err(|x| format!("invalid message: {x}"))?;
            let s = blk(live, move |c| c.schedule_add(&id, body, at).map_err(e)).await?;
            // Wakes the scheduler so a message due soon is not left waiting for its next poll.
            ctx.changed("home", &["messaging"]);
            to_json(s)
        }
        "schedule_list" => to_json(blk(live, |c| c.schedule_list().map_err(e)).await?),
        "schedule_cancel" => {
            let id = str_arg(a, "id")?;
            blk(live, move |c| c.schedule_cancel(&id).map_err(e)).await?;
            Ok(Value::Null)
        }
        "saved_open" => {
            let (label, ch, evs) = blk(live, |c| c.saved_open().map_err(e)).await?;
            if !evs.is_empty() {
                // Home is local only: nothing to publish.
                ctx.changed(&label, ALL_COLLECTIONS);
            }
            Ok(json!({ "space_id": label, "channel_id": ch }))
        }
        "dm_start" => {
            let users = users_arg(a)?;
            let name = opt_str(a, "name");
            let addrs = local_addrs(ctx).await;
            let started = blk(live, move |c| {
                c.dm_start(&users, name.as_deref(), addrs).map_err(e)
            })
            .await?;
            if !started.existing {
                if let Some(node) = ctx.node().await {
                    for (space, _) in &started.events {
                        let _ = node.join_space(space.0).await;
                    }
                }
                publish_groups(ctx, &started.events).await;
                ctx.changed("home", ALL_COLLECTIONS);
            }
            to_json(started.summary)
        }
        "dm_requests" => to_json(blk(live, |c| c.dm_requests().map_err(e)).await?),
        "dm_accept" => {
            let id = str_arg(a, "id")?;
            let joined = blk(live, move |c| c.dm_accept(&id).map_err(e)).await?;
            join_and_publish(ctx, &joined).await?;
            api::summary(live, joined.id).await
        }
        "dm_decline" => {
            let id = str_arg(a, "id")?;
            blk(live, move |c| c.dm_decline(&id).map_err(e)).await?;
            ctx.changed("home", &["messaging"]);
            Ok(Value::Null)
        }
        "contact_card" => {
            let addrs = local_addrs(ctx).await;
            let (card, groups) = blk(live, move |c| c.contact_card(addrs).map_err(e)).await?;
            if let Some(node) = ctx.node().await {
                for (space, _) in &groups {
                    let _ = node.join_space(space.0).await;
                }
            }
            publish_groups(ctx, &groups).await;
            to_json(card)
        }
        "contact_add" => {
            let code = str_arg(a, "code")?;
            let inv = InviteV1::parse(code.trim()).map_err(e)?;
            if inv.inviter == live.core.user_id() {
                return Err("that is your own contact card".into());
            }
            let out = api::invite_accept(ctx, live, a).await?;
            let who = inv.inviter.to_string();
            blk(live, move |c| c.contact_add_local(&who).map_err(e)).await?;
            Ok(out)
        }
        "contact_list" => {
            let prefs = blk(live, |c| c.chat_prefs_get().map_err(e)).await?;
            Ok(prefs.get("contacts").cloned().unwrap_or_else(|| json!([])))
        }
        "contact_remove" => {
            let u = str_arg(a, "userId")?;
            blk(live, move |c| c.contact_remove_local(&u).map_err(e)).await?;
            ctx.changed("home", &["messaging"]);
            Ok(Value::Null)
        }
        "link_preview" => {
            let url = str_arg(a, "url")?;
            let allow_private = ctx.opts.preview_allow_private;
            to_json(preview::fetch(&live.core, &url, allow_private).await?)
        }
        "privacy_get" => blk(live, privacy).await,
        "privacy_set" => {
            let patch = a.get("patch").cloned().ok_or("missing patch")?;
            blk(live, move |c| {
                for (field, key, _) in PRIVACY {
                    if let Some(v) = patch.get(*field).and_then(Value::as_bool) {
                        c.setting_set(key, if v { "1" } else { "0" }).map_err(e)?;
                    }
                }
                privacy(c)
            })
            .await
        }
        "ai_local_get" => blk(live, ai_settings).await,
        "ai_local_set" => {
            let patch = a.get("patch").cloned().ok_or("missing patch")?;
            if let Some(ep) = patch.get("endpoint").and_then(Value::as_str) {
                crate::local_ai::validate_endpoint(ep)?;
            }
            blk(live, move |c| {
                if let Some(v) = patch.get("enabled").and_then(Value::as_bool) {
                    c.setting_set("ai.local.enabled", if v { "1" } else { "0" })
                        .map_err(e)?;
                }
                for (field, key) in [
                    ("endpoint", "ai.local.endpoint"),
                    ("model", "ai.local.model"),
                ] {
                    if let Some(v) = patch.get(field).and_then(Value::as_str) {
                        c.setting_set(key, v.trim()).map_err(e)?;
                    }
                }
                ai_settings(c)
            })
            .await
        }
        "ai_local_run" => {
            let task = str_arg(a, "task")?;
            let text = str_arg(a, "text")?;
            let target = opt_str(a, "target").unwrap_or_default();
            let cfg = blk(live, ai_settings).await?;
            if cfg["enabled"] != Value::Bool(true) {
                return Err("local AI is off, turn it on in privacy settings".into());
            }
            let endpoint = cfg["endpoint"].as_str().unwrap_or_default().to_string();
            let model = cfg["model"].as_str().unwrap_or_default().to_string();
            Ok(Value::String(
                crate::local_ai::run(&endpoint, &model, &task, &text, &target).await?,
            ))
        }
        other => Err(format!("unknown command: {other}")),
    }
}

/// `(field, setting key, default)`: read receipts and link previews are off until chosen,
/// typing and presence are on.
const PRIVACY: &[(&str, &str, bool)] = &[
    ("receipts", "read_receipts", false),
    ("previews", "privacy.previews", false),
    ("typing", "privacy.typing", true),
    ("presence", "privacy.presence", true),
];

fn privacy(c: &hermod_core::Core) -> Res<Value> {
    let mut out = serde_json::Map::new();
    for (field, key, default) in PRIVACY {
        let on = match c.setting_get(key).map_err(e)?.as_deref() {
            Some("1") => true,
            Some("0") => false,
            _ => *default,
        };
        out.insert((*field).to_string(), Value::Bool(on));
    }
    Ok(Value::Object(out))
}

async fn join_and_publish(ctx: &Arc<Ctx>, joined: &hermod_core::api::Joined) -> Res<()> {
    if let Some(node) = ctx.node().await {
        let addrs: Vec<hermod_node::Multiaddr> =
            joined.addrs.iter().filter_map(|s| s.parse().ok()).collect();
        if !addrs.is_empty() {
            let _ =
                tokio::time::timeout(std::time::Duration::from_secs(10), node.dial(addrs)).await;
        }
        node.join_space(joined.id.0).await.map_err(e)?;
    }
    after_events(ctx, &joined.label, &joined.events).await;
    Ok(())
}

async fn local_addrs(ctx: &Ctx) -> Vec<String> {
    let Some(node) = ctx.node().await else {
        return Vec::new();
    };
    node.local_addrs()
        .await
        .unwrap_or_default()
        .iter()
        .map(|a| a.to_string())
        .collect()
}

/// Local AI plugin settings: off until chosen, endpoint always loopback.
fn ai_settings(c: &hermod_core::Core) -> Res<Value> {
    let get = |k: &str| c.setting_get(k).map_err(e);
    Ok(json!({
        "enabled": get("ai.local.enabled")?.as_deref() == Some("1"),
        "endpoint": get("ai.local.endpoint")?.unwrap_or_else(|| crate::local_ai::DEFAULT_ENDPOINT.to_string()),
        "model": get("ai.local.model")?.unwrap_or_default(),
    }))
}
