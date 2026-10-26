//! Rendering of the messaging projection (child of `render` so it can read `World`).

use std::collections::BTreeMap;

use super::*;
use crate::event::Role;
use crate::projections::messaging::{
    AutomationView, ChannelCfgView, DmRequestView, EmojiView, Messaging, MessagingView, MsgView,
    PreviewView, ProfileExtView, StickerView, ThreadView,
};

const MAX_SEEN_BY: usize = 32;
const DEFAULT_AUTO_ARCHIVE_SECS: u32 = 7 * 24 * 3600;

impl<'a> World<'a> {
    /// `message` plus the messaging fields that need the channel.
    pub(super) fn message_in(&self, s: &SpaceState, ch: &str, m: &Msg) -> Message {
        let mut out = self.message(s, m);
        let view = self.msg_view(s, ch, m);
        if view.view_once && view.viewed && m.by != self.me && m.removed.is_none() {
            out.att = None;
            out.img = None;
        }
        out.ext = Some(view);
        out
    }

    fn msg_view(&self, s: &SpaceState, ch: &str, m: &Msg) -> MsgView {
        let x = s.msgx.extras.get(&m.id);
        let seen_by: Vec<String> = s
            .msgx
            .reads
            .get(ch)
            .map(|r| {
                r.iter()
                    .filter(|(u, upto)| **u != m.by && **upto >= m.ord.0)
                    .map(|(u, _)| u.clone())
                    .take(MAX_SEEN_BY)
                    .collect()
            })
            .unwrap_or_default();
        let ext = x.map(|x| x.ext.clone()).unwrap_or_default();
        let is_thread_root = !m.thread.is_empty() || ext.kind.as_deref() == Some("forum_post");
        let thread_state = is_thread_root.then(|| {
            let last = m.thread.last().map_or(m.ts, |r| r.ts.max(m.ts));
            if s.thread_archived(&m.id, ch, last, self.ctx.now_ms) {
                "archived".to_string()
            } else {
                "open".to_string()
            }
        });
        MsgView {
            lp: m.ord.0,
            quote: ext.quote,
            fwd: ext.fwd,
            kind: ext.kind,
            voice: ext.voice,
            sticker: ext.sticker,
            poll: ext.poll,
            view_once: ext.view_once,
            opened: if m.by == self.me {
                x.map(|x| x.viewed.iter().cloned().collect())
                    .unwrap_or_default()
            } else {
                Vec::new()
            },
            viewed: x.is_some_and(|x| x.viewed.contains(&self.me)),
            expires: x.and_then(|x| x.expires),
            title: ext.title,
            tags: ext.tags,
            seen_by,
            everyone: x.is_some_and(|x| x.everyone),
            here: x.is_some_and(|x| x.here),
            admins: x.is_some_and(|x| x.admins),
            owners: x.is_some_and(|x| x.owners),
            pings_me: x.is_some_and(|x| {
                let mine = s.role_of(&self.me);
                x.everyone
                    || x.here
                    || (x.admins && mine >= Some(Role::Admin))
                    || (x.owners && mine == Some(Role::Owner))
            }),
            auto: ext.auto,
            thread_state,
            preview: m.preview.as_ref().map(|(url, title, _)| PreviewView {
                url: url.clone(),
                title: title.clone(),
                description: x.map(|x| x.preview_desc.clone()).unwrap_or_default(),
                image: x.and_then(|x| x.preview_blob.clone()),
            }),
        }
    }

    fn channel_views(&self, s: &SpaceState) -> BTreeMap<String, ChannelCfgView> {
        let mine = s.role_of(&self.me);
        s.channels
            .iter()
            .map(|c| {
                let cfg = s.msgx.cfg(&c.id);
                let default_send = if c.guest { Role::Guest } else { Role::Member };
                let send_min = cfg.map_or(default_send, |g| {
                    let floor = g.send_min.unwrap_or(default_send);
                    if g.kind == "announcement" {
                        floor.max(Role::Admin)
                    } else {
                        floor
                    }
                });
                let manage_min = cfg.and_then(|g| g.manage_min).unwrap_or(Role::Admin);
                let view = ChannelCfgView {
                    kind: cfg
                        .map(|g| g.kind.clone())
                        .filter(|k| !k.is_empty())
                        .unwrap_or_else(|| "text".into()),
                    category: cfg.map(|g| g.category.clone()).unwrap_or_default(),
                    position: cfg.map_or(0, |g| g.position),
                    slowmode_secs: cfg.map_or(0, |g| g.slowmode_secs),
                    ttl_secs: cfg.map_or(0, |g| g.ttl_secs),
                    send_min,
                    view_min: cfg.and_then(|g| g.view_min).unwrap_or(Role::Guest),
                    manage_min,
                    mention_min: cfg.and_then(|g| g.mention_min).unwrap_or(Role::Admin),
                    tags: cfg.map(|g| g.tags.clone()).unwrap_or_default(),
                    auto_archive_secs: cfg
                        .and_then(|g| g.auto_archive_secs)
                        .unwrap_or(DEFAULT_AUTO_ARCHIVE_SECS),
                    archived: cfg.is_some_and(|g| g.archived),
                    ttl_by: cfg.map(|g| g.ttl_by.clone()).unwrap_or_default(),
                    can_send: mine.is_some_and(|r| r >= send_min),
                    can_manage: mine.is_some_and(|r| r >= Role::Admin || r >= manage_min),
                };
                (c.id.clone(), view)
            })
            .collect()
    }

