//! `Core` facade for messaging features that are not plain event appends: paging, gallery,
//! message search, device-local state (hidden messages, chat preferences, scheduled queue),
//! DMs and contact cards, saved messages and automation planning (docs/MESSAGING.md).
//!
//! Device-local state lives in the `kv` table under `local.` keys so it is backed up with the
//! rest of the database and never reaches the event log.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::api::{Core, InviteOptions, Joined, SpaceSummary, now_ms};
use crate::error::{Error, Result};
use crate::event::{EventBody, Role, SignedEvent};
use crate::ids::{SpaceId, UserId};
use crate::invite::InviteV1;
use crate::keywrap;
use crate::projections::{
    self, Gallery, MessagePage, MsgHit, Planned, SearchFilters, messaging::DmRequestView,
};
use crate::store::Store;

const HIDDEN_PREFIX: &str = "local.hidden.";
const PREFS_KEY: &str = "local.chatprefs";
const SCHED_KEY: &str = "local.sched";
const CARD_KEY: &str = "local.card";
/// Largest chat-preferences document in bytes.
pub const MAX_PREFS_BYTES: usize = 64 * 1024;
const MAX_HIDDEN_PER_SPACE: usize = 20_000;
/// Most scheduled messages waiting at once.
pub const MAX_SCHEDULED: usize = 200;
/// How far ahead a message may be scheduled.
pub const MAX_SCHEDULE_AHEAD_MS: i64 = 365 * 24 * 3600 * 1000;
const MAX_SCHEDULED_BYTES: usize = 64 * 1024;
const MAX_DM_MEMBERS: usize = 15;
/// Title of a one-to-one dm space made without a name; the projection shows the other person's name instead.
pub(crate) const DM_DEFAULT_TITLE: &str = "Direct message";
/// Channel id of the personal notes chat in the home space.
pub const SAVED_CHANNEL: &str = "saved";
const PREF_LISTS: [&str; 5] = ["archived", "pinned", "gifs", "contacts", "declined"];
const MAX_DECLINED: usize = 500;

/// Reads the device-hidden message set for the projection context.
pub(crate) fn hidden_set(store: &Store) -> Result<BTreeSet<(SpaceId, String)>> {
    let mut out = BTreeSet::new();
    for (k, v) in store.kv_prefix(HIDDEN_PREFIX)? {
        let Ok(space) = k[HIDDEN_PREFIX.len()..].parse::<SpaceId>() else {
            continue;
        };
        let ids: Vec<String> = serde_json::from_str(&v).unwrap_or_default();
        out.extend(ids.into_iter().map(|id| (space, id)));
    }
    Ok(out)
}

/// A scheduled message waiting for its time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Scheduled {
    pub id: String,
    pub space_id: String,
    pub at: i64,
    pub body: EventBody,
    /// Set after a failed send, so the user sees why it never went out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// What happened to one due scheduled message.
#[derive(Debug)]
pub struct SchedOutcome {
    pub id: String,
    pub space: SpaceId,
    pub late: bool,
    pub result: std::result::Result<SignedEvent, String>,
}

/// New events grouped by the space they belong to.
pub type SpaceEvents = (SpaceId, Vec<SignedEvent>);

/// Result of [`Core::dm_start`].
#[derive(Debug, Clone)]
pub struct DmStarted {
    pub summary: SpaceSummary,
    /// Events to hand to the network (dm space log and the carrier invites).
    pub events: Vec<SpaceEvents>,
    /// True when an existing dm was reused.
    pub existing: bool,
}

/// A contact card: an invite to a fresh single-use dm space.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContactCard {
    pub code: String,
    pub link: String,
    pub deep_link: String,
    pub space_id: String,
    pub user_id: String,
}

fn random_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}",
        crate::ids::hex_encode(&crate::crypto::random_bytes::<8>())
    )
}

