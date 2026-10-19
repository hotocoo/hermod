//! Renders folded space states into the UI shapes.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::shapes::*;
use super::state::{BoardSt, Msg, PostSt, SpaceState};
#[path = "render_messaging.rs"]
pub(super) mod render_messaging;
use super::time::{ago_long, ago_short, msg_time, snap_time};
use super::{ProjectionCtx, initials_of, known_users};
use crate::crypto::blake3_hash;
use crate::growth::{self, GrowthInput};
use crate::ids::SpaceId;

const ROOM_NAME: &str = "The Hearth";
const SHORT_MAX_SECS: u32 = 60;
const HOME_LABEL: &str = "home";

pub struct World<'a> {
    ctx: &'a ProjectionCtx,
    states: &'a [SpaceState],
    people: BTreeMap<String, Person>,
    labels: HashMap<SpaceId, String>,
    me: String,
}

fn within(ts: i64, now: i64, window: i64) -> bool {
    ts >= now.saturating_sub(window) && ts <= now.saturating_add(window)
}

fn derived(seed: &str, base: u32, span: u32) -> u32 {
    let h = blake3_hash(seed.as_bytes());
    base + u32::from(u16::from_le_bytes([h[0], h[1]])) % span
}

fn parse_dur(d: &str) -> u32 {
    d.split(':')
        .try_fold(0u32, |acc, p| p.parse::<u32>().ok().map(|n| acc * 60 + n))
        .unwrap_or(0)
}

fn file_kind(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "palette" | "swatch" => "swatch",
        "wav" | "mp3" | "flac" | "ogg" | "aiff" | "m4a" => "audio",
        "md" | "txt" | "doc" | "rtf" => "doc",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "psd" => "image",
        _ => "code",
    }
}