    fn thread_views(&self, s: &SpaceState) -> BTreeMap<String, Vec<ThreadView>> {
        let mut out = BTreeMap::new();
        for (ch, list) in &s.msgs {
            let mut rows: Vec<ThreadView> = list
                .iter()
                .filter_map(|m| {
                    let ext = s.msgx.extras.get(&m.id).map(|x| &x.ext);
                    let forum = ext.is_some_and(|e| e.kind.as_deref() == Some("forum_post"));
                    if m.thread.is_empty() && !forum {
                        return None;
                    }
                    let last = m.thread.last().map_or(m.ts, |r| r.ts.max(m.ts));
                    let title = ext
                        .and_then(|e| e.title.clone())
                        .unwrap_or_else(|| m.text.chars().take(80).collect());
                    Some(ThreadView {
                        id: m.id.clone(),
                        by: m.by.clone(),
                        title,
                        replies: m.thread.len() as u32,
                        last_ts: last,
                        archived: s.thread_archived(&m.id, ch, last, self.ctx.now_ms),
                        tags: ext.map(|e| e.tags.clone()).unwrap_or_default(),
                    })
                })
                .collect();
            rows.sort_by(|a, b| b.last_ts.cmp(&a.last_ts).then_with(|| a.id.cmp(&b.id)));
            if !rows.is_empty() {
                out.insert(ch.clone(), rows);
            }
        }
        out
    }

    fn messaging_of(&self, s: &SpaceState) -> MessagingView {
        MessagingView {
            channels: self.channel_views(s),
            emoji: s
                .msgx
                .emoji
                .iter()
                .map(|e| EmojiView {
                    id: e.id.clone(),
                    name: e.name.clone(),
                    blob: e.blob.clone(),
                    by: e.by.clone(),
                })
                .collect(),
            stickers: s
                .msgx
                .stickers
                .iter()
                .map(|e| StickerView {
                    id: e.id.clone(),
                    pack: e.pack.clone(),
                    name: e.name.clone(),
                    blob: e.blob.clone(),
                    emoji: e.emoji.clone(),
                    by: e.by.clone(),
                })
                .collect(),
            nicks: s.msgx.nicks.clone(),
            profiles: s
                .msgx
                .profiles
                .iter()
                .map(|(u, p)| {
                    let live = p.status_until.is_none_or(|t| t > self.ctx.now_ms);
                    (
                        u.clone(),
                        ProfileExtView {
                            banner: p.banner.clone(),
                            status: if live {
                                p.status.clone()
                            } else {
                                String::new()
                            },
                            status_emoji: if live {
                                p.status_emoji.clone()
                            } else {
                                String::new()
                            },
                            pronouns: p.pronouns.clone(),
                        },
                    )
                })
                .collect(),
            threads: self.thread_views(s),
            automations: s
                .msgx
                .automations
                .iter()
                .map(|a| AutomationView {
                    id: a.id.clone(),
                    by: a.by.clone(),
                    name: a.name.clone(),
                    enabled: a.enabled,
                    trigger: a.trigger.clone(),
                    action: a.action.clone(),
                })
                .collect(),
        }
    }

    pub(super) fn messaging(&self) -> Messaging {
        let joined: Vec<String> = self.states.iter().map(|s| s.id.to_string()).collect();
        let mut spaces = BTreeMap::new();
        let mut requests: BTreeMap<String, DmRequestView> = BTreeMap::new();
        for s in self.states {
            spaces.insert(self.label(s), self.messaging_of(s));
            for inv in &s.msgx.dm_invites {
                if inv.to != self.me
                    || inv.by == self.me
                    || self.ctx.blocks.contains(&inv.by)
                    || joined.contains(&inv.space_id)
                {
                    continue;
                }
                let row = DmRequestView {
                    id: inv.id.clone(),
                    from: inv.by.clone(),
                    space_id: inv.space_id.clone(),
                    name: inv.name.clone(),
                    group: inv.group,
                    ts: inv.ts,
                    via: self.label(s),
                };
                if requests.get(&inv.space_id).is_none_or(|r| r.ts <= row.ts) {
                    requests.insert(inv.space_id.clone(), row);
                }
            }
        }
        let mut dm_requests: Vec<DmRequestView> = requests.into_values().collect();
        dm_requests.sort_by(|a, b| b.ts.cmp(&a.ts).then_with(|| a.id.cmp(&b.id)));
        Messaging {
            spaces,
            dm_requests,
        }
    }
}