fn merge_prefs(current: &Value, patch: &Value) -> Result<Value> {
    let (Some(cur), Some(p)) = (current.as_object(), patch.as_object()) else {
        return Err(Error::invalid("chat preferences", "must be an object"));
    };
    let mut out: Map<String, Value> = cur.clone();
    for (k, v) in p {
        match k.as_str() {
            "folders" | "gifs" | "archived" | "pinned" | "contacts" | "declined" => {
                if !v.is_array() {
                    return Err(Error::invalid(
                        "chat preferences",
                        format!("{k} must be a list"),
                    ));
                }
            }
            "muted" => {
                let ok = v.as_object().is_some_and(|m| m.values().all(Value::is_i64));
                if !ok {
                    return Err(Error::invalid(
                        "chat preferences",
                        "muted must map chats to times",
                    ));
                }
            }
            _ => {
                return Err(Error::invalid(
                    "chat preferences",
                    format!("unknown key {k}"),
                ));
            }
        }
        out.insert(k.clone(), v.clone());
    }
    for list in PREF_LISTS {
        if let Some(Value::Array(a)) = out.get_mut(list) {
            let cap = if list == "declined" {
                MAX_DECLINED
            } else {
                2000
            };
            if a.len() > cap {
                let drop = a.len() - cap;
                a.drain(..drop);
            }
        }
    }
    let size = serde_json::to_string(&out)?.len();
    if size > MAX_PREFS_BYTES {
        return Err(Error::invalid("chat preferences", "document too large"));
    }
    Ok(Value::Object(out))
}

impl Core {
    // ---- delete for me ----

    /// Hides one message on this device only. Nothing is sent.
    pub fn message_hide(&self, space: &SpaceId, msg_id: &str) -> Result<()> {
        if msg_id.is_empty() || msg_id.len() > 128 {
            return Err(Error::invalid("message id", "empty or too long"));
        }
        let inner = self.lock();
        inner.row(space)?;
        let key = format!("{HIDDEN_PREFIX}{space}");
        let mut ids: Vec<String> = inner
            .store
            .kv_get(&key)?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default();
        if !ids.iter().any(|i| i == msg_id) {
            ids.push(msg_id.to_string());
            if ids.len() > MAX_HIDDEN_PER_SPACE {
                ids.remove(0);
            }
            inner.store.kv_set(&key, &serde_json::to_string(&ids)?)?;
        }
        Ok(())
    }

    /// Reverses [`Core::message_hide`].
    pub fn message_unhide(&self, space: &SpaceId, msg_id: &str) -> Result<()> {
        let inner = self.lock();
        let key = format!("{HIDDEN_PREFIX}{space}");
        let mut ids: Vec<String> = inner
            .store
            .kv_get(&key)?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default();
        ids.retain(|i| i != msg_id);
        inner.store.kv_set(&key, &serde_json::to_string(&ids)?)
    }

    // ---- chat preferences ----

    pub fn chat_prefs_get(&self) -> Result<Value> {
        let raw = self.lock().store.kv_get(PREFS_KEY)?;
        Ok(raw
            .and_then(|r| serde_json::from_str(&r).ok())
            .unwrap_or_else(|| json!({})))
    }

    /// Shallow merge of `patch` into the stored document (lists and `muted` replaced whole).
    pub fn chat_prefs_set(&self, patch: &Value) -> Result<Value> {
        let inner = self.lock();
        let cur: Value = inner
            .store
            .kv_get(PREFS_KEY)?
            .and_then(|r| serde_json::from_str(&r).ok())
            .unwrap_or_else(|| json!({}));
        let next = merge_prefs(&cur, patch)?;
        inner
            .store
            .kv_set(PREFS_KEY, &serde_json::to_string(&next)?)?;
        Ok(next)
    }

    // ---- paging, gallery, search ----

    /// Newest `limit` messages of a channel older than lamport `before`.
    pub fn messages_page(
        &self,
        space: &SpaceId,
        channel: &str,
        before: Option<u64>,
        limit: usize,
    ) -> Result<MessagePage> {
        let inner = self.lock();
        let row = inner.row(space)?;
        let ctx = inner.ctx(&self.config, now_ms())?;
        let input = inner.input(&row)?;
        Ok(projections::messages_page(
            &ctx, &input, channel, before, limit,
        ))
    }

