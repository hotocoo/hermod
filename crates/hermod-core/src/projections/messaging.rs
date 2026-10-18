//! Messaging fold: channel settings and permissions, slowmode, disappearing timers, rich
//! message extensions, custom emoji and stickers, receipts, threads, nicknames, DM invites and
//! automation rules (docs/MESSAGING.md). Everything here is deterministic: it only reads the
//! event being applied and state folded before it, never a clock (expiry and thread
//! auto-archive are evaluated at render time against `ProjectionCtx::now_ms`).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::state::{Ord3, SpaceState};
use crate::event::{BlobRef, EventBody, Role};
use crate::msgext::*;
use crate::store::Opened;

const KINDS: [&str; 6] = [
    "voice",
    "video_note",
    "sticker",
    "gif",
    "poll",
    "forum_post",
];
const CHAN_KINDS: [&str; 5] = ["text", "announcement", "forum", "voice", "stage"];
const MAX_EMOJI_BYTES: u64 = 256 * 1024;
const MAX_STICKER_BYTES: u64 = 512 * 1024;
const MAX_BANNER_BYTES: u64 = 2 * 1024 * 1024;
const MAX_EMOJI: usize = 200;
const MAX_STICKERS: usize = 400;
const MAX_NAME: usize = 32;
const MAX_STATUS: usize = 80;
const MAX_PRONOUNS: usize = 24;
const MAX_ID: usize = 128;
const MAX_TRIGGER_LOG: usize = 400;
const MAX_AUTO_WORDS: usize = 10;
const DEFAULT_AUTO_ARCHIVE_SECS: u32 = 7 * 24 * 3600;
const AUTO_TRIGGER_TAGS: [&str; 4] = ["member.join", "ticket.create", "poll.close", "post.create"];

/// Channel settings after merging every `channel.settings` in fold order.
#[derive(Debug, Clone, Default)]
pub struct ChanCfg {
    pub kind: String,
    pub category: String,
    pub position: i32,
    pub slowmode_secs: u32,
    pub ttl_secs: u32,
    pub send_min: Option<Role>,
    pub view_min: Option<Role>,
    pub manage_min: Option<Role>,
    pub mention_min: Option<Role>,
    pub tags: Vec<String>,
    pub auto_archive_secs: Option<u32>,
    pub archived: bool,
    /// Who last changed the timer and when (for the "disappearing messages" system line).
    pub ttl_by: String,
    pub ttl_ts: i64,
}

/// Facts about one accepted message that `projections::state::Msg` does not carry.
#[derive(Debug, Clone, Default)]
pub struct MsgExtra {
    pub ext: MsgExt,
    pub expires: Option<i64>,
    pub everyone: bool,
    pub here: bool,
    pub viewed: BTreeSet<String>,
    pub preview_desc: String,
    pub preview_blob: Option<BlobRef>,
}

#[derive(Debug, Clone)]
pub struct EmojiSt {
    pub id: String,
    pub name: String,
    pub blob: BlobRef,
    pub by: String,
}

#[derive(Debug, Clone)]
pub struct StickerSt {
    pub id: String,
    pub pack: String,
    pub name: String,
    pub blob: BlobRef,
    pub emoji: String,
    pub by: String,
}

#[derive(Debug, Clone, Default)]
pub struct ProfExtSt {
    pub banner: Option<BlobRef>,
    pub status: String,
    pub status_emoji: String,
    pub status_until: Option<i64>,
    pub pronouns: String,
}

#[derive(Debug, Clone)]
pub struct DmInviteSt {
    pub id: String,
    pub by: String,
    pub ts: i64,
    pub to: String,
    pub space_id: String,
    pub name: String,
    pub group: bool,
}

#[derive(Debug, Clone)]
pub struct AutoSt {
    pub id: String,
    pub by: String,
    pub ts: i64,
    pub name: String,
    pub enabled: bool,
    pub trigger: AutoTrigger,
    pub action: AutoAction,
}

/// One event an automation may react to.
#[derive(Debug, Clone)]
pub struct TriggerEvt {
    pub id: String,
    pub ts: i64,
    pub by: String,
    pub tag: String,
    pub channel: String,
    pub text: String,
    pub subject: String,
}