// ---- paging, gallery, search -----------------------------------------------------------------

/// One page of a channel's history (`messages_page`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MessagePage {
    pub messages: Vec<Message>,
    pub has_more: bool,
    pub first_lp: u64,
    pub last_lp: u64,
}

/// One gallery entry (`media_gallery`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GalleryItem {
    pub msg_id: String,
    pub by: String,
    pub ts: i64,
    pub lp: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<crate::event::BlobRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Gallery {
    pub items: Vec<GalleryItem>,
    pub has_more: bool,
}

/// Filters of `messages_search`. Times are unix ms; `from` and `channel` match case-insensitively.
#[derive(Debug, Clone, Default)]
pub struct SearchFilters {
    pub q: String,
    pub from: Option<String>,
    pub channel: Option<String>,
    /// `file`, `image`, `video`, `link`, `voice` or `poll`.
    pub has: Option<String>,
    pub before_ms: Option<i64>,
    pub after_ms: Option<i64>,
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MsgHit {
    pub space_id: String,
    pub channel_id: String,
    pub id: String,
    pub by: String,
    pub ts: i64,
    pub lp: u64,
    pub text: String,
}

/// Longest page and gallery size.
pub const MAX_PAGE: usize = 200;

/// `http` and `https` URLs in `text`, trailing punctuation trimmed.
pub fn urls_in(text: &str) -> Vec<String> {
    text.split_whitespace()
        .filter(|w| w.starts_with("http://") || w.starts_with("https://"))
        .map(|w| w.trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']', '}', '\'', '"']))
        .filter(|w| w.len() > 8 && w.len() <= 2048)
        .map(str::to_string)
        .collect()
}

fn is_media(b: &crate::event::BlobRef) -> bool {
    b.mime.starts_with("image/") || b.mime.starts_with("video/")
}

impl<'a> World<'a> {
    fn page_of(
        &self,
        s: &SpaceState,
        channel: &str,
        before: Option<u64>,
        limit: usize,
    ) -> MessagePage {
        let limit = limit.clamp(1, MAX_PAGE);
        let all: Vec<&Msg> = s
            .msgs
            .get(channel)
            .map(|l| {
                l.iter()
                    .filter(|m| before.is_none_or(|b| m.ord.0 < b))
                    .collect()
            })
            .unwrap_or_default();
        let has_more = all.len() > limit;
        let slice = &all[all.len().saturating_sub(limit)..];
        let messages: Vec<Message> = slice
            .iter()
            .map(|m| self.message_in(s, channel, m))
            .collect();
        MessagePage {
            first_lp: slice.first().map_or(0, |m| m.ord.0),
            last_lp: slice.last().map_or(0, |m| m.ord.0),
            messages,
            has_more,
        }
    }

    fn gallery_of(
        &self,
        s: &SpaceState,
        channel: &str,
        kind: &str,
        before: Option<u64>,
        limit: usize,
    ) -> Gallery {
        let limit = limit.clamp(1, MAX_PAGE);
        let mut items: Vec<GalleryItem> = Vec::new();
        let list = s.msgs.get(channel).map(Vec::as_slice).unwrap_or_default();
        for m in list.iter().rev() {
            if m.removed.is_some() || before.is_some_and(|b| m.ord.0 >= b) {
                continue;
            }
            let ek = s.msgx.extras.get(&m.id).and_then(|x| x.ext.kind.as_deref());
            let base = |blob, url, title| GalleryItem {
                msg_id: m.id.clone(),
                by: m.by.clone(),
                ts: m.ts,
                lp: m.ord.0,
                blob,
                url,
                title,
            };
            match kind {
                "media" if !matches!(ek, Some("voice" | "sticker")) => {
                    items.extend(
                        m.att
                            .iter()
                            .filter(|b| is_media(b))
                            .map(|b| base(Some(b.clone()), None, Some(b.name.clone()))),
                    );
                }
                "files" if !matches!(ek, Some("voice" | "sticker" | "gif" | "video_note")) => {
                    items.extend(
                        m.att
                            .iter()
                            .filter(|b| !is_media(b) && !b.mime.starts_with("audio/"))
                            .map(|b| base(Some(b.clone()), None, Some(b.name.clone()))),
                    );
                }
                "voice" if matches!(ek, Some("voice")) => {
                    items.extend(m.att.iter().map(|b| base(Some(b.clone()), None, None)));
                }
                "links" => {
                    let mut urls = urls_in(&m.text);
                    if let Some((u, t, _)) = &m.preview
                        && !urls.contains(u)
                    {
                        urls.insert(0, u.clone());
                        items.push(base(None, Some(u.clone()), Some(t.clone())));
                        urls.remove(0);
                    }
                    items.extend(urls.into_iter().map(|u| base(None, Some(u), None)));
                }
                _ => {}
            }
        }
        let has_more = items.len() > limit;
        items.truncate(limit);
        Gallery { items, has_more }
    }

