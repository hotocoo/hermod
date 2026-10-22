//! The one command handler. Tauri commands and the devhost both call [`handle`], so there is
//! a single implementation of every command in docs/ARCHITECTURE.md section 6.
//!
//! Arguments arrive as the camelCase JSON object the UI sends; results are JSON. Errors are
//! plain user-facing strings, and every failure is also logged.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use hermod_core::api::InviteOptions;
use hermod_core::event::Role;
use hermod_core::ids::{self, SpaceId, UserId};
use hermod_core::{BlobRef, Core, EventBody, ProfileInput, SignedEvent};
use serde_json::{Value, json};

use crate::adapter;
use crate::blob;
use crate::ctx::{ALL_COLLECTIONS, Ctx, Live, collections_for};
use crate::settings::{self, NodePatch, NodeSettings};

/// Largest file accepted over the IPC bridge, checked before the body is parsed.
pub const MAX_UPLOAD_BYTES: usize = 256 * 1024 * 1024;
const MAX_EVENT_JSON: usize = 512 * 1024;
const MAX_SIGNAL_BYTES: usize = 64 * 1024;
const ADDR_WAIT: Duration = Duration::from_secs(3);
const DIAL_WAIT: Duration = Duration::from_secs(10);
const DEFAULT_SEARCH_LIMIT: usize = 30;
const LOG_TAIL_MAX: usize = 2000;
const CLEAR_MSG: &str = "Hermod could not complete that";

pub(crate) type Res<T> = Result<T, String>;

pub(crate) fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

/// Header carrying the non-binary arguments (ASCII-escaped JSON) of a raw-body command.
pub const RAW_ARGS_HEADER: &str = "x-hermod-args";

/// Commands that take their bytes as the raw IPC body instead of a JSON number array.
pub async fn handle_raw(
    ctx: &Arc<Ctx>,
    name: &str,
    meta: Option<&str>,
    bytes: Vec<u8>,
) -> Res<Value> {
    // Before any parsing or work: an oversized body costs nothing more.
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err("that file is too large".into());
    }
    let meta: Value = match meta {
        Some(m) => serde_json::from_str(m).map_err(|_| "bad request arguments".to_string())?,
        None => json!({}),
    };
    let out = match name {
        "blob_put_bytes" => put_bytes(ctx, &meta, bytes).await,
        "save_file" => save_bytes(ctx, &meta, bytes).await,
        _ => Err("that command does not take a raw body".into()),
    };
    if let Err(msg) = &out {
        tracing::warn!("command {name} failed: {msg}");
    }
    out
}

/// Dispatch one command. Logs and returns the error text on failure.
pub async fn handle(ctx: &Arc<Ctx>, name: &str, args: Value) -> Res<Value> {
    let out = dispatch(ctx, name, &args).await;
    if let Err(msg) = &out {
        tracing::warn!("command {name} failed: {msg}");
    }
    out
}

pub(crate) fn str_arg(a: &Value, key: &str) -> Res<String> {
    a.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("missing {key}"))
}

pub(crate) fn opt_str(a: &Value, key: &str) -> Option<String> {
    a.get(key).and_then(Value::as_str).map(str::to_string)
}

pub(crate) fn opt_u64(a: &Value, key: &str) -> Option<u64> {
    a.get(key).and_then(Value::as_u64)
}

pub(crate) fn user_arg(a: &Value, key: &str) -> Res<UserId> {
    str_arg(a, key)?
        .parse::<UserId>()
        .map_err(|_| "that is not a valid user id".to_string())
}

pub(crate) fn to_json<T: serde::Serialize>(v: T) -> Res<Value> {
    serde_json::to_value(v).map_err(e)
}

/// Run blocking core work off the async threads.
pub(crate) async fn blk<T, F>(live: &Arc<Live>, f: F) -> Res<T>
where
    T: Send + 'static,
    F: FnOnce(&Core) -> Res<T> + Send + 'static,
{
    let core = live.core.clone();
    tokio::task::spawn_blocking(move || f(&core))
        .await
        .map_err(e)?
}