fn slug(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    s.split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

impl<'a> World<'a> {
    pub fn new(ctx: &'a ProjectionCtx, states: &'a [SpaceState]) -> Self {
        let labels = states
            .iter()
            .map(|s| {
                (
                    s.id,
                    if s.is_home {
                        HOME_LABEL.to_string()
                    } else {
                        s.id.to_string()
                    },
                )
            })
            .collect();
        let mut w = World {
            ctx,
            states,
            people: BTreeMap::new(),
            labels,
            me: ctx.me.to_string(),
        };
        w.people = w.build_people();
        w
    }

    fn label(&self, s: &SpaceState) -> String {
        self.labels[&s.id].clone()
    }

    fn t(&self, ts: i64) -> String {
        msg_time(ts, self.ctx.now_ms, self.ctx.tz_offset_secs)
    }

    fn first_name(&self, user: &str) -> String {
        self.people
            .get(user)
            .and_then(|p| p.name.split_whitespace().next())
            .unwrap_or(user)
            .to_string()
    }

    fn build_people(&self) -> BTreeMap<String, Person> {
        let mut best: BTreeMap<&str, (&SpaceState, (u64, String, u64))> = BTreeMap::new();
        for s in self.states {
            for (user, p) in &s.profiles {
                let key = (p.ord.0, s.id.to_string(), p.ord.1);
                if best.get(user.as_str()).is_none_or(|(_, k)| &key > k) {
                    best.insert(user, (s, key));
                }
            }
        }
        let mut out = BTreeMap::new();
        for user in known_users(self.ctx, self.states) {
            let handle: String = user.chars().take(8).collect();
            let person = match best
                .get(user.as_str())
                .and_then(|(s, _)| s.profiles.get(&user))
            {
                Some(p) => {
                    let name = if p.name.trim().is_empty() {
                        handle.clone()
                    } else {
                        p.name.clone()
                    };
                    let i = if p.initials.trim().is_empty() {
                        initials_of(&name)
                    } else {
                        p.initials.clone()
                    };
                    Person {
                        name,
                        i,
                        role: p.bio.clone(),
                        av: p.avatar.as_ref().map(|b| b.hash.clone()),
                    }
                }
                None => Person {
                    i: initials_of(&handle),
                    name: handle,
                    role: String::new(),
                    av: None,
                },
            };
            out.insert(user, person);
        }
        out.insert(
            "system".into(),
            Person {
                name: "Herm\u{f3}\u{f0}r".into(),
                i: "H".into(),
                role: String::new(),
                av: None,
            },
        );
        out
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            people: self.people.clone(),
            spaces: self.states.iter().map(|s| self.space(s)).collect(),
            collections: Collections {
                channels: self.channels(),
                messages: self.messages(),
                rooms: self.rooms(),
                agenda: self.agenda(),
                workboards: self.workboards(),
                skein: self.skein(),
                feed: self.feed(),
                media: self.media(),
                pinboards: self.pinboards(),
                docs: self.docs(),
                events: self.events(),
                letters: self.letters(),
                inbox: self.inbox(),
                desk: self.desk(),
                messaging: self.messaging(),
                arcade: self.arcade(),
            },
        }
    }

    fn arcade(&self) -> BTreeMap<String, super::arcade::ArcadeView> {
        self.states
            .iter()
            .filter(|s| !s.is_home)
            .filter_map(|s| Some((self.label(s), s.arcade.render(&self.me, &self.ctx.config)?)))
            .collect()
    }

    fn desk(&self) -> BTreeMap<String, super::desk::DeskView> {
        self.states
            .iter()
            .filter(|s| !s.is_home)
            .filter_map(|s| {
                let v = s.desk.render(&self.me, &s.roles, self.ctx.now_ms)?;
                Some((self.label(s), v))
            })
            .collect()
    }

    fn space(&self, s: &SpaceState) -> Space {
        let c = self.ctx;
        let mut joined: Vec<(String, u32)> = s
            .members
            .iter()
            .filter(|(_, m)| m.joined)
            .map(|(u, m)| (u.clone(), m.rank))
            .collect();
        joined.sort_by_key(|(_, r)| *r);
        let count_within = |window: i64| {
            joined
                .iter()
                .filter(|(u, _)| {
                    s.last_seen
                        .get(u)
                        .is_some_and(|&ts| within(ts, c.now_ms, window))
                })
                .count() as u32
        };
        let counts = growth::Counts {
            chat: s.counts.chat,
            hearth: s.counts.hearth,
            feed: s.counts.feed,
            board: s.counts.board,
            skein: s.counts.skein,
            arcade: s.arcade.content(),
            desk: s.desk.count(),
        };
        let mut growth = growth::compute(
            &c.growth,
            &GrowthInput {
                members: &joined,
                active: count_within(c.growth.active_window_ms),
                sections: &s.sections,
                counts,
            },
        );
        growth.waiting_games = s.arcade.waiting();
        let default = s.default_channel().map(str::to_string);
        Space {
            id: self.label(s),
            name: s.name.clone(),
            mono: s.mono.clone(),
            kind: s.kind.clone(),
            tagline: s.tagline.clone(),
            members: (!s.is_home).then_some(joined.len() as u32),
            online: (!s.is_home).then(|| count_within(c.config.online_window_ms)),
            sections: s.sections.clone(),
            map_style: s.map_style.clone(),
            default_channel: default.clone(),
            meeting_channel: default,
            growth,
            role: s.role_of(&self.me).map(|r| r.as_str().to_string()),
            removed: s.banned.contains(&self.me).then_some(true),
        }
    }

    /// Counts toward unread and the inbox: not removed, not mine, not blocked, not the system voice.
    fn unread_candidate(&self, m: &Msg) -> bool {
        m.removed.is_none()
            && m.by != self.me
            && m.by != "system"
            && !self.ctx.blocks.contains(&m.by)
    }

    fn marker(&self, s: &SpaceState, ch: &str) -> u64 {
        self.ctx
            .read_markers
            .get(&(s.id, ch.to_string()))
            .copied()
            .unwrap_or(0)
    }

    fn channels(&self) -> BTreeMap<String, Vec<Channel>> {
        self.states
            .iter()
            .map(|s| {
                let list = s
                    .channels
                    .iter()
                    .map(|ch| {
                        let marker = self.marker(s, &ch.id);
                        let unread = s
                            .msgs
                            .get(&ch.id)
                            .map(|l| {
                                l.iter()
                                    .filter(|m| self.unread_candidate(m) && m.arrival > marker)
                                    .count() as u32
                            })
                            .unwrap_or(0);
                        let name = match (&ch.dm, ch.name.is_empty()) {
                            (Some(u), true) => self
                                .people
                                .get(u)
                                .map(|p| p.name.clone())
                                .unwrap_or_else(|| u.clone()),
                            _ => ch.name.clone(),
                        };
                        Channel {
                            id: ch.id.clone(),
                            name,
                            dm: ch.dm.clone(),
                            topic: ch.topic.clone(),
                            unread: (unread > 0).then_some(unread),
                        }
                    })
                    .collect();
                (self.label(s), list)
            })
            .collect()
    }

    fn message(&self, s: &SpaceState, m: &Msg) -> Message {
        let rx: Vec<Reaction> =
            m.rx.iter()
                .filter(|(_, set)| !set.is_empty())
                .map(|(l, set)| Reaction {
                    l: l.clone(),
                    n: set.len() as u32,
                    mine: set.contains(&self.me).then_some(true),
                })
                .collect();
        let thread: Vec<Reply> = m
            .thread
            .iter()
            .map(|r| Reply {
                by: r.by.clone(),
                t: self.t(r.ts),
                text: r.text.clone(),
            })
            .collect();
        let snap = m
            .snap
            .as_ref()
            .and_then(|id| s.snaps.iter().find(|x| &x.id == id))
            .map(|x| SnapRef {
                id: x.id.clone(),
                title: x.title.clone(),
                line: x.line.clone(),
                files: x.files.len() as u32,
            });
        Message {
            id: m.id.clone(),
            by: m.by.clone(),
            t: self.t(m.ts),
            text: if m.removed.is_some() {
                String::new()
            } else {
                m.text.clone()
            },
            rx: (!rx.is_empty()).then_some(rx),
            thread: (!thread.is_empty()).then_some(thread),
            img: if m.removed.is_some() {
                None
            } else {
                m.img.clone()
            },
            att: (m.removed.is_none() && !m.att.is_empty()).then(|| m.att.clone()),
            snap,
            meet: m.meet.clone(),
            fresh: None,
            removed: m.removed.map(str::to_string),
            edited: (!m.history.is_empty()).then_some(true),
            history: (!m.history.is_empty()).then(|| {
                m.history
                    .iter()
                    .map(|(ts, text)| EditRev {
                        t: self.t(*ts),
                        text: text.clone(),
                    })
                    .collect()
            }),
            pinned: m.pinned.then_some(true),
            mentions: (!m.mentions.is_empty()).then(|| m.mentions.clone()),
            preview: m.preview.as_ref().map(|(url, title, image)| Preview {
                url: url.clone(),
                title: title.clone(),
                image: image.clone(),
            }),
            blocked: self.ctx.blocks.contains(&m.by).then_some(true),
            ext: None,
        }
    }

    fn messages(&self) -> BTreeMap<String, Vec<Message>> {
        let mut out = BTreeMap::new();
        for s in self.states {
            let label = self.label(s);
            let keys: BTreeSet<&String> = s
                .channels
                .iter()
                .map(|c| &c.id)
                .chain(s.msgs.keys())
                .collect();
            for ch in keys {
                let list = s
                    .msgs
                    .get(ch)
                    .map(|l| l.iter().map(|m| self.message_in(s, ch, m)).collect())
                    .unwrap_or_default();
                out.insert(format!("{label}/{ch}"), list);
            }
        }
        out
    }

    fn rooms(&self) -> BTreeMap<String, Room> {
        let c = self.ctx;
        self.states
            .iter()
            .filter(|s| s.sections.iter().any(|x| x == "hearth") || !s.room.is_empty())
            .map(|s| {
                let mut present: Vec<(&String, &(bool, i64))> = s
                    .room
                    .iter()
                    .filter(|(_, (_, ts))| within(*ts, c.now_ms, c.config.room_stale_ms))
                    .collect();
                present.sort_by(|a, b| (a.1.1, a.0).cmp(&(b.1.1, b.0)));
                let active = s.meetings.iter().rev().find(|m| m.ended.is_none());
                let topic = active.map(|m| m.topic.clone()).unwrap_or_default();
                let flag = |pick: fn(&(bool, bool)) -> bool| -> BTreeMap<String, bool> {
                    present
                        .iter()
                        .filter_map(|(u, _)| s.room_flags.get(*u).map(|f| ((*u).clone(), pick(f))))
                        .collect()
                };
                let main = |u: &String| s.room_id.get(u).is_none_or(String::is_empty);
                let mut channels: BTreeMap<String, Vec<String>> = BTreeMap::new();
                for (u, _) in &present {
                    if let Some(r) = s.room_id.get(*u).filter(|r| !r.is_empty()) {
                        channels.entry(r.clone()).or_default().push((*u).clone());
                    }
                }
                let muted = flag(|f| f.0);
                let share = flag(|f| f.1);
                let meeting = active.map(|m| RoomMeeting {
                    topic: m.topic.clone(),
                    at: self.t(m.start_ts),
                    notes: m
                        .note_list
                        .iter()
                        .map(|(by, ts, text)| RoomNote {
                            by: by.clone(),
                            t: self.t(*ts),
                            text: text.clone(),
                        })
                        .collect(),
                });
                let room = Room {
                    name: ROOM_NAME.into(),
                    in_room: present
                        .iter()
                        .filter(|(u, _)| main(u))
                        .map(|(u, _)| (*u).clone())
                        .collect(),
                    cams: present
                        .iter()
                        .map(|(u, (cam, _))| ((*u).clone(), *cam))
                        .collect(),
                    extra: None,
                    channels,
                    topic,
                    muted,
                    share,
                    meeting,
                };
                (self.label(s), room)
            })
            .collect()
    }

    fn agenda(&self) -> Vec<AgendaItem> {
        let active = self
            .states
            .iter()
            .filter_map(|s| {
                s.meetings
                    .iter()
                    .rev()
                    .find(|m| m.ended.is_none())
                    .map(|m| (m.start_ts, self.label(s), m))
            })
            .max_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
        let Some((_, _, meeting)) = active else {
            return Vec::new();
        };
        let cur = meeting.agenda.iter().position(|a| !a.done);
        meeting
            .agenda
            .iter()
            .enumerate()
            .map(|(i, a)| AgendaItem {
                text: a.text.clone(),
                who: a.who.clone(),
                done: a.done,
                cur: Some(i) == cur,
            })
            .collect()
    }

    fn workboards(&self) -> BTreeMap<String, WorkBoard> {
        let render = |b: &BoardSt| WorkBoard {
            id: Some(b.id.clone()),
            name: b.name.clone(),
            due: b.due.clone(),
            cols: b
                .cols
                .iter()
                .map(|c| Column {
                    id: c.id.clone(),
                    name: c.name.clone(),
                    cards: c
                        .cards
                        .iter()
                        .map(|k| Card {
                            id: k.id.clone(),
                            title: k.title.clone(),
                            tag: k.tag.clone(),
                            by: k.by.clone(),
                            snap: k.snap.clone(),
                            fresh: None,
                        })
                        .collect(),
                })
                .collect(),
        };
        self.states
            .iter()
            .filter(|s| s.sections.iter().any(|x| x == "board") || !s.boards.is_empty())
            .map(|s| {
                let board = s.boards.first().map(render).unwrap_or(WorkBoard {
                    id: None,
                    name: "Board".into(),
                    due: String::new(),
                    cols: Vec::new(),
                });
                (self.label(s), board)
            })
            .collect()
    }

    fn skein(&self) -> BTreeMap<String, Skein> {
        self.states
            .iter()
            .filter(|s| {
                s.sections.iter().any(|x| x == "skein")
                    || !s.lines.is_empty()
                    || !s.snaps.is_empty()
            })
            .map(|s| (self.label(s), self.skein_of(s)))
            .collect()
    }

    fn skein_of(&self, s: &SpaceState) -> Skein {
        let mut lines = vec![SkeinLine {
            id: "main".into(),
            name: "main".into(),
            note: "What ships".into(),
            ahead: 0,
            by: None,
        }];
        for l in &s.lines {
            if l.id == "main" {
                lines[0].note = l.note.clone();
                continue;
            }
            let on_line = s
                .snaps
                .iter()
                .filter(|x| x.line == l.id && x.weave_of.is_none())
                .count();
            let ahead = on_line.saturating_sub(s.woven.get(&l.id).copied().unwrap_or(0)) as u32;
            lines.push(SkeinLine {
                id: l.id.clone(),
                name: l.name.clone(),
                note: l.note.clone(),
                ahead,
                by: l.by.clone(),
            });
        }
        let mut last_on_line: HashMap<&str, &str> = HashMap::new();
        let mut seals: HashMap<&str, &str> = HashMap::new();
        let mut parents: HashMap<&str, String> = HashMap::new();
        for x in &s.snaps {
            seals.insert(&x.id, &x.seal);
            let by_id = x.parent.as_deref().and_then(|p| seals.get(p).copied());
            let parent = by_id.or_else(|| last_on_line.get(x.line.as_str()).copied());
            parents.insert(
                &x.id,
                parent
                    .map(|p| p.chars().take(8).collect())
                    .unwrap_or_default(),
            );
            last_on_line.insert(&x.line, &x.seal);
        }
        let channel_name = |id: &str| {
            s.channels
                .iter()
                .find(|c| c.id == id)
                .map(|c| c.name.clone())
                .unwrap_or_else(|| id.to_string())
        };
        let linked = |snap_id: &str| {
            let msg = s
                .msgs
                .iter()
                .flat_map(|(ch, l)| l.iter().map(move |m| (ch, m)))
                .filter(|(_, m)| m.snap.as_deref() == Some(snap_id))
                .min_by_key(|(_, m)| m.ord);
            if let Some((ch, _)) = msg {
                return Linked {
                    label: format!("#{}", channel_name(ch)),
                    ch: Some(ch.clone()),
                };
            }
            let card = s
                .boards
                .iter()
                .flat_map(|b| b.cols.iter().map(move |c| (b, c)))
                .find(|(_, c)| c.cards.iter().any(|k| k.snap.as_deref() == Some(snap_id)));
            match card {
                Some((b, c)) => Linked {
                    label: format!("{} \u{b7} {}", b.name, c.name),
                    ch: None,
                },
                None => Linked {
                    label: String::new(),
                    ch: None,
                },
            }
        };
        let snaps = s
            .snaps
            .iter()
            .rev()
            .map(|x| Snap {
                id: x.id.clone(),
                line: x.line.clone(),
                title: x.title.clone(),
                by: x.by.clone(),
                when: snap_time(x.ts, self.ctx.now_ms, self.ctx.tz_offset_secs),
                kind: x.kind.clone(),
                seal: x.seal.clone(),
                parent: parents.get(x.id.as_str()).cloned().unwrap_or_default(),
                linked: linked(&x.id),
                files: x
                    .files
                    .iter()
                    .map(|f| SkeinFile {
                        blob: f.blob.clone(),
                        path: f.path.clone(),
                        kind: file_kind(&f.path).into(),
                        adds: f.adds,
                        dels: f.dels,
                        swatches: None,
                        audio: None,
                        lines: None,
                    })
                    .collect(),
                weave_of: x.weave_of.clone(),
            })
            .collect();
        Skein {
            repo: slug(&s.name),
            blurb: s.tagline.clone(),
            lines,
            snaps,
        }
    }

    fn post(&self, s: &SpaceState, p: &PostSt) -> Post {
        Post {
            id: p.id.clone(),
            by: p.by.clone(),
            space: s.name.clone(),
            title: p.title.clone(),
            kind: p.kind.clone(),
            h: if p.kind == "note" {
                0
            } else {
                derived(&p.id, 200, 160)
            },
            label: p.label.clone(),
            likes: s.likes.get(&p.id).map_or(0, |l| l.len() as u32),
            text: p.text.clone(),
            dur: p.dur.clone(),
            comments: (!p.comments.is_empty()).then(|| {
                p.comments
                    .iter()
                    .map(|c| Reply {
                        by: c.by.clone(),
                        t: self.t(c.ts),
                        text: c.text.clone(),
                    })
                    .collect()
            }),
            blob: p.blobs.first().cloned(),
            liked: s
                .likes
                .get(&p.id)
                .is_some_and(|l| l.contains(&self.me))
                .then_some(true),
            saved: s
                .saves
                .get(&p.id)
                .is_some_and(|l| l.contains(&self.me))
                .then_some(true),
            space_id: Some(self.label(s)),
        }
    }

    /// Posts that are neither removed nor from a blocked author.
    fn live_posts<'s>(&self, s: &'s SpaceState) -> impl Iterator<Item = &'s PostSt> + use<'s, 'a> {
        let blocks = &self.ctx.blocks;
        s.posts
            .iter()
            .filter(move |p| !p.removed && !blocks.contains(&p.by))
    }

    /// Home feed follow filter: with no follows everything shows, otherwise followed people,
    /// followed spaces and your own posts.
    fn followed(&self, s: &SpaceState, p: &PostSt) -> bool {
        let f = &self.ctx.follows;
        f.is_empty()
            || p.by == self.me
            || f.contains(&("user".to_string(), p.by.clone()))
            || f.contains(&("space".to_string(), self.label(s)))
    }

    fn feed(&self) -> BTreeMap<String, Vec<Post>> {
        let mut out = BTreeMap::new();
        let mut all: Vec<(&PostSt, Post)> = Vec::new();
        for s in self.states {
            let mut posts: Vec<&PostSt> = self.live_posts(s).collect();
            posts.sort_by_key(|p| std::cmp::Reverse(p.ord));
            let rendered: Vec<Post> = posts.iter().map(|p| self.post(s, p)).collect();
            all.extend(
                posts
                    .iter()
                    .copied()
                    .zip(rendered.iter().cloned())
                    .filter(|(p, _)| self.followed(s, p)),
            );
            out.insert(self.label(s), rendered);
        }
        if self.labels.values().any(|l| l == HOME_LABEL) {
            all.sort_by(|a, b| (b.0.ts, &b.0.id).cmp(&(a.0.ts, &a.0.id)));
            out.insert(
                HOME_LABEL.into(),
                all.into_iter()
                    .take(self.ctx.config.home_feed_max)
                    .map(|(_, p)| p)
                    .collect(),
            );
        }
        out
    }

    fn media(&self) -> Media {
        let now = self.ctx.now_ms;
        let mut videos = Vec::new();
        let mut shorts = Vec::new();
        let mut posts: Vec<(&SpaceState, &PostSt)> = self
            .states
            .iter()
            .flat_map(|s| self.live_posts(s).map(move |p| (s, p)))
            .filter(|(_, p)| p.kind == "video")
            .collect();
        posts.sort_by(|a, b| (b.1.ts, &b.1.id).cmp(&(a.1.ts, &a.1.id)));
        for (s, p) in posts {
            let len = p.dur.as_deref().map_or(0, parse_dur);
            // A short is also a video: the player opens it by id; the Shorts row is just a highlight.
            if (1..SHORT_MAX_SECS).contains(&len) {
                shorts.push(Short {
                    id: p.id.clone(),
                    title: p.title.clone(),
                    views: "0".into(),
                    label: p.label.clone(),
                    blob: p.blobs.first().cloned(),
                    space_id: Some(self.label(s)),
                });
            }
            {
                videos.push(Video {
                    id: p.id.clone(),
                    title: p.title.clone(),
                    by: p.by.clone(),
                    len,
                    views: "0".into(),
                    when: ago_long(p.ts, now),
                    likes: s.likes.get(&p.id).map_or(0, |l| l.len() as u32),
                    label: p.label.clone(),
                    desc: p.text.clone().unwrap_or_default(),
                    chapters: p.chapters.clone(),
                    captions_blob: p.captions.clone(),
                    blob: p.blobs.first().cloned(),
                    liked: s
                        .likes
                        .get(&p.id)
                        .is_some_and(|l| l.contains(&self.me))
                        .then_some(true),
                    space_id: Some(self.label(s)),
                });
            }
        }
        Media {
            videos,
            captions: Vec::new(),
            shorts,
            live: self.live(),
            stories: self.stories(),
        }
    }

    fn live(&self) -> Live {
        let latest = self
            .states
            .iter()
            .flat_map(|s| s.lives.iter().map(move |l| (s, l)))
            .filter(|(_, l)| !l.ended)
            .max_by(|a, b| (a.1.ts, &a.1.id).cmp(&(b.1.ts, &b.1.id)));
        let Some((live_space, l)) = latest else {
            return Live {
                id: None,
                space_id: None,
                title: String::new(),
                host: String::new(),
                viewers: 0,
                chat: Vec::new(),
                pool: Vec::new(),
            };
        };
        let mut people: BTreeSet<&String> = l.chat.iter().map(|(u, _)| u).collect();
        people.insert(&l.host);
        let skip = l.chat.len().saturating_sub(self.ctx.config.live_chat_max);
        Live {
            id: Some(l.id.clone()),
            space_id: Some(self.label(live_space)),
            title: l.title.clone(),
            host: l.host.clone(),
            viewers: people.len() as u32,
            chat: l
                .chat
                .iter()
                .skip(skip)
                .map(|(by, text)| LiveChatLine {
                    by: by.clone(),
                    text: text.clone(),
                })
                .collect(),
            pool: Vec::new(),
        }
    }

    fn stories(&self) -> Vec<Story> {
        struct Acc {
            ts: i64,
            id: String,
            space: String,
            items: Vec<StoryItem>,
            loves: u32,
            replies: u32,
        }
        let now = self.ctx.now_ms;
        let mut by_author: BTreeMap<&String, Acc> = BTreeMap::new();
        let mut live: Vec<_> = self
            .states
            .iter()
            .flat_map(|s| s.stories.iter().map(move |st| (s, st)))
            .filter(|(_, st)| {
                st.ts.saturating_add(st.ttl_ms) > now && !self.ctx.blocks.contains(&st.by)
            })
            .collect();
        live.sort_by_key(|(_, st)| st.ts);
        for (s, st) in live {
            let e = by_author.entry(&st.by).or_insert_with(|| Acc {
                ts: st.ts,
                id: st.id.clone(),
                space: self.label(s),
                items: Vec::new(),
                loves: 0,
                replies: 0,
            });
            if st.ts >= e.ts {
                e.ts = st.ts;
                e.id = st.id.clone();
                e.space = self.label(s);
            }
            e.loves += st.loves.len() as u32;
            e.replies += st.replies;
            e.items.extend(
                st.items
                    .iter()
                    .enumerate()
                    .map(|(i, (label, caption))| StoryItem {
                        label: label.clone(),
                        caption: caption.clone(),
                        blob: st.item_blobs.get(i).cloned(),
                        story_id: Some(st.id.clone()),
                    }),
            );
        }
        let mut out: Vec<(i64, Story)> = by_author
            .into_iter()
            .map(|(by, a)| {
                (
                    a.ts,
                    Story {
                        id: Some(a.id),
                        space_id: Some(a.space),
                        by: by.clone(),
                        when: ago_short(a.ts, now),
                        items: a.items,
                        loves: (a.loves > 0).then_some(a.loves),
                        replies: (a.replies > 0).then_some(a.replies),
                    },
                )
            })
            .collect();
        out.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.by.cmp(&b.1.by)));
        out.into_iter().map(|(_, s)| s).collect()
    }

    fn pinboards(&self) -> Vec<PinBoard> {
        let mut out = Vec::new();
        for s in self.states {
            for p in &s.pinboards {
                let mut people: Vec<&String> = vec![&p.by];
                for pin in &p.pins {
                    if !people.contains(&&pin.by) {
                        people.push(&pin.by);
                    }
                }
                let who = if people.len() == 1 && *people[0] == self.me {
                    "Just you".to_string()
                } else {
                    let first = if *people[0] == self.me {
                        "You".to_string()
                    } else {
                        self.first_name(people[0])
                    };
                    match people.len() - 1 {
                        0 => first,
                        1 => format!("{first} and 1 other"),
                        n => format!("{first} and {n} others"),
                    }
                };
                let pins = p
                    .pins
                    .iter()
                    .map(|x| Pin {
                        blob: Some(x.blob.clone()),
                        h: derived(&x.seed, 140, 120),
                        label: x.label.clone(),
                        title: x.title.clone(),
                    })
                    .collect();
                out.push(PinBoard {
                    space_id: Some(self.label(s)),
                    id: p.id.clone(),
                    name: p.name.clone(),
                    who,
                    pins,
                });
            }
        }
        let mut saved: Vec<(i64, Pin)> = Vec::new();
        for s in self.states {
            for p in self.live_posts(s) {
                if s.saves.get(&p.id).is_some_and(|set| set.contains(&self.me)) {
                    saved.push((
                        p.ts,
                        Pin {
                            blob: p.blobs.first().cloned(),
                            h: derived(&p.id, 140, 120),
                            label: p.label.clone(),
                            title: p.title.clone(),
                        },
                    ));
                }
            }
        }
        saved.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.title.cmp(&b.1.title)));
        out.push(PinBoard {
            space_id: None,
            id: "saved".into(),
            name: "Saved".into(),
            who: "Just you".into(),
            pins: saved.into_iter().map(|(_, p)| p).collect(),
        });
        out
    }

    fn docs(&self) -> Vec<Doc> {
        let now = self.ctx.now_ms;
        let tz = self.ctx.tz_offset_secs;
        let mut docs: Vec<(&super::state::DocSt, Doc)> = Vec::new();
        for s in self.states {
            for d in &s.docs {
                let versions = d
                    .versions
                    .iter()
                    .rev()
                    .take(self.ctx.config.versions_max)
                    .map(|(ts, id)| DocVersion {
                        t: snap_time(*ts, now, tz),
                        seal: id.chars().take(7).collect(),
                    })
                    .collect();
                docs.push((
                    d,
                    Doc {
                        space_id: Some(self.label(s)),
                        id: d.id.clone(),
                        title: d.title.clone(),
                        kicker: d.kicker.clone(),
                        edited: format!(
                            "{} by {}",
                            ago_long(d.last_edit.0, now),
                            self.first_name(&d.last_edit.1)
                        ),
                        people: d.editors.clone(),
                        blocks: d
                            .blocks
                            .iter()
                            .map(|b| DocBlock {
                                id: Some(b.id.clone()),
                                k: b.k.clone(),
                                text: b.text.clone(),
                                done: (b.k == "t").then_some(b.done),
                            })
                            .collect(),
                        comments: d
                            .comments
                            .iter()
                            .map(|c| DocComment {
                                by: c.by.clone(),
                                on: c.on.clone(),
                                text: c.text.clone(),
                            })
                            .collect(),
                        versions,
                    },
                ));
            }
        }
        docs.sort_by(|a, b| {
            b.0.last_edit
                .0
                .cmp(&a.0.last_edit.0)
                .then_with(|| a.0.id.cmp(&b.0.id))
        });
        docs.into_iter().map(|(_, d)| d).collect()
    }

    fn events(&self) -> Vec<CalEvent> {
        let mut evs: Vec<CalEvent> = self
            .states
            .iter()
            .flat_map(|s| s.cal.iter().map(move |c| (s, c)))
            .map(|(s, c)| CalEvent {
                space_id: Some(self.label(s)),
                going: c.people.contains(&self.me).then_some(true),
                id: c.id.clone(),
                d: c.d,
                s: c.s,
                e: c.e,
                t: c.title.clone(),
                place: c.place.clone(),
                meeting: c.meeting.then_some(true),
                note: c.note.clone(),
                people: c.people.clone(),
                fresh: None,
            })
            .collect();
        evs.sort_by(|a, b| {
            a.d.cmp(&b.d)
                .then(a.s.total_cmp(&b.s))
                .then_with(|| a.id.cmp(&b.id))
        });
        evs
    }

    fn letters(&self) -> BTreeMap<String, Vec<Letter>> {
        let mut by_target: BTreeMap<String, Vec<(i64, &str, Letter)>> = BTreeMap::new();
        for s in self.states {
            for l in &s.letters {
                let target =
                    l.to.parse::<SpaceId>()
                        .ok()
                        .and_then(|id| self.labels.get(&id));
                if let Some(label) = target {
                    by_target.entry(label.clone()).or_default().push((
                        l.ts,
                        &l.id,
                        Letter {
                            by: l.by.clone(),
                            ch: l.ch.clone(),
                            text: l.text.clone(),
                        },
                    ));
                }
            }
        }
        by_target
            .into_iter()
            .map(|(k, mut v)| {
                v.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
                (k, v.into_iter().map(|(_, _, l)| l).collect())
            })
            .collect()
    }

    fn inbox(&self) -> Vec<RookEntry> {
        let mut latest: Vec<(i64, &str, RookEntry)> = Vec::new();
        for s in self.states {
            for (ch, list) in &s.msgs {
                let last = list.iter().rev().find(|m| self.unread_candidate(m));
                if let Some(m) = last {
                    latest.push((
                        m.ts,
                        &m.id,
                        RookEntry {
                            by: m.by.clone(),
                            sp: self.label(s),
                            ch: ch.clone(),
                            text: m.text.clone(),
                            t: self.t(m.ts),
                            read: self.marker(s, ch) >= m.arrival,
                            fresh: None,
                        },
                    ));
                }
            }
        }
        latest.sort_by(|a, b| (b.0, b.1).cmp(&(a.0, a.1)));
        latest
            .into_iter()
            .take(self.ctx.config.inbox_max)
            .map(|(_, _, e)| e)
            .collect()
    }
}