/// Action a rule wants appended, produced by [`SpaceState::automation_pending`].
#[derive(Debug, Clone, PartialEq)]
pub struct Planned {
    pub rule: String,
    pub src: String,
    pub body: EventBody,
}

#[derive(Debug, Default)]
pub struct MsgState {
    pub chans: BTreeMap<String, ChanCfg>,
    pub extras: HashMap<String, MsgExtra>,
    pub reads: BTreeMap<String, BTreeMap<String, u64>>,
    pub last_post: HashMap<(String, String), i64>,
    pub emoji: Vec<EmojiSt>,
    pub stickers: Vec<StickerSt>,
    pub profiles: BTreeMap<String, ProfExtSt>,
    pub nicks: BTreeMap<String, String>,
    pub dm_invites: Vec<DmInviteSt>,
    pub automations: Vec<AutoSt>,
    pub trigger_log: Vec<TriggerEvt>,
    /// `(rule id, src event id)` already answered by an event carrying `ext.auto`.
    pub done: HashSet<(String, String)>,
    /// Latest explicit thread state per root message: `(archived, ts)`.
    pub thread_state: HashMap<String, (bool, i64)>,
}

fn role_or(r: Option<Role>, default: Role) -> Role {
    r.unwrap_or(default)
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn valid_name(n: &str) -> bool {
    (2..=MAX_NAME).contains(&n.chars().count())
        && n.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// True when `text` contains `@word` delimited by non-word characters.
pub fn has_mention(text: &str, word: &str) -> bool {
    let needle = format!("@{word}");
    let lower = text.to_lowercase();
    lower.match_indices(&needle).any(|(i, _)| {
        let before = lower[..i].chars().next_back();
        let after = lower[i + needle.len()..].chars().next();
        before.is_none_or(|c| !c.is_alphanumeric() && c != '_')
            && after.is_none_or(|c| !c.is_alphanumeric() && c != '_')
    })
}

fn normalize(ext: &MsgExt, has_att: bool, chan_kind: &str) -> MsgExt {
    let mut e = ext.clone();
    if let Some(q) = &mut e.quote {
        q.text = clip(&q.text, MAX_QUOTE_CHARS);
        q.by = clip(&q.by, MAX_ID);
        q.msg_id = clip(&q.msg_id, MAX_ID);
    }
    if let Some(f) = &mut e.fwd {
        f.origin = clip(&f.origin, 80);
        f.by = clip(&f.by, MAX_ID);
    }
    if let Some(v) = &mut e.voice {
        v.dur_ms = v.dur_ms.min(MAX_NOTE_MS);
        v.peaks.truncate(MAX_PEAKS);
    }
    e.ttl_secs = e.ttl_secs.map(|t| t.clamp(MIN_TTL_SECS, MAX_TTL_SECS));
    e.tags = e
        .tags
        .iter()
        .map(|t| clip(t.trim(), MAX_TAG_CHARS))
        .filter(|t| !t.is_empty())
        .take(MAX_POST_TAGS)
        .collect();
    e.title = e
        .title
        .map(|t| clip(t.trim(), 200))
        .filter(|t| !t.is_empty());
    if let Some(k) = e.kind.clone() {
        let ok = KINDS.contains(&k.as_str())
            && match k.as_str() {
                "voice" | "video_note" => has_att && e.voice.is_some(),
                "sticker" | "gif" => has_att,
                "poll" => e.poll.is_some(),
                "forum_post" => chan_kind == "forum" && e.title.is_some(),
                _ => false,
            };
        if !ok {
            e.kind = None;
        }
    }
    if e.kind.as_deref() != Some("sticker") {
        e.sticker = None;
    }
    if e.kind.as_deref() != Some("poll") {
        e.poll = None;
    }
    if e.kind.as_deref() != Some("forum_post") {
        e.title = None;
        e.tags.clear();
    }
    e.sticker = e.sticker.map(|s| clip(&s, MAX_ID));
    e.poll = e.poll.map(|s| clip(&s, MAX_ID));
    e
}

impl MsgState {
    pub fn cfg(&self, channel: &str) -> Option<&ChanCfg> {
        self.chans.get(channel)
    }

    /// Role a channel's posts need (announcement channels imply admin).
    pub fn send_floor(cfg: &ChanCfg) -> Role {
        let floor = role_or(cfg.send_min, Role::Member);
        if cfg.kind == "announcement" {
            floor.max(Role::Admin)
        } else {
            floor
        }
    }

    pub fn emoji_by_name(&self, name: &str) -> Option<&EmojiSt> {
        self.emoji.iter().find(|e| e.name == name)
    }

    /// Effective expiry in unix ms, from the message and channel timers.
    pub fn expiry(&self, channel: &str, ts: i64, ext_ttl: Option<u32>) -> Option<i64> {
        let chan = self
            .chans
            .get(channel)
            .map(|c| c.ttl_secs)
            .filter(|t| *t > 0);
        let secs = match (ext_ttl, chan) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }?;
        Some(ts.saturating_add(i64::from(secs) * 1000))
    }
}

impl SpaceState {
    /// Extra authorization for messaging events; called after the base role check passed.
    pub fn msgx_allows(&self, by: &str, role: Role, body: &EventBody, ts: i64) -> bool {
        match body {
            EventBody::MessagePost {
                channel_id,
                reply_to,
                target,
                ext,
                attachments,
                ..
            } => {
                if target.is_some() {
                    return true;
                }
                let Some(cfg) = self.msgx.cfg(channel_id) else {
                    return true;
                };
                if role < MsgState::send_floor(cfg) {
                    return false;
                }
                if cfg.kind == "forum" && reply_to.is_none() {
                    let e = ext
                        .as_ref()
                        .map(|e| normalize(e, !attachments.is_empty(), "forum"));
                    if e.is_none_or(|e| e.kind.as_deref() != Some("forum_post")) {
                        return false;
                    }
                }
                if cfg.slowmode_secs > 0 && role < Role::Admin {
                    let key = (channel_id.clone(), by.to_string());
                    if let Some(last) = self.msgx.last_post.get(&key)
                        && ts.saturating_sub(*last) < i64::from(cfg.slowmode_secs) * 1000
                    {
                        return false;
                    }
                }
                true
            }
            EventBody::ChannelSettings {
                channel_id,
                slowmode_secs,
                ttl_secs,
                kind,
                tags,
                ..
            } => {
                if !self.channels.iter().any(|c| &c.id == channel_id) {
                    return false;
                }
                let cfg = self.msgx.cfg(channel_id);
                if slowmode_secs.is_some_and(|s| s > MAX_SLOWMODE_SECS)
                    || ttl_secs
                        .is_some_and(|t| t != 0 && !(MIN_TTL_SECS..=MAX_TTL_SECS).contains(&t))
                    || kind.as_deref().is_some_and(|k| !CHAN_KINDS.contains(&k))
                    || tags.as_ref().is_some_and(|t| t.len() > MAX_TAGS)
                {
                    return false;
                }
                let managers = cfg.and_then(|c| c.manage_min);
                role >= Role::Admin
                    || managers.is_some_and(|m| role >= m)
                    || (self.kind == "dm" && role >= Role::Member)
            }
            EventBody::ThreadState { msg_id, .. } => {
                role >= Role::Admin || self.msg_author(msg_id) == Some(by)
            }
            EventBody::MessageViewed { msg_id } => self.msg_author(msg_id).is_some_and(|a| a != by),
            EventBody::EmojiAdd {
                emoji_id,
                name,
                blob,
                deleted,
            } => {
                if *deleted {
                    return self
                        .msgx
                        .emoji
                        .iter()
                        .any(|e| &e.id == emoji_id && (e.by == by || role >= Role::Admin));
                }
                valid_name(name)
                    && blob.size <= MAX_EMOJI_BYTES
                    && blob.mime.starts_with("image/")
                    && emoji_id.len() <= MAX_ID
                    && self.msgx.emoji.len() < MAX_EMOJI
                    && self.msgx.emoji_by_name(name).is_none()
                    && !self.msgx.emoji.iter().any(|e| &e.id == emoji_id)
            }
            EventBody::StickerAdd {
                sticker_id,
                name,
                blob,
                deleted,
                pack,
                ..
            } => {
                if *deleted {
                    return self
                        .msgx
                        .stickers
                        .iter()
                        .any(|e| &e.id == sticker_id && (e.by == by || role >= Role::Admin));
                }
                !name.trim().is_empty()
                    && name.chars().count() <= 64
                    && pack.chars().count() <= 64
                    && blob.size <= MAX_STICKER_BYTES
                    && blob.mime.starts_with("image/")
                    && sticker_id.len() <= MAX_ID
                    && self.msgx.stickers.len() < MAX_STICKERS
                    && !self.msgx.stickers.iter().any(|e| &e.id == sticker_id)
            }
            EventBody::ProfileExt {
                banner,
                status,
                pronouns,
                ..
            } => {
                banner
                    .as_ref()
                    .is_none_or(|b| b.size <= MAX_BANNER_BYTES && b.mime.starts_with("image/"))
                    && status
                        .as_ref()
                        .is_none_or(|s| s.chars().count() <= MAX_STATUS)
                    && pronouns
                        .as_ref()
                        .is_none_or(|p| p.chars().count() <= MAX_PRONOUNS)
            }
            EventBody::MemberNick { nick, user } => {
                if nick.chars().count() > MAX_NAME {
                    return false;
                }
                match user {
                    None => true,
                    Some(u) if u == by => true,
                    Some(u) => role >= Role::Admin && self.role_of(u).is_some_and(|r| r < role),
                }
            }
            EventBody::DmInvite {
                space_id,
                name,
                addrs,
                to,
                invite_id,
                ..
            } => {
                space_id.len() == 64
                    && space_id.chars().all(|c| c.is_ascii_hexdigit())
                    && name.chars().count() <= 80
                    && addrs.len() <= 8
                    && !to.is_empty()
                    && to.len() <= MAX_ID
                    && invite_id.len() <= MAX_ID
            }
            EventBody::AutomationSet {
                id,
                name,
                trigger,
                action,
                deleted,
                ..
            } => {
                if id.is_empty() || id.len() > MAX_ID || name.chars().count() > 80 {
                    return false;
                }
                if *deleted {
                    return self.msgx.automations.iter().any(|a| &a.id == id);
                }
                let known = self.msgx.automations.iter().any(|a| &a.id == id);
                let trig_ok = match trigger.kind.as_str() {
                    "keyword" => {
                        !trigger.words.is_empty()
                            && trigger.words.len() <= MAX_AUTO_WORDS
                            && trigger
                                .words
                                .iter()
                                .all(|w| !w.trim().is_empty() && w.chars().count() <= 64)
                    }
                    "event" => AUTO_TRIGGER_TAGS.contains(&trigger.tag.as_str()),
                    _ => false,
                };
                let act_ok = match action.kind.as_str() {
                    "post_message" => !action.channel.is_empty() && !action.text.trim().is_empty(),
                    "create_ticket" => !action.text.trim().is_empty() || !action.queue.is_empty(),
                    "assign_ticket" => {
                        !action.assignee.is_empty() && trigger.tag == "ticket.create"
                    }
                    _ => false,
                } && action.text.chars().count() <= 2000;
                trig_ok && act_ok && (known || self.msgx.automations.len() < MAX_AUTOMATIONS)
            }
            _ => true,
        }
    }

    /// Records messaging facts after the base fold applied (or ignored) an accepted event.
    pub fn msgx_after(&mut self, ev: &Opened, by: &str, ord: Ord3) {
        let ts = ev.ts;
        let role = self.role_of(by).unwrap_or(Role::Guest);
        match &ev.body {
            EventBody::MessagePost {
                channel_id,
                msg_id,
                text,
                attachments,
                target,
                ext,
                preview,
                ..
            } => {
                if target.is_some() {
                    return;
                }
                self.msgx
                    .last_post
                    .insert((channel_id.clone(), by.to_string()), ts);
                let chan_kind = self
                    .msgx
                    .cfg(channel_id)
                    .map(|c| c.kind.clone())
                    .unwrap_or_default();
                let auto = ext.as_ref().and_then(|e| e.auto.clone());
                if let Some(a) = &auto {
                    self.msgx.done.insert((a.id.clone(), a.src.clone()));
                }
                let top_level =
                    self.msg_author(msg_id) == Some(by) && !self.msgx.extras.contains_key(msg_id);
                if !top_level {
                    self.log_trigger(ev, by, "message.post", channel_id, text, "", auto.is_some());
                    return;
                }
                let norm = normalize(
                    ext.as_deref().unwrap_or(&MsgExt::default()),
                    !attachments.is_empty(),
                    &chan_kind,
                );
                let cfg = self.msgx.cfg(channel_id);
                let mention_floor = role_or(cfg.and_then(|c| c.mention_min), Role::Admin);
                let allowed = role >= mention_floor;
                let extra = MsgExtra {
                    expires: self.msgx.expiry(channel_id, ts, norm.ttl_secs),
                    everyone: allowed && has_mention(text, "everyone"),
                    here: allowed && has_mention(text, "here"),
                    viewed: BTreeSet::new(),
                    preview_desc: clip(
                        preview.as_ref().map_or("", |p| p.description.as_str()),
                        300,
                    ),
                    preview_blob: preview.as_ref().and_then(|p| p.image.clone()),
                    ext: norm,
                };
                self.msgx.extras.insert(msg_id.clone(), extra);
                self.log_trigger(ev, by, "message.post", channel_id, text, "", auto.is_some());
            }
            EventBody::ReadMark { channel_id, upto } => {
                let e = self
                    .msgx
                    .reads
                    .entry(channel_id.clone())
                    .or_default()
                    .entry(by.to_string())
                    .or_insert(0);
                *e = (*e).max(*upto);
            }
            EventBody::MessageViewed { msg_id } => {
                if let Some(x) = self.msgx.extras.get_mut(msg_id) {
                    x.viewed.insert(by.to_string());
                }
            }
            EventBody::ThreadState { msg_id, archived } => {
                self.msgx
                    .thread_state
                    .insert(msg_id.clone(), (*archived, ts));
            }
            EventBody::ChannelSettings {
                channel_id,
                kind,
                category,
                position,
                slowmode_secs,
                ttl_secs,
                send_min,
                view_min,
                manage_min,
                mention_min,
                tags,
                auto_archive_secs,
                archived,
                name,
                topic,
            } => {
                if let Some(c) = self.channels.iter_mut().find(|c| &c.id == channel_id) {
                    if let Some(n) = name.as_ref().filter(|n| !n.trim().is_empty()) {
                        c.name = clip(n.trim(), 80);
                    }
                    if let Some(t) = topic {
                        c.topic = clip(t, 280);
                    }
                }
                let cfg = self.msgx.chans.entry(channel_id.clone()).or_default();
                if cfg.kind.is_empty() {
                    cfg.kind = "text".into();
                }
                if let Some(k) = kind {
                    cfg.kind = k.clone();
                }
                if let Some(c) = category {
                    cfg.category = clip(c.trim(), MAX_CATEGORY_CHARS);
                }
                if let Some(p) = position {
                    cfg.position = *p;
                }
                if let Some(s) = slowmode_secs {
                    cfg.slowmode_secs = *s;
                }
                if let Some(t) = ttl_secs {
                    cfg.ttl_secs = *t;
                    cfg.ttl_by = by.to_string();
                    cfg.ttl_ts = ts;
                }
                // Role floors are only ever set by someone at or above them.
                for (slot, v) in [
                    (&mut cfg.send_min, send_min),
                    (&mut cfg.view_min, view_min),
                    (&mut cfg.manage_min, manage_min),
                    (&mut cfg.mention_min, mention_min),
                ] {
                    if let Some(r) = v {
                        *slot = (*r <= role).then_some(*r).or(*slot);
                    }
                }
                if let Some(t) = tags {
                    cfg.tags = t
                        .iter()
                        .map(|x| clip(x.trim(), MAX_TAG_CHARS))
                        .filter(|x| !x.is_empty())
                        .collect();
                }
                if let Some(a) = auto_archive_secs {
                    cfg.auto_archive_secs = Some(*a);
                }
                if let Some(a) = archived {
                    cfg.archived = *a;
                }
            }
            EventBody::EmojiAdd {
                emoji_id,
                name,
                blob,
                deleted,
            } => {
                if *deleted {
                    self.msgx.emoji.retain(|e| &e.id != emoji_id);
                } else {
                    self.msgx.emoji.push(EmojiSt {
                        id: emoji_id.clone(),
                        name: name.clone(),
                        blob: blob.clone(),
                        by: by.to_string(),
                    });
                }
            }
            EventBody::StickerAdd {
                sticker_id,
                pack,
                name,
                blob,
                emoji,
                deleted,
            } => {
                if *deleted {
                    self.msgx.stickers.retain(|e| &e.id != sticker_id);
                } else {
                    self.msgx.stickers.push(StickerSt {
                        id: sticker_id.clone(),
                        pack: if pack.trim().is_empty() {
                            "Stickers".into()
                        } else {
                            clip(pack.trim(), 64)
                        },
                        name: clip(name.trim(), 64),
                        blob: blob.clone(),
                        emoji: clip(emoji, 16),
                        by: by.to_string(),
                    });
                }
            }
            EventBody::ProfileExt {
                banner,
                status,
                status_emoji,
                status_until,
                pronouns,
            } => {
                let p = self.msgx.profiles.entry(by.to_string()).or_default();
                if banner.is_some() {
                    p.banner = banner.clone();
                }
                if let Some(s) = status {
                    p.status = clip(s.trim(), MAX_STATUS);
                    p.status_until = *status_until;
                    p.status_emoji = clip(status_emoji.as_deref().unwrap_or(""), 16);
                }
                if let Some(s) = pronouns {
                    p.pronouns = clip(s.trim(), MAX_PRONOUNS);
                }
            }
            EventBody::MemberNick { nick, user } => {
                let target = user.clone().unwrap_or_else(|| by.to_string());
                let nick = clip(nick.trim(), MAX_NAME);
                if nick.is_empty() {
                    self.msgx.nicks.remove(&target);
                } else {
                    self.msgx.nicks.insert(target, nick);
                }
            }
            EventBody::DmInvite {
                to,
                space_id,
                name,
                group,
                ..
            } => self.msgx.dm_invites.push(DmInviteSt {
                id: ev.id.clone(),
                by: by.to_string(),
                ts,
                to: to.clone(),
                space_id: space_id.clone(),
                name: clip(name, 80),
                group: *group,
            }),
            EventBody::AutomationSet {
                id,
                name,
                enabled,
                trigger,
                action,
                deleted,
            } => {
                let _ = ord;
                self.msgx.automations.retain(|a| &a.id != id);
                if !*deleted {
                    self.msgx.automations.push(AutoSt {
                        id: id.clone(),
                        by: by.to_string(),
                        ts,
                        name: clip(name, 80),
                        enabled: *enabled,
                        trigger: trigger.clone(),
                        action: action.clone(),
                    });
                }
            }
            EventBody::MemberJoin { .. } => {
                self.log_trigger(ev, by, "member.join", "", "", "", false);
            }
            EventBody::TicketCreate {
                subject,
                body,
                fields,
                ..
            } => {
                if let Some(src) = fields.get("_auto").and_then(|v| v.split_once(':')) {
                    self.msgx
                        .done
                        .insert((src.0.to_string(), src.1.to_string()));
                }
                self.log_trigger(
                    ev,
                    by,
                    "ticket.create",
                    "",
                    body,
                    subject,
                    fields.contains_key("_auto"),
                );
            }
            EventBody::PollClose { .. } => {
                self.log_trigger(ev, by, "poll.close", "", "", "", false)
            }
            EventBody::PostCreate { title, text, .. } => self.log_trigger(
                ev,
                by,
                "post.create",
                "",
                text.as_deref().unwrap_or(""),
                title,
                false,
            ),
            _ => {}
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn log_trigger(
        &mut self,
        ev: &Opened,
        by: &str,
        tag: &str,
        channel: &str,
        text: &str,
        subject: &str,
        by_auto: bool,
    ) {
        if by_auto || self.msgx.automations.is_empty() {
            return;
        }
        let log = &mut self.msgx.trigger_log;
        log.push(TriggerEvt {
            id: ev.id.clone(),
            ts: ev.ts,
            by: by.to_string(),
            tag: tag.to_string(),
            channel: channel.to_string(),
            text: clip(text, 2000),
            subject: clip(subject, 200),
        });
        if log.len() > MAX_TRIGGER_LOG {
            log.drain(..log.len() - MAX_TRIGGER_LOG);
        }
    }

    /// Drops expired and device-hidden messages so every view, count and index agrees.
    pub fn prune(&mut self, now_ms: i64, hidden: &BTreeSet<String>) {
        let extras = &self.msgx.extras;
        for list in self.msgs.values_mut() {
            list.retain(|m| {
                !hidden.contains(&m.id)
                    && extras
                        .get(&m.id)
                        .and_then(|x| x.expires)
                        .is_none_or(|e| e > now_ms)
            });
        }
    }

    /// Actions that rules authored by `me` still owe, computed purely from the log.
    pub fn automation_pending(&self, me: &str) -> Vec<Planned> {
        let mut out = Vec::new();
        for rule in self
            .msgx
            .automations
            .iter()
            .filter(|r| r.by == me && r.enabled)
        {
            for e in self.msgx.trigger_log.iter().filter(|e| e.ts > rule.ts) {
                if !trigger_matches(rule, e)
                    || self.msgx.done.contains(&(rule.id.clone(), e.id.clone()))
                {
                    continue;
                }
                if let Some(body) = plan_action(rule, e) {
                    out.push(Planned {
                        rule: rule.id.clone(),
                        src: e.id.clone(),
                        body,
                    });
                }
            }
        }
        out
    }
}

fn trigger_matches(rule: &AutoSt, e: &TriggerEvt) -> bool {
    let t = &rule.trigger;
    match t.kind.as_str() {
        "keyword" => {
            e.tag == "message.post" && (t.channel.is_empty() || t.channel == e.channel) && {
                let lower = e.text.to_lowercase();
                t.words
                    .iter()
                    .any(|w| lower.contains(&w.trim().to_lowercase()))
            }
        }
        "event" => e.tag == t.tag && (t.channel.is_empty() || t.channel == e.channel),
        _ => false,
    }
}

fn fill(template: &str, e: &TriggerEvt) -> String {
    template
        .replace("{{user}}", &e.by)
        .replace("{{text}}", &clip(&e.text, 500))
        .replace("{{subject}}", &e.subject)
}

/// Short stable id derived from a rule and its source event.
pub fn auto_id(rule: &str, src: &str) -> String {
    let h = crate::crypto::blake3_hash(format!("{rule}\0{src}").as_bytes());
    format!(
        "auto-{}",
        crate::ids::hex_encode(&h)
            .chars()
            .take(16)
            .collect::<String>()
    )
}

fn plan_action(rule: &AutoSt, e: &TriggerEvt) -> Option<EventBody> {
    let a = &rule.action;
    let aid = auto_id(&rule.id, &e.id);
    match a.kind.as_str() {
        "post_message" => Some(EventBody::MessagePost {
            channel_id: a.channel.clone(),
            msg_id: aid,
            text: fill(&a.text, e),
            reply_to: None,
            attachments: Vec::new(),
            snap: None,
            mentions: Vec::new(),
            preview: None,
            target: None,
            ext: Some(Box::new(MsgExt {
                auto: Some(AutoRef {
                    id: rule.id.clone(),
                    src: e.id.clone(),
                }),
                ..MsgExt::default()
            })),
        }),
        "create_ticket" => Some(EventBody::TicketCreate {
            ticket_id: aid,
            queue_id: a.queue.clone(),
            subject: {
                let s = fill(&a.text, e);
                let s = if s.trim().is_empty() {
                    e.subject.clone()
                } else {
                    s
                };
                clip(s.lines().next().unwrap_or(""), 200)
            },
            body: fill(&a.text, e),
            priority: "normal".into(),
            fields: BTreeMap::from([("_auto".to_string(), format!("{}:{}", rule.id, e.id))]),
            attachments: Vec::new(),
        }),
        "assign_ticket" => Some(EventBody::TicketUpdate {
            ticket_id: e.id.clone(),
            status: None,
            priority: None,
            queue_id: None,
            assignee: Some(a.assignee.clone()),
            tags_add: vec![format!("auto-{}", clip(&rule.id, 24))],
            tags_remove: Vec::new(),
            fields: BTreeMap::new(),
            due: None,
        }),
        _ => None,
    }
}

// ---- rendering shapes ---------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewView {
    pub url: String,
    pub title: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<BlobRef>,
}

/// Per-message messaging fields (`Message.ext`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MsgView {
    /// Lamport of the message, comparable with read markers.
    pub lp: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote: Option<QuoteRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fwd: Option<Forward>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<VoiceMeta>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sticker: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poll: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub view_once: bool,
    /// Viewers of a view-once message (author sees the count, everyone sees own state).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opened: Vec<String>,
    /// True when the local user opened it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub viewed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub seen_by: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub everyone: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub here: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<AutoRef>,
    /// `open` or `archived` for thread roots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<PreviewView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCfgView {
    pub kind: String,
    pub category: String,
    pub position: i32,
    pub slowmode_secs: u32,
    pub ttl_secs: u32,
    pub send_min: Role,
    pub view_min: Role,
    pub manage_min: Role,
    pub mention_min: Role,
    pub tags: Vec<String>,
    pub auto_archive_secs: u32,
    pub archived: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub ttl_by: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub can_send: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub can_manage: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EmojiView {
    pub id: String,
    pub name: String,
    pub blob: BlobRef,
    pub by: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StickerView {
    pub id: String,
    pub pack: String,
    pub name: String,
    pub blob: BlobRef,
    pub emoji: String,
    pub by: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileExtView {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner: Option<BlobRef>,
    pub status: String,
    pub status_emoji: String,
    pub pronouns: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadView {
    pub id: String,
    pub by: String,
    pub title: String,
    pub replies: u32,
    pub last_ts: i64,
    pub archived: bool,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationView {
    pub id: String,
    pub by: String,
    pub name: String,
    pub enabled: bool,
    pub trigger: AutoTrigger,
    pub action: AutoAction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DmRequestView {
    pub id: String,
    pub from: String,
    pub space_id: String,
    pub name: String,
    pub group: bool,
    pub ts: i64,
    /// Space label the invite travelled through.
    pub via: String,
}

/// Messaging projection for one space.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingView {
    pub channels: BTreeMap<String, ChannelCfgView>,
    pub emoji: Vec<EmojiView>,
    pub stickers: Vec<StickerView>,
    pub nicks: BTreeMap<String, String>,
    pub profiles: BTreeMap<String, ProfileExtView>,
    pub threads: BTreeMap<String, Vec<ThreadView>>,
    pub automations: Vec<AutomationView>,
}

/// `collections.messaging`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Messaging {
    pub spaces: BTreeMap<String, MessagingView>,
    pub dm_requests: Vec<DmRequestView>,
}

impl SpaceState {
    /// Thread archive decision at `now_ms` (explicit state, then auto-archive).
    pub fn thread_archived(&self, root: &str, channel: &str, last_ts: i64, now_ms: i64) -> bool {
        let auto = self
            .msgx
            .cfg(channel)
            .and_then(|c| c.auto_archive_secs)
            .unwrap_or(DEFAULT_AUTO_ARCHIVE_SECS);
        match self.msgx.thread_state.get(root) {
            Some((flag, ts)) => {
                if last_ts > *ts {
                    auto != 0 && now_ms.saturating_sub(last_ts) > i64::from(auto) * 1000
                } else if *flag {
                    true
                } else {
                    auto != 0 && now_ms.saturating_sub(*ts) > i64::from(auto) * 1000
                }
            }
            None => auto != 0 && now_ms.saturating_sub(last_ts) > i64::from(auto) * 1000,
        }
    }
}