pub(crate) async fn space_of(live: &Arc<Live>, a: &Value) -> Res<(SpaceId, String)> {
    let label = str_arg(a, "spaceId")?;
    let l = label.clone();
    let id = blk(live, move |c| c.resolve_space(&l).map_err(e)).await?;
    Ok((id, label))
}

/// Hand fresh events to the network, update the UI, and announce any blobs they carry.
pub(crate) async fn after_events(ctx: &Ctx, label: &str, events: &[SignedEvent]) {
    for (space, evs) in group(events) {
        ctx.publish(&space, &evs).await;
    }
    ctx.changed(label, ALL_COLLECTIONS);
}

fn group(events: &[SignedEvent]) -> Vec<(SpaceId, Vec<SignedEvent>)> {
    let mut out: Vec<(SpaceId, Vec<SignedEvent>)> = Vec::new();
    for ev in events {
        match out.iter_mut().find(|(s, _)| *s == ev.space_id) {
            Some((_, v)) => v.push(ev.clone()),
            None => out.push((ev.space_id, vec![ev.clone()])),
        }
    }
    out
}

/// Event types the UI may not append directly: they have dedicated commands that also handle
/// key rotation and invite bookkeeping, or are produced only by the runtime.
fn appendable(body: &EventBody) -> Res<()> {
    match body {
        EventBody::Unknown => Err("unknown event type".into()),
        EventBody::SpaceRekey { .. }
        | EventBody::DeviceLink { .. }
        | EventBody::DeviceRevoke { .. }
        | EventBody::MemberRemove { .. }
        | EventBody::MemberRole { .. }
        | EventBody::InviteCreate { .. }
        | EventBody::InviteRevoke { .. } => Err("use the dedicated command for that action".into()),
        _ => Ok(()),
    }
}