    /// Media, files, links or voice notes of a channel, newest first.
    pub fn media_gallery(
        &self,
        space: &SpaceId,
        channel: &str,
        kind: &str,
        before: Option<u64>,
        limit: usize,
    ) -> Result<Gallery> {
        if !matches!(kind, "media" | "files" | "links" | "voice") {
            return Err(Error::invalid(
                "gallery kind",
                "media, files, links or voice",
            ));
        }
        let inner = self.lock();
        let row = inner.row(space)?;
        let ctx = inner.ctx(&self.config, now_ms())?;
        let input = inner.input(&row)?;
        Ok(projections::media_gallery(
            &ctx, &input, channel, kind, before, limit,
        ))
    }

    /// Message search with filters over the folded state (honours edits, deletes, expiry).
    pub fn messages_search(
        &self,
        space: Option<&SpaceId>,
        filters: &SearchFilters,
    ) -> Result<Vec<MsgHit>> {
        let inner = self.lock();
        let rows: Vec<_> = match space {
            Some(id) => vec![inner.row(id)?],
            None => inner
                .store
                .spaces()?
                .into_iter()
                .filter(|s| !s.left)
                .collect(),
        };
        let ctx = inner.ctx(&self.config, now_ms())?;
        let inputs = rows
            .iter()
            .map(|r| inner.input(r))
            .collect::<Result<Vec<_>>>()?;
        Ok(projections::search_messages(&ctx, &inputs, filters))
    }

    // ---- scheduled queue ----

    fn sched_load(store: &Store) -> Result<Vec<Scheduled>> {
        Ok(store
            .kv_get(SCHED_KEY)?
            .and_then(|r| serde_json::from_str(&r).ok())
            .unwrap_or_default())
    }

    fn sched_save(store: &Store, list: &[Scheduled]) -> Result<()> {
        store.kv_set(SCHED_KEY, &serde_json::to_string(list)?)
    }

    /// Queues a message post for `at` (unix ms, in the future, at most a year ahead).
    pub fn schedule_add(&self, space: &SpaceId, body: EventBody, at: i64) -> Result<Scheduled> {
        let now = now_ms();
        if at <= now || at > now + MAX_SCHEDULE_AHEAD_MS {
            return Err(Error::invalid(
                "schedule time",
                "must be in the future, within a year",
            ));
        }
        if !matches!(body, EventBody::MessagePost { .. }) {
            return Err(Error::invalid(
                "scheduled event",
                "only messages can be scheduled",
            ));
        }
        if serde_json::to_vec(&body)?.len() > MAX_SCHEDULED_BYTES {
            return Err(Error::invalid("scheduled message", "too large"));
        }
        let inner = self.lock();
        inner.row(space)?;
        let mut list = Self::sched_load(&inner.store)?;
        if list.len() >= MAX_SCHEDULED {
            return Err(Error::invalid("schedule", "too many scheduled messages"));
        }
        let item = Scheduled {
            id: random_id("sch"),
            space_id: space.to_string(),
            at,
            body,
            error: None,
        };
        list.push(item.clone());
        list.sort_by_key(|s| s.at);
        Self::sched_save(&inner.store, &list)?;
        Ok(item)
    }

    pub fn schedule_list(&self) -> Result<Vec<Scheduled>> {
        Self::sched_load(&self.lock().store)
    }

    pub fn schedule_cancel(&self, id: &str) -> Result<()> {
        let inner = self.lock();
        let mut list = Self::sched_load(&inner.store)?;
        let before = list.len();
        list.retain(|s| s.id != id);
        if list.len() == before {
            return Err(Error::NotFound(format!("scheduled message {id}")));
        }
        Self::sched_save(&inner.store, &list)
    }