    fn name_of(&self, s: &SpaceState, user: &str) -> String {
        let nick = s.msgx.nicks.get(user);
        let n = nick
            .cloned()
            .or_else(|| self.people.get(user).map(|p| p.name.clone()))
            .unwrap_or_else(|| user.to_string());
        n.to_lowercase()
    }

    fn search_in(&self, s: &SpaceState, f: &SearchFilters, out: &mut Vec<MsgHit>) {
        let words: Vec<String> =
            f.q.to_lowercase()
                .split_whitespace()
                .map(str::to_string)
                .collect();
        let from = f.from.as_ref().map(|x| x.to_lowercase());
        let chan = f.channel.as_ref().map(|x| x.to_lowercase());
        for (ch, list) in &s.msgs {
            if let Some(c) = &chan {
                let name = s
                    .channels
                    .iter()
                    .find(|k| &k.id == ch)
                    .map(|k| k.name.to_lowercase())
                    .unwrap_or_default();
                if !name.contains(c.as_str()) && !ch.to_lowercase().contains(c.as_str()) {
                    continue;
                }
            }
            for m in list {
                if m.removed.is_some() || self.ctx.blocks.contains(&m.by) {
                    continue;
                }
                if f.before_ms.is_some_and(|b| m.ts >= b) || f.after_ms.is_some_and(|a| m.ts < a) {
                    continue;
                }
                if let Some(who) = &from
                    && m.by.to_lowercase() != *who
                    && !self.name_of(s, &m.by).contains(who.as_str())
                {
                    continue;
                }
                let ek = s.msgx.extras.get(&m.id).and_then(|x| x.ext.kind.as_deref());
                if let Some(h) = &f.has {
                    let ok = match h.as_str() {
                        "image" => m.att.iter().any(|b| b.mime.starts_with("image/")),
                        "video" => m.att.iter().any(|b| b.mime.starts_with("video/")),
                        "file" => !m.att.is_empty(),
                        "link" => !urls_in(&m.text).is_empty(),
                        "voice" => ek == Some("voice"),
                        "poll" => ek == Some("poll"),
                        _ => false,
                    };
                    if !ok {
                        continue;
                    }
                }
                let hay = m.text.to_lowercase();
                if !words.iter().all(|w| hay.contains(w.as_str())) {
                    continue;
                }
                out.push(MsgHit {
                    space_id: self.label(s),
                    channel_id: ch.clone(),
                    id: m.id.clone(),
                    by: m.by.clone(),
                    ts: m.ts,
                    lp: m.ord.0,
                    text: m.text.chars().take(280).collect(),
                });
            }
        }
    }
}

/// Newest `limit` messages of `channel` with lamport below `before`.
pub fn page(
    ctx: &ProjectionCtx,
    state: &SpaceState,
    channel: &str,
    before: Option<u64>,
    limit: usize,
) -> MessagePage {
    World::new(ctx, std::slice::from_ref(state)).page_of(state, channel, before, limit)
}

pub fn gallery(
    ctx: &ProjectionCtx,
    state: &SpaceState,
    channel: &str,
    kind: &str,
    before: Option<u64>,
    limit: usize,
) -> Gallery {
    World::new(ctx, std::slice::from_ref(state)).gallery_of(state, channel, kind, before, limit)
}

pub fn search(ctx: &ProjectionCtx, states: &[SpaceState], f: &SearchFilters) -> Vec<MsgHit> {
    let w = World::new(ctx, states);
    let mut out = Vec::new();
    for s in states {
        w.search_in(s, f, &mut out);
    }
    out.sort_by(|a, b| b.ts.cmp(&a.ts).then_with(|| a.id.cmp(&b.id)));
    out.truncate(f.limit.clamp(1, 200));
    out
}