async fn dispatch(ctx: &Arc<Ctx>, name: &str, a: &Value) -> Res<Value> {
    let live = ctx.live().await?;
    match name {
        // ---- legal, identity ----
        "legal_status" => to_json(blk(&live, |c| c.legal_status().map_err(e)).await?),
        "legal_accept" => {
            let version = str_arg(a, "version")?;
            let share = a
                .get("shareResources")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let st = blk(&live, move |c| c.legal_accept(&version, share).map_err(e)).await?;
            if let Err(err) = ctx.start_node().await {
                tracing::error!("node start after legal accept: {err}");
            }
            to_json(st)
        }
        "identity_get" => to_json(blk(&live, |c| c.identity().map_err(e)).await?),
        "profile_set" => {
            let input: ProfileInput =
                serde_json::from_value(a.clone()).map_err(|x| format!("invalid profile: {x}"))?;
            let evs = blk(&live, move |c| c.profile_set(input).map_err(e)).await?;
            after_events(ctx, "home", &evs).await;
            to_json(blk(&live, |c| c.identity().map_err(e)).await?)
        }
        "snapshot" => blk(&live, |c| c.snapshot().map_err(e)).await,

        // ---- spaces and invites ----
        "space_create" => {
            let (n, t, k) = (
                str_arg(a, "name")?,
                opt_str(a, "tagline").unwrap_or_default(),
                str_arg(a, "kind")?,
            );
            let made = blk(&live, move |c| c.space_create(&n, &t, &k).map_err(e)).await?;
            if let Some(node) = ctx.node().await {
                let _ = node.join_space(made.id.0).await;
            }
            after_events(ctx, &made.label, &made.events).await;
            summary(&live, made.id).await
        }
        "space_leave" => {
            let (id, label) = space_of(&live, a).await?;
            let evs = blk(&live, move |c| c.space_leave(&id).map_err(e)).await?;
            ctx.publish(&id, &evs).await;
            if let Some(node) = ctx.node().await {
                let _ = node.leave_space(id.0).await;
            }
            ctx.changed(&label, ALL_COLLECTIONS);
            Ok(Value::Null)
        }
        "invite_create" => invite_create(ctx, &live, a).await,
        "invite_accept" => invite_accept(ctx, &live, a).await,
        "invite_list" => {
            let (id, _) = space_of(&live, a).await?;
            let rows = blk(&live, move |c| {
                let list = c.invite_list(&id).map_err(e)?;
                Ok(list
                    .into_iter()
                    .map(|i| {
                        let code = c.setting_get(&format!("invite.{}", i.id)).ok().flatten();
                        let link = code.as_ref().map(|k| format!("{}{k}", hermod_core::invite::LINK_BASE));
                        json!({
                            "id": i.id, "created_by": i.by, "created_at": i.created_at, "exp": i.exp,
                            "max_uses": i.max_uses, "uses": i.uses, "role": i.role, "revoked": i.revoked,
                            "code": code, "link": link,
                        })
                    })
                    .collect::<Vec<_>>())
            })
            .await?;
            Ok(Value::Array(rows))
        }
        "invite_revoke" => {
            let (id, label) = space_of(&live, a).await?;
            let inv = str_arg(a, "id")?;
            let evs = blk(&live, move |c| c.invite_revoke(&id, &inv).map_err(e)).await?;
            ctx.publish(&id, &evs).await;
            ctx.changed(&label, ALL_COLLECTIONS);
            Ok(Value::Null)
        }
        "space_members" => {
            let (id, _) = space_of(&live, a).await?;
            let online = live.online_in(&id);
            let rows = blk(&live, move |c| {
                let me = c.user_id();
                Ok(c.members(&id)
                    .map_err(e)?
                    .into_iter()
                    .map(|m| {
                        let on = m.user.parse::<UserId>().is_ok_and(|u| u == me || online.contains(&u));
                        json!({ "user_id": m.user, "name": m.name, "role": m.role, "joined_at": m.joined_at, "online": on, "removed": false })
                    })
                    .collect::<Vec<_>>())
            })
            .await?;
            Ok(Value::Array(rows))
        }
        "member_set_role" => {
            let (id, label) = space_of(&live, a).await?;
            let user = user_arg(a, "user")?;
            let role: Role = serde_json::from_value(a.get("role").cloned().unwrap_or_default())
                .map_err(|_| "unknown role".to_string())?;
            let ev = blk(&live, move |c| {
                c.member_set_role(&id, &user, role).map_err(e)
            })
            .await?;
            ctx.publish(&id, &[ev]).await;
            ctx.changed(&label, ALL_COLLECTIONS);
            Ok(Value::Null)
        }
        "member_remove" => {
            let (id, label) = space_of(&live, a).await?;
            let user = user_arg(a, "user")?;
            let evs = blk(&live, move |c| c.member_remove(&id, &user).map_err(e)).await?;
            ctx.publish(&id, &evs).await;
            ctx.changed(&label, ALL_COLLECTIONS);
            Ok(Value::Null)
        }

        // ---- events and blobs ----
        "event_append" => {
            let (id, label) = space_of(&live, a).await?;
            let raw = a.get("body").cloned().ok_or("missing body")?;
            if raw.to_string().len() > MAX_EVENT_JSON {
                return Err("that action is too large".into());
            }
            let body: EventBody =
                serde_json::from_value(raw).map_err(|x| format!("invalid action: {x}"))?;
            appendable(&body)?;
            let refs: Vec<BlobRef> = body.blob_refs().into_iter().cloned().collect();
            let tag = serde_json::to_value(&body)
                .ok()
                .and_then(|v| v.get("t").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_default();
            let ev = blk(&live, move |c| c.append(&id, body).map_err(e)).await?;
            live.remember_blobs(refs.iter());
            ctx.publish(&id, &[ev]).await;
            if let Some(node) = ctx.node().await {
                for r in &refs {
                    if let Ok(h) = ids::hex_decode_array::<32>(&r.hash) {
                        let _ = node.announce_blob(id.0, h).await;
                    }
                }
            }
            ctx.changed(&label, collections_for(&tag));
            Ok(Value::Null)
        }
        "blob_put" => {
            let path = PathBuf::from(str_arg(a, "path")?);
            if !ctx.path_allowed(&path) {
                return Err("choose the file with the file picker first".into());
            }
            let meta =
                std::fs::metadata(&path).map_err(|_| "that file cannot be read".to_string())?;
            if !meta.is_file() {
                return Err("that is not a file".into());
            }
            let r = blk(&live, move |c| c.blob_put_path(&path).map_err(e)).await?;
            live.remember_blobs([&r]);
            to_json(r)
        }
        "blob_put_bytes" => put_bytes(ctx, a, bytes_arg(a, "bytes")?).await,
        "pick_files" => {
            let shell = ctx
                .shell
                .clone()
                .ok_or("file picking is only available in the desktop app")?;
            let multiple = a.get("multiple").and_then(Value::as_bool).unwrap_or(false);
            let accept: Vec<String> = a
                .get("accept")
                .and_then(Value::as_array)
                .map(|v| {
                    v.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let picked = tokio::task::spawn_blocking(move || shell.pick_files(multiple, &accept))
                .await
                .map_err(e)??;
            Ok(match picked {
                None => Value::Null,
                Some(paths) => {
                    for p in &paths {
                        ctx.allow_path(p.clone());
                    }
                    json!(
                        paths
                            .iter()
                            .map(|p| p.to_string_lossy().into_owned())
                            .collect::<Vec<_>>()
                    )
                }
            })
        }
        "blob_save_as" => {
            let hash = str_arg(a, "hash")?;
            let suggested =
                clean_name(&opt_str(a, "suggestedName").unwrap_or_else(|| "file".into()));
            let shell = ctx
                .shell
                .clone()
                .ok_or("saving is only available in the desktop app")?;
            let Some(dest) = tokio::task::spawn_blocking(move || shell.save_dialog(&suggested))
                .await
                .map_err(e)??
            else {
                return Ok(Value::Null);
            };
            blob::ensure_local(ctx, &hash).await?;
            let d = dest.clone();
            blk(&live, move |c| write_blob(c, &hash, &d)).await?;
            Ok(json!(dest.to_string_lossy()))
        }
        "save_file" => save_bytes(ctx, a, bytes_arg(a, "bytes")?).await,

        // ---- node ----
        "node_status" => Ok(ctx.node_view().await),
        "node_settings_get" => settings_view(&live).await,
        "node_settings_set" => {
            let patch: NodePatch =
                serde_json::from_value(a.clone()).map_err(|x| format!("invalid settings: {x}"))?;
            let s = blk(&live, move |c| {
                let s = settings::node_settings_set(c, &patch)?;
                c.set_rate(s.rate());
                Ok(s)
            })
            .await?;
            if let Some(node) = ctx.node().await {
                node.set_limits(s.limits()).await.map_err(e)?;
            }
            ctx.refresh_background().await;
            ctx.emit("node", json!({ "status": ctx.node_view().await }));
            settings_view(&live).await
        }
        "media_signal" => {
            let (id, _) = space_of(&live, a).await?;
            let payload =
                serde_json::to_vec(a.get("payload").unwrap_or(&Value::Null)).map_err(e)?;
            if payload.len() > MAX_SIGNAL_BYTES {
                return Err("signal too large".into());
            }
            let to = match opt_str(a, "to") {
                Some(u) => Some(
                    adapter::peer_of_user(
                        &u.parse::<UserId>().map_err(|_| "bad user id".to_string())?,
                    )
                    .ok_or("bad user id")?,
                ),
                None => None,
            };
            let node = ctx.node().await.ok_or("the network is off")?;
            node.send_signal(id.0, to, payload).await.map_err(e)?;
            Ok(Value::Null)
        }
        "send_ephemeral" => {
            let (id, _) = space_of(&live, a).await?;
            let kind = str_arg(a, "kind")?;
            let payload =
                serde_json::to_vec(a.get("payload").unwrap_or(&Value::Null)).map_err(e)?;
            let node = ctx.node().await.ok_or("the network is off")?;
            node.send_ephemeral(id.0, &kind, payload).await.map_err(e)?;
            Ok(Value::Null)
        }
        "outbox_status" => {
            let st = match ctx.node().await {
                Some(n) => n.status().await.ok(),
                None => None,
            };
            Ok(
                json!({ "pending": st.as_ref().map_or(0, |s| s.outbox + s.sync_pending), "peers": st.map_or(0, |s| s.peers) }),
            )
        }

        // ---- device-local state ----
        "read_mark" => {
            let (id, label) = space_of(&live, a).await?;
            let ch = str_arg(a, "channelId")?;
            let receipt = blk(&live, move |c| c.mark_read(&id, &ch).map_err(e)).await?;
            if let Some(ev) = receipt {
                ctx.publish(&id, &[ev]).await;
            }
            ctx.changed(&label, &["channels", "inbox"]);
            Ok(Value::Null)
        }
        "notify_send" => {
            let (title, body) = (str_arg(a, "title")?, str_arg(a, "body")?);
            if let Some(shell) = ctx.shell.clone() {
                shell.notify(
                    &title.chars().take(120).collect::<String>(),
                    &body.chars().take(240).collect::<String>(),
                );
            }
            Ok(Value::Null)
        }
        "badge_set" => {
            if let Some(shell) = ctx.shell.clone() {
                shell.badge(u32::try_from(opt_u64(a, "count").unwrap_or(0)).unwrap_or(u32::MAX));
            }
            Ok(Value::Null)
        }
        "arcade_tool" => {
            let op = str_arg(a, "op")?;
            hermod_core::games::tool(&op, a.get("args").unwrap_or(&Value::Null))
        }
        "game_legal_moves" => hermod_core::games::legal_moves(
            &str_arg(a, "kind")?,
            &str_arg(a, "gameId")?,
            a.get("options").unwrap_or(&Value::Null),
            a.get("moves").unwrap_or(&Value::Null),
        ),
        "read_markers" => to_json(blk(&live, |c| c.read_markers().map_err(e)).await?),
        "block_user" => {
            let u = user_arg(a, "userId")?;
            blk(&live, move |c| c.block_user(&u).map_err(e)).await?;
            ctx.changed("home", ALL_COLLECTIONS);
            Ok(Value::Null)
        }
        "unblock_user" => {
            let u = user_arg(a, "userId")?;
            blk(&live, move |c| c.unblock_user(&u).map_err(e)).await?;
            ctx.changed("home", ALL_COLLECTIONS);
            Ok(Value::Null)
        }
        "block_list" => {
            let rows = blk(&live, |c| {
                let names = people_names(c);
                Ok(c.blocked_since()
                    .map_err(e)?
                    .into_iter()
                    .map(|(u, since)| json!({ "name": names.get(&u).cloned().unwrap_or_else(|| u.chars().take(8).collect()), "user_id": u, "since": since }))
                    .collect::<Vec<_>>())
            })
            .await?;
            Ok(Value::Array(rows))
        }
        "notify_settings_get" => to_json(blk(&live, settings::notify_settings).await?),
        "notify_settings_set" => {
            let patch = a.clone();
            to_json(blk(&live, move |c| settings::notify_settings_set(c, &patch)).await?)
        }
        "retention_set" => {
            let (id, _) = space_of(&live, a).await?;
            let days = match a.get("days") {
                None | Some(Value::Null) => None,
                Some(v) => Some(
                    v.as_u64()
                        .filter(|d| (1..=36500).contains(d))
                        .ok_or("retention must be 1 to 36500 days")? as u32,
                ),
            };
            blk(&live, move |c| {
                settings::retention_set(c, &id.to_string(), days)
            })
            .await?;
            Ok(Value::Null)
        }

        // ---- search, storage, audit, logs ----
        "search_query" => search(&live, a).await,
        "storage_usage" => {
            let u = blk(&live, |c| c.storage_usage().map_err(e)).await?;
            let per: Vec<Value> = u.spaces.iter().map(|s| json!({ "space_id": s.label, "name": s.name, "bytes": s.event_bytes + s.blob_bytes })).collect();
            let total = u.blob_store_bytes + u.spaces.iter().map(|s| s.event_bytes).sum::<u64>();
            Ok(
                json!({ "total_bytes": total, "cache_for_others_bytes": u.cache_bytes, "per_space": per }),
            )
        }
        "storage_clear_cache" => {
            let freed = blk(&live, |c| c.storage_clear_cache().map_err(e)).await?;
            live.forget_blob_info();
            Ok(json!({ "freed_bytes": freed }))
        }
        "audit_list" => {
            let (id, label) = space_of(&live, a).await?;
            let rows = blk(&live, move |c| c.audit_list(&id).map_err(e)).await?;
            Ok(Value::Array(
                rows.into_iter()
                    .map(|r| json!({ "ts": r.ts, "space_id": label, "kind": r.kind, "by": r.by, "subject": r.target, "detail": r.detail }))
                    .collect(),
            ))
        }
        "log_tail" => {
            let n = opt_u64(a, "lines")
                .unwrap_or(200)
                .clamp(1, LOG_TAIL_MAX as u64) as usize;
            Ok(json!(tail_log(ctx.opts.log_file.as_deref(), n)))
        }

        // ---- backup, reset, updates, devices ----
        "backup_export" => {
            let pass = str_arg(a, "passphrase")?;
            if pass.chars().count() < 8 {
                return Err("choose a passphrase of at least 8 characters".into());
            }
            let blobs = a
                .get("includeBlobs")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let Some(path) = backup_target(ctx, a).await? else {
                return Ok(Value::Null);
            };
            let out = json!(path.to_string_lossy());
            blk(&live, move |c| {
                c.backup_export(&path, &pass, blobs).map_err(e)
            })
            .await?;
            Ok(out)
        }
        "backup_import" => {
            let path = PathBuf::from(str_arg(a, "path")?);
            if !ctx.path_allowed(&path) {
                return Err("choose the backup with the file picker first".into());
            }
            let pass = str_arg(a, "passphrase")?;
            drop(live);
            ctx.with_closed(move |dir| restore_backup(dir, &path, &pass))
                .await?;
            Ok(Value::Null)
        }
        "app_reset" => {
            drop(live);
            ctx.with_closed(|dir| Core::wipe_data(dir).map_err(e))
                .await?;
            Ok(Value::Null)
        }
        "update_check" => {
            let shell = ctx
                .shell
                .clone()
                .ok_or("updates are only available in the desktop app")?;
            shell.update_check().await
        }
        "update_install" => {
            let shell = ctx
                .shell
                .clone()
                .ok_or("updates are only available in the desktop app")?;
            shell.update_install().await?;
            Ok(Value::Null)
        }
        "device_list" => {
            let me = live.core.user_id().to_string();
            Ok(
                json!([{ "device_pub": me, "name": "This device", "added_at": 0, "this_device": true, "revoked": false }]),
            )
        }
        "device_link_start" | "device_link_accept" | "device_revoke" => {
            Err("Linking another device is not available in this version of Hermod".into())
        }
        other => match crate::messaging_api::handle(ctx, &live, other, a).await {
            Some(r) => r,
            None => Err(format!("unknown command: {other}")),
        },
    }
}

pub(crate) async fn summary(live: &Arc<Live>, id: SpaceId) -> Res<Value> {
    let sid = id.to_string();
    let list = blk(live, |c| c.spaces().map_err(e)).await?;
    list.into_iter()
        .find(|s| s.space_id == sid)
        .map(to_json)
        .unwrap_or_else(|| Err(CLEAR_MSG.into()))
}

async fn settings_view(live: &Arc<Live>) -> Res<Value> {
    let s: NodeSettings = blk(live, settings::node_settings).await?;
    Ok(json!({ "values": s, "ceilings": NodeSettings::ceilings() }))
}

async fn invite_create(ctx: &Arc<Ctx>, live: &Arc<Live>, a: &Value) -> Res<Value> {
    let (id, label) = space_of(live, a).await?;
    let role: Role = match a.get("role") {
        None | Some(Value::Null) => Role::Member,
        Some(v) => serde_json::from_value(v.clone()).map_err(|_| "unknown role".to_string())?,
    };
    let opts_base = (
        opt_u64(a, "expiresIn"),
        opt_u64(a, "maxUses").map(|n| n.min(u32::MAX as u64) as u32),
    );
    let addrs = local_addrs(ctx).await;
    let (out, ev) = blk(live, move |c| {
        let (o, ev) = c
            .invite_create_event(
                &id,
                InviteOptions {
                    expires_in_secs: opts_base.0,
                    max_uses: opts_base.1,
                    role,
                    addrs,
                },
            )
            .map_err(e)?;
        // Keep the code so the link can be shown again (device-local, the log never holds it).
        let _ = c.setting_set(&format!("invite.{}", o.id), &o.code);
        Ok((o, ev))
    })
    .await?;
    // The joiner needs this event to be admitted, so it goes out now, not on the next sync.
    ctx.publish(&id, &[ev]).await;
    ctx.changed(&label, ALL_COLLECTIONS);
    to_json(out)
}

/// Addresses for an invite: wait briefly for the node to know at least one.
async fn local_addrs(ctx: &Ctx) -> Vec<String> {
    let Some(node) = ctx.node().await else {
        return Vec::new();
    };
    let deadline = tokio::time::Instant::now() + ADDR_WAIT;
    loop {
        let found: Vec<String> = node
            .local_addrs()
            .await
            .unwrap_or_default()
            .iter()
            .map(|a| a.to_string())
            .collect();
        if !found.is_empty() || tokio::time::Instant::now() >= deadline {
            return found;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

pub(crate) async fn invite_accept(ctx: &Arc<Ctx>, live: &Arc<Live>, a: &Value) -> Res<Value> {
    let code = str_arg(a, "code")?;
    let joined = blk(live, move |c| c.invite_accept(code.trim()).map_err(e)).await?;
    if let Some(node) = ctx.node().await {
        let addrs: Vec<hermod_node::Multiaddr> =
            joined.addrs.iter().filter_map(|s| s.parse().ok()).collect();
        if !addrs.is_empty() {
            match tokio::time::timeout(DIAL_WAIT, node.dial(addrs)).await {
                Ok(Ok(p)) => tracing::info!("connected to inviter {p}"),
                Ok(Err(err)) => tracing::warn!("could not reach the inviter yet: {err}"),
                Err(_) => tracing::warn!("timed out reaching the inviter"),
            }
        }
        node.join_space(joined.id.0).await.map_err(e)?;
    }
    ctx.publish(&joined.id, &joined.events).await;
    ctx.changed(&joined.label, ALL_COLLECTIONS);
    summary(live, joined.id).await
}

async fn search(live: &Arc<Live>, a: &Value) -> Res<Value> {
    let q = str_arg(a, "q")?;
    let limit = opt_u64(a, "limit").map_or(DEFAULT_SEARCH_LIMIT, |n| n as usize);
    let kinds: Vec<String> = a
        .get("kinds")
        .and_then(Value::as_array)
        .map(|v| {
            v.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let space = opt_str(a, "space");
    let hits = blk(live, move |c| {
        let id = match &space {
            Some(l) => Some(c.resolve_space(l).map_err(e)?),
            None => None,
        };
        let labels: std::collections::BTreeMap<String, String> = c
            .spaces()
            .map_err(e)?
            .into_iter()
            .map(|s| (s.space_id, s.label))
            .collect();
        let hits = c.search_query(&q, id.as_ref(), &kinds, limit).map_err(e)?;
        Ok(hits
            .into_iter()
            .map(|h| {
                let plain: String = h
                    .snippet
                    .chars()
                    .filter(|ch| {
                        *ch != hermod_core::search::HIT_OPEN
                            && *ch != hermod_core::search::HIT_CLOSE
                    })
                    .collect();
                let title: String = plain.chars().take(80).collect();
                json!({
                    "kind": h.kind, "space_id": labels.get(&h.space).cloned().unwrap_or(h.space),
                    "channel_id": if h.channel.is_empty() { Value::Null } else { json!(h.channel) },
                    "id": h.id, "title": title, "snippet": h.snippet, "by": h.author, "ts": h.ts,
                })
            })
            .collect::<Vec<_>>())
    })
    .await?;
    Ok(Value::Array(hits))
}

fn people_names(c: &Core) -> std::collections::BTreeMap<String, String> {
    c.snapshot()
        .ok()
        .and_then(|v| v.get("people").and_then(Value::as_object).cloned())
        .map(|m| {
            m.into_iter()
                .filter_map(|(k, v)| {
                    v.get("name")
                        .and_then(Value::as_str)
                        .map(|n| (k, n.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn clean_name(n: &str) -> String {
    let base = n.rsplit(['/', '\\']).next().unwrap_or("file").trim();
    let s: String = base.chars().filter(|c| !c.is_control()).take(120).collect();
    if s.is_empty() { "file".into() } else { s }
}

fn bytes_arg(a: &Value, key: &str) -> Res<Vec<u8>> {
    let arr = a
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("missing {key}"))?;
    if arr.len() > MAX_UPLOAD_BYTES {
        return Err("that file is too large".into());
    }
    arr.iter()
        .map(|v| {
            v.as_u64()
                .and_then(|n| u8::try_from(n).ok())
                .ok_or_else(|| "bad file data".to_string())
        })
        .collect()
}

async fn put_bytes(ctx: &Arc<Ctx>, a: &Value, bytes: Vec<u8>) -> Res<Value> {
    let live = ctx.live().await?;
    let name = clean_name(&str_arg(a, "name")?);
    let r = blk(&live, move |c| c.blob_put_bytes(&name, &bytes).map_err(e)).await?;
    live.remember_blobs([&r]);
    to_json(r)
}

async fn save_bytes(ctx: &Arc<Ctx>, a: &Value, bytes: Vec<u8>) -> Res<Value> {
    let suggested = clean_name(&opt_str(a, "suggestedName").unwrap_or_else(|| "file".into()));
    let shell = ctx
        .shell
        .clone()
        .ok_or("saving is only available in the desktop app")?;
    let Some(dest) = tokio::task::spawn_blocking(move || shell.save_dialog(&suggested))
        .await
        .map_err(e)??
    else {
        return Ok(Value::Null);
    };
    std::fs::write(&dest, bytes).map_err(|x| format!("could not save the file: {x}"))?;
    Ok(json!(dest.to_string_lossy()))
}

/// Where a backup goes: the app asks the person with the save dialog (the webview names no
/// path); the devhost and tests, which have no dialog, may pass one.
async fn backup_target(ctx: &Arc<Ctx>, a: &Value) -> Res<Option<PathBuf>> {
    let Some(shell) = ctx.shell.clone() else {
        let path = PathBuf::from(str_arg(a, "path")?);
        if !ctx.path_allowed(&path)
            || !path.is_absolute()
            || path.parent().is_none_or(|p| !p.is_dir())
        {
            return Err("choose an existing folder for the backup".into());
        }
        return Ok(Some(path));
    };
    let suggested = clean_name(&opt_str(a, "suggestedName").unwrap_or_else(|| "backup".into()));
    tokio::task::spawn_blocking(move || shell.save_dialog(&suggested))
        .await
        .map_err(e)?
}

/// Restore into a scratch dir (this proves the file and passphrase), then swap it in. Reading
/// and decrypting the backup happens once, and the live data is untouched until it succeeds.
fn restore_backup(dir: &std::path::Path, file: &std::path::Path, pass: &str) -> Res<()> {
    let probe = dir.with_extension("restore-check");
    let _ = std::fs::remove_dir_all(&probe);
    let staged = Core::backup_import(&probe, file, pass)
        .map_err(|x| format!("cannot restore this backup: {x}"))
        .and_then(|()| {
            Core::wipe_data(dir).map_err(e)?;
            for entry in std::fs::read_dir(&probe).map_err(e)? {
                let name = entry.map_err(e)?.file_name();
                std::fs::rename(probe.join(&name), dir.join(&name)).map_err(e)?;
            }
            Ok(())
        });
    let _ = std::fs::remove_dir_all(&probe);
    staged
}

fn write_blob(c: &Core, hash: &str, dest: &std::path::Path) -> Res<()> {
    use std::io::Write;
    let m = c
        .blobs()
        .manifest(hash)
        .map_err(e)?
        .ok_or("file not found")?;
    let mut f = std::fs::File::create(dest).map_err(|x| format!("could not save the file: {x}"))?;
    for idx in 0..m.chunks.len() {
        f.write_all(&c.blobs().read_chunk(hash, idx as u32).map_err(e)?)
            .map_err(e)?;
    }
    f.sync_all().map_err(e)
}

fn tail_log(file: Option<&std::path::Path>, n: usize) -> Vec<String> {
    let Some(f) = file else { return Vec::new() };
    let Ok(text) = std::fs::read_to_string(f) else {
        return Vec::new();
    };
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(n)..]
        .iter()
        .map(|s| s.to_string())
        .collect()
}