    /// Earliest pending schedule time, for the runner's sleep.
    pub fn schedule_next(&self) -> Result<Option<i64>> {
        Ok(Self::sched_load(&self.lock().store)?
            .iter()
            .filter(|s| s.error.is_none())
            .map(|s| s.at)
            .min())
    }

    /// Sends every due message; failures stay in the list with their reason.
    pub fn schedule_run_due(&self, now: i64, late_after_ms: i64) -> Result<Vec<SchedOutcome>> {
        let mut inner = self.lock();
        let mut list = Self::sched_load(&inner.store)?;
        let mut out = Vec::new();
        let mut keep = Vec::new();
        for mut item in list.drain(..) {
            if item.error.is_some() || item.at > now {
                keep.push(item);
                continue;
            }
            let Ok(space) = item.space_id.parse::<SpaceId>() else {
                continue;
            };
            let late = now - item.at > late_after_ms;
            match inner.append(&space, &item.body) {
                Ok(ev) => out.push(SchedOutcome {
                    id: item.id,
                    space,
                    late,
                    result: Ok(ev),
                }),
                Err(e) => {
                    item.error = Some(e.to_string());
                    out.push(SchedOutcome {
                        id: item.id.clone(),
                        space,
                        late,
                        result: Err(e.to_string()),
                    });
                    keep.push(item);
                }
            }
        }
        Self::sched_save(&inner.store, &keep)?;
        Ok(out)
    }

    // ---- saved messages ----

    /// Ensures the personal `saved` channel exists in the home space. Returns the new events
    /// (home is local-only, so they are never published).
    pub fn saved_open(&self) -> Result<(String, String, Vec<SignedEvent>)> {
        let mut inner = self.lock();
        let home = inner
            .store
            .home()?
            .ok_or_else(|| Error::UnknownSpace(crate::api::HOME_LABEL.into()))?;
        let input = inner.input(&home)?;
        let has = input.events.iter().any(|e| {
            matches!(&e.body, EventBody::ChannelCreate { channel_id, .. } if channel_id == SAVED_CHANNEL)
        });
        let mut events = Vec::new();
        if !has {
            events.push(inner.append(
                &home.id,
                &EventBody::ChannelCreate {
                    channel_id: SAVED_CHANNEL.into(),
                    name: "Saved messages".into(),
                    topic: "Notes to self".into(),
                    dm: None,
                    guest: false,
                },
            )?);
        }
        Ok((crate::api::HOME_LABEL.into(), SAVED_CHANNEL.into(), events))
    }

    // ---- DMs and contacts ----

    /// Space kinds as the log says (a joined row keeps `Space` until its own fold).
    fn kinds(&self) -> Result<std::collections::BTreeMap<String, String>> {
        let snap = self.snapshot()?;
        Ok(snap
            .get("spaces")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|s| {
                        Some((
                            s.get("id")?.as_str()?.to_string(),
                            s.get("kind")?.as_str()?.to_string(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    fn dm_space_with(&self, user: &UserId) -> Result<Option<SpaceSummary>> {
        let me = self.user_id();
        let kinds = self.kinds()?;
        for s in self.spaces()? {
            if kinds.get(&s.label).map(String::as_str) != Some("dm") {
                continue;
            }
            let Ok(id) = s.space_id.parse::<SpaceId>() else {
                continue;
            };
            let members: BTreeSet<String> =
                self.members(&id)?.into_iter().map(|m| m.user).collect();
            let want: BTreeSet<String> = [me.to_string(), user.to_string()].into();
            if members == want {
                return Ok(Some(SpaceSummary {
                    kind: "dm".into(),
                    ..s
                }));
            }
        }
        Ok(None)
    }

    /// A joined non-home space both `me` and `user` belong to, if any.
    fn carrier_space(&self, user: &UserId) -> Result<Option<SpaceId>> {
        let kinds = self.kinds()?;
        for s in self.spaces()? {
            if s.home || kinds.get(&s.label).map(String::as_str) == Some("dm") {
                continue;
            }
            let Ok(id) = s.space_id.parse::<SpaceId>() else {
                continue;
            };
            if self
                .members(&id)?
                .iter()
                .any(|m| m.user == user.to_string())
            {
                return Ok(Some(id));
            }
        }
        Ok(None)
    }

    /// Opens a one-to-one or group DM. New dms are `kind: "dm"` spaces; each recipient gets a
    /// sealed `dm.invite` in a space we already share (or an error naming the contact card).
    pub fn dm_start(
        &self,
        users: &[UserId],
        name: Option<&str>,
        addrs: Vec<String>,
    ) -> Result<DmStarted> {
        let me = self.user_id();
        let mut who: Vec<UserId> = users.iter().copied().filter(|u| *u != me).collect();
        who.sort_by_key(|u| u.to_string());
        who.dedup();
        if who.is_empty() || who.len() > MAX_DM_MEMBERS {
            return Err(Error::invalid("dm", "choose 1 to 15 other people"));
        }
        if who.len() == 1
            && let Some(summary) = self.dm_space_with(&who[0])?
        {
            return Ok(DmStarted {
                summary,
                events: Vec::new(),
                existing: true,
            });
        }
        let mut carriers = Vec::new();
        for u in &who {
            let c = self.carrier_space(u)?.ok_or_else(|| {
                Error::invalid(
                    "dm",
                    "you share no space with that person yet, send them your contact card instead",
                )
            })?;
            carriers.push(c);
        }
        let group = who.len() > 1;
        let title = name
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .unwrap_or(if group { "Group" } else { DM_DEFAULT_TITLE });
        let made = self.lock().new_space(title, "", "dm", &["chat"], false)?;
        let mut all: Vec<SpaceEvents> = Vec::new();
        for (user, carrier) in who.iter().zip(&carriers) {
            let out = self.invite_create_with(
                &made.id,
                InviteOptions {
                    expires_in_secs: None,
                    max_uses: Some(1),
                    role: Role::Member,
                    addrs: addrs.clone(),
                },
            )?;
            let inv = InviteV1::decode(&out.code)?;
            let sealed = keywrap::wrap(user, &inv.space_key)?;
            let ev = self.append(
                carrier,
                EventBody::DmInvite {
                    to: user.to_string(),
                    space_id: made.id.to_string(),
                    name: title.to_string(),
                    epoch: inv.epoch,
                    lc: inv.lc,
                    invite_id: inv.id.clone(),
                    addrs: addrs.clone(),
                    sealed_key: sealed,
                    group,
                },
            )?;
            all.push((*carrier, vec![ev]));
        }
        let space_events = self.missing_since(&made.id, &Default::default())?;
        all.push((made.id, space_events));
        Ok(DmStarted {
            summary: SpaceSummary {
                label: made.label.clone(),
                space_id: made.id.to_string(),
                name: title.to_string(),
                kind: "dm".into(),
                home: false,
            },
            events: all,
            existing: false,
        })
    }

    /// DM requests addressed to me, minus the ones I declined.
    pub fn dm_requests(&self) -> Result<Vec<DmRequestView>> {
        let declined: BTreeSet<String> = self
            .chat_prefs_get()?
            .get("declined")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let snap = self.snapshot()?;
        let reqs: Vec<DmRequestView> = serde_json::from_value(
            snap.pointer("/collections/messaging/dmRequests")
                .cloned()
                .unwrap_or_else(|| json!([])),
        )?;
        Ok(reqs
            .into_iter()
            .filter(|r| !declined.contains(&r.id))
            .collect())
    }

    /// Joins the dm behind request `id` (the `dm.invite` event id) and adds the sender as a
    /// contact.
    pub fn dm_accept(&self, id: &str) -> Result<Joined> {
        let ev = self
            .lock()
            .store
            .event_by_id(id)?
            .ok_or_else(|| Error::NotFound("dm request".into()))?;
        let keys = self.lock().store.all_keys(&ev.space_id)?;
        let opened = keys
            .get(&ev.epoch)
            .and_then(|ks| ev.open_any(ks).ok())
            .ok_or(Error::Decrypt)?;
        let EventBody::DmInvite {
            to,
            space_id,
            name,
            epoch,
            lc,
            invite_id,
            addrs,
            sealed_key,
            ..
        } = opened.body
        else {
            return Err(Error::invalid("dm request", "not a dm invitation"));
        };
        if to != self.user_id().to_string() {
            return Err(Error::Forbidden(
                "that invitation is not addressed to you".into(),
            ));
        }
        let key = {
            let inner = self.lock();
            keywrap::unwrap(&inner.identity, &sealed_key)?
        };
        let inv = InviteV1::new(
            invite_id,
            space_id.parse()?,
            key,
            epoch,
            lc,
            name,
            ev.author,
            addrs,
            None,
        );
        let joined = self.invite_accept(&inv.encode()?)?;
        self.contact_add_local(&ev.author.to_string())?;
        Ok(joined)
    }

    pub fn dm_decline(&self, id: &str) -> Result<()> {
        let mut declined: Vec<Value> = self
            .chat_prefs_get()?
            .get("declined")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if !declined.iter().any(|v| v.as_str() == Some(id)) {
            declined.push(json!(id));
        }
        self.chat_prefs_set(&json!({ "declined": declined }))?;
        Ok(())
    }

    /// Adds a user id to the device-local contact list.
    pub fn contact_add_local(&self, user: &str) -> Result<()> {
        let _: UserId = user.parse()?;
        let mut list: Vec<Value> = self
            .chat_prefs_get()?
            .get("contacts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if !list.iter().any(|v| v.as_str() == Some(user)) {
            list.push(json!(user));
            self.chat_prefs_set(&json!({ "contacts": list }))?;
        }
        Ok(())
    }

    pub fn contact_remove_local(&self, user: &str) -> Result<()> {
        let list: Vec<Value> = self
            .chat_prefs_get()?
            .get("contacts")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter(|v| v.as_str() != Some(user))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        self.chat_prefs_set(&json!({ "contacts": list }))?;
        Ok(())
    }

    /// A shareable card: an invite to a single-use dm space. Reused while still unclaimed.
    pub fn contact_card(&self, addrs: Vec<String>) -> Result<(ContactCard, Vec<SpaceEvents>)> {
        let stored: Option<ContactCard> = self
            .lock()
            .store
            .kv_get(CARD_KEY)?
            .and_then(|r| serde_json::from_str(&r).ok());
        if let Some(card) = stored
            && let Ok(id) = card.space_id.parse::<SpaceId>()
            && let Ok(invites) = self.invite_list(&id)
            && invites.iter().any(|i| !i.revoked && i.uses == 0)
        {
            return Ok((card, Vec::new()));
        }
        let made = self
            .lock()
            .new_space("Contact", "", "dm", &["chat"], false)?;
        let out = self.invite_create_with(
            &made.id,
            InviteOptions {
                expires_in_secs: None,
                max_uses: Some(1),
                role: Role::Member,
                addrs,
            },
        )?;
        let card = ContactCard {
            code: out.code,
            link: out.link,
            deep_link: out.deep_link,
            space_id: made.id.to_string(),
            user_id: self.user_id().to_string(),
        };
        self.lock()
            .store
            .kv_set(CARD_KEY, &serde_json::to_string(&card)?)?;
        let events = self.missing_since(&made.id, &Default::default())?;
        Ok((card, vec![(made.id, events)]))
    }

    // ---- automations ----

    /// Actions the local user's automation rules owe in `space`, from the log alone.
    pub fn automation_plan(&self, space: &SpaceId) -> Result<Vec<Planned>> {
        let inner = self.lock();
        let row = inner.row(space)?;
        let ctx = inner.ctx(&self.config, now_ms())?;
        let input = inner.input(&row)?;
        Ok(projections::automation_pending(&ctx, &input))
    }
}
