//! Deterministic fold of one space's events (already sorted by `(lamport, author, seq)`).
//!
//! Authorization lives here: before an event touches any state it must pass `authorize`. Events
//! from non-members, banned users or insufficient roles are ignored, identically on every peer,
//! because the role state is itself folded in the same total order.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use super::arcade::ArcadeState;
use super::desk::DeskState;
use super::messaging::MsgState;
use super::shapes::MeetSummary;
use crate::crypto::blake3_hash;
use crate::event::{BlobRef, DocBlockIn, DocOp, EventBody, Role, valid_map_style};
use crate::ids::{SpaceId, hex_decode_array, hex_encode};
use crate::store::Opened;

/// Fold order key: `(lamport, author bytes, seq)`.
pub type Ord3 = (u64, [u8; 32], u64);

/// Upper bound on fold passes while [`Prior`] settles; it normally does after one or two.
pub const MAX_FOLD_PASSES: usize = 4;

// Calendar grid an event must sit in; mirrors CALENDAR in src/config/app.ts (Mon..Fri, 08:00 to 18:00).
const EVENT_DAYS: u32 = 5;
const EVENT_FIRST_HOUR: f64 = 8.0;
const EVENT_LAST_HOUR: f64 = 18.0;

/// A slot the calendar can draw: a real day, and a non-empty span inside the grid hours.
fn slot_ok(day: u32, start: f64, end: f64) -> bool {
    day < EVENT_DAYS && start >= EVENT_FIRST_HOUR && end <= EVENT_LAST_HOUR && end > start
}

/// `YYYY-MM-DD` naming a real calendar day (chrono alone also accepts `2030-1-2`).
fn real_date(d: &str) -> bool {
    d.len() == 10 && chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok()
}

/// Facts one fold pass derives from authorized events that the next pass applies independent of
/// fold position, so an author-chosen lamport cannot place an event before the fact that kills it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Prior {
    /// Removed user to the highest `seq` they may have authored.
    pub caps: BTreeMap<String, u64>,
    /// Revoked invite id to the users that may have joined through it.
    pub revoked: BTreeMap<String, BTreeSet<String>>,
}

/// Author of the `space.create` whose nonce derives `id`, if any.
pub fn derived_author<'a>(
    id: &SpaceId,
    events: impl IntoIterator<Item = &'a Opened>,
) -> Option<String> {
    events.into_iter().find_map(|e| match &e.body {
        EventBody::SpaceCreate { nonce: Some(n), .. }
            if hex_decode_array::<32>(n).is_ok_and(|n| SpaceId::derive(&e.author, &n) == *id) =>
        {
            Some(e.author.to_string())
        }
        _ => None,
    })
}

pub struct Chan {
    pub id: String,
    pub name: String,
    pub topic: String,
    pub dm: Option<String>,
    pub guest: bool,
}

pub struct ReplySt {
    pub by: String,
    pub ts: i64,
    pub text: String,
}

pub struct Msg {
    pub id: String,
    pub by: String,
    pub ts: i64,
    pub ord: Ord3,
    /// Device-local apply order of the message event, compared with read markers.
    pub arrival: u64,
    pub text: String,
    pub rx: Vec<(String, BTreeSet<String>)>,
    pub thread: Vec<ReplySt>,
    pub img: Option<String>,
    pub att: Vec<BlobRef>,
    pub snap: Option<String>,
    pub meet: Option<MeetSummary>,
    /// `author` or `admin` once removed: the message stays as a tombstone.
    pub removed: Option<&'static str>,
    /// Prior texts, oldest first, with the time each was replaced.
    pub history: Vec<(i64, String)>,
    pub pinned: bool,
    pub mentions: Vec<String>,
    pub preview: Option<(String, String, Option<String>)>,
}

pub struct Member {
    pub rank: u32,
    pub joined: bool,
}

pub struct ProfileSt {
    pub name: String,
    pub bio: String,
    pub initials: String,
    pub avatar: Option<BlobRef>,
    pub ord: (u64, u64),
}

pub struct PostSt {
    pub id: String,
    pub by: String,
    pub ts: i64,
    pub ord: Ord3,
    pub kind: String,
    pub title: String,
    pub text: Option<String>,
    pub label: String,
    pub dur: Option<String>,
    pub chapters: Vec<(u32, String)>,
    pub captions: Option<String>,
    pub blobs: Vec<BlobRef>,
    pub comments: Vec<ReplySt>,
    pub removed: bool,
}

pub struct StorySt {
    pub id: String,
    pub by: String,
    pub ts: i64,
    pub ttl_ms: i64,
    pub items: Vec<(String, String)>,
    pub item_blobs: Vec<BlobRef>,
    pub loves: BTreeSet<String>,
    pub replies: u32,
}

pub struct LiveSt {
    pub id: String,
    pub title: String,
    pub host: String,
    pub ts: i64,
    pub ended: bool,
    pub chat: Vec<(String, String)>,
}

pub struct AgendaSt {
    pub text: String,
    pub who: String,
    pub done: bool,
}

pub struct MeetingSt {
    pub topic: String,
    pub start_ts: i64,
    pub agenda: Vec<AgendaSt>,
    pub notes: u32,
    pub note_list: Vec<(String, i64, String)>,
    pub ended: Option<(i64, Ord3, String)>,
}

pub struct CardSt {
    pub id: String,
    pub title: String,
    pub tag: String,
    pub by: String,
    pub snap: Option<String>,
    pub assignee: Option<String>,
    pub due: Option<String>,
    pub ts: i64,
}

pub struct ColSt {
    pub id: String,
    pub name: String,
    pub cards: Vec<CardSt>,
}

pub struct BoardSt {
    pub id: String,
    pub name: String,
    pub due: String,
    pub cols: Vec<ColSt>,
}

pub struct PinSt {
    pub blob: BlobRef,
    pub label: String,
    pub title: String,
    pub seed: String,
    pub by: String,
}

pub struct PinboardSt {
    pub id: String,
    pub name: String,
    pub by: String,
    pub pins: Vec<PinSt>,
}

pub struct BlockSt {
    pub id: String,
    pub k: String,
    pub text: String,
    pub done: bool,
}

pub struct DocCommentSt {
    pub by: String,
    pub on: String,
    pub text: String,
}

pub struct DocSt {
    pub id: String,
    pub title: String,
    pub kicker: String,
    pub blocks: Vec<BlockSt>,
    pub editors: Vec<String>,
    pub last_edit: (i64, String),
    pub versions: Vec<(i64, String)>,
    pub comments: Vec<DocCommentSt>,
}

pub struct CalSt {
    pub id: String,
    pub by: String,
    pub d: u32,
    pub s: f64,
    pub e: f64,
    pub title: String,
    pub place: String,
    pub note: String,
    pub meeting: bool,
    pub people: Vec<String>,
}

pub struct LineSt {
    pub id: String,
    pub name: String,
    pub note: String,
    pub by: Option<String>,
}

pub struct SnapFileSt {
    pub blob: Option<BlobRef>,
    pub path: String,
    pub adds: u32,
    pub dels: u32,
}

pub struct SnapSt {
    pub id: String,
    pub line: String,
    pub title: String,
    pub by: String,
    pub ts: i64,
    pub kind: String,
    /// BLAKE3 over the snap's files (path, blob, adds, dels), hex, 20 chars.
    pub seal: String,
    pub parent: Option<String>,
    pub files: Vec<SnapFileSt>,
    pub weave_of: Option<String>,
}

pub struct LetterSt {
    pub id: String,
    pub to: String,
    pub by: String,
    pub ch: String,
    pub text: String,
    pub ts: i64,
}

pub struct InviteSt {
    pub id: String,
    pub by: String,
    pub ts: i64,
    pub role: Role,
    pub exp: Option<u64>,
    pub max_uses: Option<u32>,
    /// Space `join_pow_bits` at this invite's fold position: the work a join through it needs,
    /// fixed at creation so a later change never strands an existing invite.
    pub pow_bits: u8,
    pub uses: BTreeSet<String>,
    pub revoked: bool,
}

pub struct ReportSt {
    pub id: String,
    pub by: String,
    pub target: String,
    pub reason: String,
    pub ts: i64,
}

/// One admin-visible governance record.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AuditEntry {
    pub ts: i64,
    pub by: String,
    pub kind: String,
    pub target: Option<String>,
    pub detail: String,
    pub event_id: String,
}

#[derive(Default)]
pub struct Counts {
    pub chat: u32,
    pub hearth: u32,
    pub feed: u32,
    pub board: u32,
    pub skein: u32,
}

pub struct SpaceState {
    pub id: SpaceId,
    pub is_home: bool,
    pub name: String,
    pub kind: String,
    pub tagline: String,
    pub mono: String,
    pub sections: Vec<String>,
    pub map_style: Option<String>,
    /// Proof-of-work bits a join must carry (0 = off).
    pub join_pow_bits: u8,
    created: bool,
    /// The only author whose `space.create` counts; `None` means the first in fold order.
    creator: Option<String>,
    prior: Prior,
    /// What this pass derived; the next pass takes it as `prior`.
    pub found: Prior,
    pub owner: Option<String>,
    pub roles: BTreeMap<String, Role>,
    pub banned: BTreeSet<String>,
    pub members: BTreeMap<String, Member>,
    next_rank: u32,
    pub joined_ts: BTreeMap<String, i64>,
    pub invites: Vec<InviteSt>,
    pub audit: Vec<AuditEntry>,
    pub reports: Vec<ReportSt>,
    pub devices: BTreeMap<String, BTreeSet<String>>,
    pub max_epoch: u32,
    pub authors: BTreeSet<String>,
    pub last_seen: BTreeMap<String, i64>,
    pub profiles: BTreeMap<String, ProfileSt>,
    pub channels: Vec<Chan>,
    pub msgs: BTreeMap<String, Vec<Msg>>,
    msg_index: HashMap<String, (String, usize)>,
    reply_ids: HashSet<String>,
    pub posts: Vec<PostSt>,
    post_ids: HashSet<String>,
    pub likes: BTreeMap<String, BTreeSet<String>>,
    pub saves: BTreeMap<String, BTreeSet<String>>,
    pub stories: Vec<StorySt>,
    story_ids: HashSet<String>,
    pub lives: Vec<LiveSt>,
    pub room: BTreeMap<String, (bool, i64)>,
    /// Which room each present user is in; empty string is the main hearth room.
    pub room_id: BTreeMap<String, String>,
    /// Per present user: mic muted / screen sharing, from `room.state`.
    pub room_flags: BTreeMap<String, (bool, bool)>,
    pub meetings: Vec<MeetingSt>,
    pub boards: Vec<BoardSt>,
    pub pinboards: Vec<PinboardSt>,
    pub docs: Vec<DocSt>,
    pub cal: Vec<CalSt>,
    pub lines: Vec<LineSt>,
    pub snaps: Vec<SnapSt>,
    pub woven: BTreeMap<String, usize>,
    /// System chat announcements for weaves (A-010), folded from `line.weave` events.
    pub weave_msgs: Vec<Msg>,
    pub letters: Vec<LetterSt>,
    pub counts: Counts,
    pub desk: DeskState,
    pub msgx: MsgState,
    pub arcade: ArcadeState,
}

fn toggle(map: &mut BTreeMap<String, BTreeSet<String>>, target: &str, user: &str) {
    let set = map.entry(target.to_string()).or_default();
    if !set.remove(user) {
        set.insert(user.to_string());
    }
}

pub fn blob_label(b: &BlobRef) -> String {
    if !b.name.is_empty() {
        b.name.clone()
    } else {
        b.hash.chars().take(8).collect()
    }
}

/// Lowest role allowed to author each event type. `member.join` and `space.create` have their
/// own rules and are handled before this table.
pub fn min_role(body: &EventBody) -> Role {
    use EventBody::*;
    match body {
        MemberLeave {}
        | ProfileSet { .. }
        | ReactionToggle { .. }
        | LikeToggle { .. }
        | MessagePost { .. }
        | MessageEdit { .. }
        | MessageDelete { .. }
        | MessageViewed { .. }
        | ProfileExt { .. }
        | MemberNick { .. }
        | TicketCreate { .. }
        | TicketComment { .. }
        | TicketCsat { .. }
        | ReadMark { .. }
        | DeviceLink { .. }
        | DeviceRevoke { .. } => Role::Guest,
        SpaceUpdate { .. }
        | MemberRemove { .. }
        | SpaceRekey { .. }
        | InviteCreate { .. }
        | InviteRevoke { .. }
        | ContentRemove { .. }
        | AutomationSet { .. }
        | DeskConfig { .. } => Role::Admin,
        MemberRole { .. } => Role::Owner,
        _ => Role::Member,
    }
}

fn seal_of(snap_id: &str, line: &str, files: &[crate::event::SnapFileIn]) -> String {
    let mut buf = format!("{snap_id}\n{line}\n").into_bytes();
    for f in files {
        let blob = f.blob.as_ref().map_or("", |b| b.hash.as_str());
        buf.extend_from_slice(format!("{}\0{blob}\0{}\0{}\n", f.path, f.adds, f.dels).as_bytes());
    }
    hex_encode(&blake3_hash(&buf)).chars().take(20).collect()
}

impl SpaceState {
    pub fn new(id: SpaceId, is_home: bool, name: &str, kind: &str) -> Self {
        let mono = name
            .chars()
            .next()
            .map(|c| c.to_uppercase().to_string())
            .unwrap_or_default();
        SpaceState {
            id,
            is_home,
            name: name.to_string(),
            kind: kind.to_string(),
            tagline: String::new(),
            mono,
            sections: vec!["chat".into()],
            map_style: None,
            join_pow_bits: 0,
            created: false,
            creator: None,
            prior: Prior::default(),
            found: Prior::default(),
            owner: None,
            roles: BTreeMap::new(),
            banned: BTreeSet::new(),
            members: BTreeMap::new(),
            next_rank: 0,
            joined_ts: BTreeMap::new(),
            invites: Vec::new(),
            audit: Vec::new(),
            reports: Vec::new(),
            devices: BTreeMap::new(),
            max_epoch: 0,
            authors: BTreeSet::new(),
            last_seen: BTreeMap::new(),
            profiles: BTreeMap::new(),
            channels: Vec::new(),
            msgs: BTreeMap::new(),
            msg_index: HashMap::new(),
            reply_ids: HashSet::new(),
            posts: Vec::new(),
            post_ids: HashSet::new(),
            likes: BTreeMap::new(),
            saves: BTreeMap::new(),
            stories: Vec::new(),
            story_ids: HashSet::new(),
            lives: Vec::new(),
            room: BTreeMap::new(),
            room_id: BTreeMap::new(),
            room_flags: BTreeMap::new(),
            meetings: Vec::new(),
            boards: Vec::new(),
            pinboards: Vec::new(),
            docs: Vec::new(),
            cal: Vec::new(),
            lines: Vec::new(),
            snaps: Vec::new(),
            woven: BTreeMap::new(),
            weave_msgs: Vec::new(),
            letters: Vec::new(),
            counts: Counts::default(),
            desk: DeskState::new(),
            msgx: MsgState::default(),
            arcade: ArcadeState::new(),
        }
    }

    /// Channel opened first: `general` if present, else the first created.
    pub fn default_channel(&self) -> Option<&str> {
        self.channels
            .iter()
            .find(|c| c.id == "general")
            .or(self.channels.first())
            .map(|c| c.id.as_str())
    }

    pub fn role_of(&self, user: &str) -> Option<Role> {
        self.roles.get(user).copied()
    }

    /// Pins the creator learned out of band (local record), for spaces whose id is not bound to one.
    pub fn with_creator(mut self, creator: Option<String>) -> Self {
        self.creator = creator;
        self
    }

    pub fn with_prior(mut self, prior: Prior) -> Self {
        self.prior = prior;
        self
    }

    pub fn fold(mut self, events: &[&Opened]) -> Self {
        // An id bound to its creator beats any pin or fold order.
        self.creator = derived_author(&self.id, events.iter().copied()).or(self.creator.take());
        for ev in events {
            let by = ev.author.to_string();
            let ord: Ord3 = (ev.lamport, ev.author.0, ev.seq);
            if !self.authorize(ev, &by) {
                continue;
            }
            self.authors.insert(by.clone());
            let seen = self.last_seen.entry(by.clone()).or_insert(ev.ts);
            *seen = (*seen).max(ev.ts);
            self.apply(ev, &by, ord);
            self.msgx_after(ev, &by, ord);
        }
        self.finish();
        self
    }

    fn can_join(&self, by: &str, invite: Option<&String>, pow: Option<u64>, ts: i64) -> bool {
        if self.roles.contains_key(by) || self.banned.contains(by) {
            return false;
        }
        let Some(inv) = invite.and_then(|id| self.invites.iter().find(|i| &i.id == id)) else {
            return false;
        };
        if !crate::pow::verify(&inv.id, by, pow, inv.pow_bits) {
            return false;
        }
        // A revoke that names who had joined is position-independent; an older one applies by fold order.
        let open = self
            .prior
            .revoked
            .get(&inv.id)
            .map_or(!inv.revoked, |joined| joined.contains(by));
        let live = open && inv.exp.is_none_or(|e| (ts.max(0) as u64) / 1000 < e);
        let room =
            inv.uses.contains(by) || inv.max_uses.is_none_or(|m| (inv.uses.len() as u32) < m);
        live && room
    }

    fn authorize(&self, ev: &Opened, by: &str) -> bool {
        let ts = ev.ts;
        if self.prior.caps.get(by).is_some_and(|cap| ev.seq > *cap) {
            return false;
        }
        match &ev.body {
            EventBody::Unknown => false,
            EventBody::SpaceCreate { .. } => {
                !self.created && self.creator.as_deref().is_none_or(|c| c == by)
            }
            _ if !self.created => false,
            EventBody::MemberJoin { invite, pow, .. } => {
                self.can_join(by, invite.as_ref(), *pow, ts)
            }
            other => self
                .role_of(by)
                .is_some_and(|r| r >= min_role(other) && self.msgx_allows(by, r, other, ts)),
        }
    }

    fn audit(&mut self, ev: &Opened, by: &str, kind: &str, target: Option<&str>, detail: String) {
        self.audit.push(AuditEntry {
            ts: ev.ts,
            by: by.to_string(),
            kind: kind.to_string(),
            target: target.map(str::to_string),
            detail,
            event_id: ev.id.clone(),
        });
    }

    fn add_member(&mut self, user: &str, role: Role, ts: i64) {
        let rank = self.next_rank;
        let m = self
            .members
            .entry(user.to_string())
            .or_insert(Member { rank, joined: true });
        if m.rank == rank {
            self.next_rank += 1;
        }
        m.joined = true;
        self.roles.insert(user.to_string(), role);
        self.joined_ts.entry(user.to_string()).or_insert(ts);
    }

    fn drop_member(&mut self, user: &str) {
        self.roles.remove(user);
        if let Some(m) = self.members.get_mut(user) {
            m.joined = false;
        }
        self.room.remove(user);
        self.room_id.remove(user);
    }

    fn apply(&mut self, ev: &Opened, by: &str, ord: Ord3) {
        let ts = ev.ts;
        let my_role = self.role_of(by);
        match &ev.body {
            EventBody::SpaceCreate {
                name,
                kind,
                tagline,
                mono,
                sections,
                ..
            } => {
                self.created = true;
                self.name = name.clone();
                self.kind = kind.clone();
                self.tagline = tagline.clone();
                self.mono = mono.clone();
                self.sections = Vec::new();
                for s in sections {
                    if !self.sections.contains(s) {
                        self.sections.push(s.clone());
                    }
                }
                self.owner = Some(by.to_string());
                self.add_member(by, Role::Owner, ts);
                self.audit(ev, by, "space.create", None, name.clone());
            }
            EventBody::SpaceUpdate {
                name,
                tagline,
                sections,
                map_style,
                join_pow_bits,
            } => {
                if let Some(b) = join_pow_bits.filter(|b| *b <= crate::pow::MAX_JOIN_POW_BITS) {
                    self.join_pow_bits = b;
                }
                if let Some(m) = map_style.as_deref().filter(|m| valid_map_style(m)) {
                    self.map_style = (!m.is_empty()).then(|| m.to_string());
                }
                if let Some(n) = name {
                    self.name = n.clone();
                }
                if let Some(t) = tagline {
                    self.tagline = t.clone();
                }
                if let Some(s) = sections {
                    self.sections = s.clone();
                }
            }
            EventBody::SectionRaise { section } => {
                if !self.sections.contains(section) {
                    self.sections.push(section.clone());
                }
            }
            EventBody::MemberJoin { invite, .. } => {
                let inv = self
                    .invites
                    .iter_mut()
                    .find(|i| Some(&i.id) == invite.as_ref())
                    .expect("authorized join has an invite");
                inv.uses.insert(by.to_string());
                let role = inv.role;
                self.add_member(by, role, ts);
                self.audit(
                    ev,
                    by,
                    "member.join",
                    None,
                    invite.clone().unwrap_or_default(),
                );
            }
            EventBody::MemberLeave {} => {
                self.drop_member(by);
                self.audit(ev, by, "member.leave", None, String::new());
            }
            EventBody::MemberRole { user, role } => {
                let Some(target) = self.role_of(user) else {
                    return;
                };
                let owners = self.roles.values().filter(|r| **r == Role::Owner).count();
                if target == Role::Owner && *role != Role::Owner && owners <= 1 {
                    return;
                }
                self.roles.insert(user.clone(), *role);
                self.audit(ev, by, "member.role", Some(user), role.as_str().to_string());
            }
            EventBody::MemberRemove { user, last_seq } => {
                let (Some(mine), Some(target)) = (my_role, self.role_of(user)) else {
                    return;
                };
                if user == by || target >= mine {
                    return;
                }
                self.drop_member(user);
                self.banned.insert(user.clone());
                if let Some(seq) = last_seq {
                    let cap = self.found.caps.entry(user.clone()).or_insert(*seq);
                    *cap = (*cap).min(*seq);
                }
                self.audit(ev, by, "member.remove", Some(user), String::new());
            }
            EventBody::SpaceRekey { epoch, .. } => {
                self.max_epoch = self.max_epoch.max(*epoch);
                self.audit(ev, by, "space.rekey", None, format!("epoch {epoch}"));
            }
            EventBody::InviteCreate {
                id,
                exp,
                max_uses,
                role,
            } => {
                let mine = my_role.expect("authorized");
                if *role >= Role::Owner || *role > mine || self.invites.iter().any(|i| &i.id == id)
                {
                    return;
                }
                self.invites.push(InviteSt {
                    id: id.clone(),
                    by: by.to_string(),
                    ts,
                    role: *role,
                    exp: *exp,
                    max_uses: *max_uses,
                    pow_bits: self.join_pow_bits,
                    uses: BTreeSet::new(),
                    revoked: false,
                });
                self.audit(ev, by, "invite.create", Some(id), role.as_str().to_string());
            }
            EventBody::InviteRevoke { id, joined } => {
                if let Some(i) = self.invites.iter_mut().find(|i| &i.id == id) {
                    i.revoked = true;
                    if let Some(joined) = joined {
                        self.found
                            .revoked
                            .entry(id.clone())
                            .or_default()
                            .extend(joined.iter().cloned());
                    }
                    self.audit(ev, by, "invite.revoke", Some(id), String::new());
                }
            }
            EventBody::ProfileSet {
                name,
                bio,
                initials,
                avatar,
                ..
            } => {
                self.profiles.insert(
                    by.to_string(),
                    ProfileSt {
                        name: name.clone(),
                        bio: bio.clone(),
                        initials: initials.clone(),
                        avatar: avatar.clone(),
                        ord: (ev.lamport, ev.seq),
                    },
                );
            }
            EventBody::ChannelCreate {
                channel_id,
                name,
                topic,
                dm,
                guest,
            } => {
                if !self.channels.iter().any(|c| &c.id == channel_id) {
                    self.channels.push(Chan {
                        id: channel_id.clone(),
                        name: name.clone(),
                        topic: topic.clone(),
                        dm: dm.clone(),
                        guest: *guest,
                    });
                }
            }
            EventBody::MessagePost {
                channel_id,
                msg_id,
                text,
                reply_to,
                attachments,
                snap,
                mentions,
                preview,
                target,
                ext: _,
            } => {
                if self.msg_index.contains_key(msg_id) || self.reply_ids.contains(msg_id) {
                    return;
                }
                if my_role == Some(Role::Guest) {
                    let open = self.channels.iter().any(|c| &c.id == channel_id && c.guest);
                    if !open || target.is_some() {
                        return;
                    }
                }
                if let Some(pid) = target {
                    if let Some(p) = self.posts.iter_mut().find(|p| &p.id == pid && !p.removed) {
                        p.comments.push(ReplySt {
                            by: by.to_string(),
                            ts,
                            text: text.clone(),
                        });
                        self.reply_ids.insert(msg_id.clone());
                    }
                    return;
                }
                self.counts.chat += 1;
                let parent = reply_to
                    .as_ref()
                    .and_then(|p| self.msg_index.get(p))
                    .cloned();
                if let Some((ch, idx)) = parent {
                    self.msgs.get_mut(&ch).expect("indexed channel")[idx]
                        .thread
                        .push(ReplySt {
                            by: by.to_string(),
                            ts,
                            text: text.clone(),
                        });
                    self.reply_ids.insert(msg_id.clone());
                    return;
                }
                let list = self.msgs.entry(channel_id.clone()).or_default();
                self.msg_index
                    .insert(msg_id.clone(), (channel_id.clone(), list.len()));
                list.push(Msg {
                    id: msg_id.clone(),
                    by: by.to_string(),
                    ts,
                    ord,
                    arrival: ev.arrival,
                    text: text.clone(),
                    rx: Vec::new(),
                    thread: Vec::new(),
                    img: attachments.first().map(blob_label),
                    att: attachments.clone(),
                    snap: snap.clone(),
                    meet: None,
                    removed: None,
                    history: Vec::new(),
                    pinned: false,
                    mentions: mentions.clone(),
                    preview: preview.as_ref().map(|p| {
                        (
                            p.url.clone(),
                            p.title.clone(),
                            p.image.as_ref().map(blob_label),
                        )
                    }),
                });
            }
            EventBody::MessageEdit { msg_id, text } => {
                if let Some(m) = self
                    .msg_mut(msg_id)
                    .filter(|m| m.by == by && m.removed.is_none())
                {
                    let prior = std::mem::replace(&mut m.text, text.clone());
                    m.history.push((ts, prior));
                }
            }
            EventBody::MessageDelete { msg_id } => {
                if let Some(m) = self
                    .msg_mut(msg_id)
                    .filter(|m| m.by == by && m.removed.is_none())
                {
                    m.removed = Some("author");
                }
            }
            EventBody::MessagePin { msg_id } => {
                // Same floor as the UI: only the author or an admin pins; a forged event from
                // another member changes nothing on any peer.
                let admin = my_role >= Some(Role::Admin);
                if let Some(m) = self
                    .msg_mut(msg_id)
                    .filter(|m| m.removed.is_none() && (m.by == by || admin))
                {
                    m.pinned = !m.pinned;
                }
            }
            EventBody::ReactionToggle { target_id, label } => {
                if let Some(m) = self.msg_mut(target_id) {
                    let idx =
                        m.rx.iter()
                            .position(|(l, _)| l == label)
                            .unwrap_or_else(|| {
                                m.rx.push((label.clone(), BTreeSet::new()));
                                m.rx.len() - 1
                            });
                    if !m.rx[idx].1.remove(by) {
                        m.rx[idx].1.insert(by.to_string());
                    }
                }
            }
            EventBody::PostCreate {
                post_id,
                kind,
                title,
                text,
                blobs,
                dur,
                chapters,
                captions,
            } => {
                if self.post_ids.insert(post_id.clone()) {
                    self.counts.feed += 1;
                    let label = match (kind.as_str(), blobs.first()) {
                        ("note", _) => String::new(),
                        (k, Some(b)) => format!("{k} \u{b7} {}", blob_label(b)),
                        (k, None) => format!("{k} \u{b7} {title}"),
                    };
                    self.posts.push(PostSt {
                        id: post_id.clone(),
                        by: by.to_string(),
                        ts,
                        ord,
                        kind: kind.clone(),
                        title: title.clone(),
                        text: text.clone(),
                        label,
                        dur: dur.clone(),
                        chapters: chapters.iter().map(|c| (c.t, c.title.clone())).collect(),
                        captions: captions.as_ref().map(|c| c.hash.clone()),
                        blobs: blobs.clone(),
                        comments: Vec::new(),
                        removed: false,
                    });
                }
            }
            EventBody::PostDelete { post_id } => {
                let admin = my_role >= Some(Role::Admin);
                if let Some(p) = self
                    .posts
                    .iter_mut()
                    .find(|p| &p.id == post_id && (p.by == by || admin))
                {
                    p.removed = true;
                }
            }
            EventBody::StoryCreate {
                story_id,
                items,
                ttl_secs,
            } => {
                if self.story_ids.insert(story_id.clone()) {
                    self.counts.feed += 1;
                    self.stories.push(StorySt {
                        id: story_id.clone(),
                        by: by.to_string(),
                        ts,
                        ttl_ms: (*ttl_secs).min(i64::MAX as u64 / 2000) as i64 * 1000,
                        items: items
                            .iter()
                            .map(|i| (blob_label(&i.blob), i.caption.clone()))
                            .collect(),
                        item_blobs: items.iter().map(|i| i.blob.clone()).collect(),
                        loves: BTreeSet::new(),
                        replies: 0,
                    });
                }
            }
            EventBody::StoryReply { story_id, .. } => {
                if let Some(s) = self.stories.iter_mut().find(|s| &s.id == story_id) {
                    s.replies += 1;
                }
            }
            EventBody::StoryLove { story_id } => {
                if let Some(s) = self.stories.iter_mut().find(|s| &s.id == story_id) {
                    s.loves.insert(by.to_string());
                }
            }
            EventBody::LikeToggle { target_id } => toggle(&mut self.likes, target_id, by),
            EventBody::SaveToggle { target_id } => toggle(&mut self.saves, target_id, by),
            EventBody::LiveStart { live_id, title } => {
                if !self.lives.iter().any(|l| &l.id == live_id) {
                    self.counts.hearth += 1;
                    self.lives.push(LiveSt {
                        id: live_id.clone(),
                        title: title.clone(),
                        host: by.to_string(),
                        ts,
                        ended: false,
                        chat: Vec::new(),
                    });
                }
            }
            EventBody::LiveEnd { live_id } => {
                if let Some(l) = self
                    .lives
                    .iter_mut()
                    .find(|l| &l.id == live_id && l.host == by)
                {
                    l.ended = true;
                }
            }
            EventBody::LiveChat { live_id, text } => {
                if let Some(l) = self.lives.iter_mut().find(|l| &l.id == live_id) {
                    l.chat.push((by.to_string(), text.clone()));
                }
            }
            EventBody::RoomJoin { room } => {
                let cam = self.room.get(by).is_some_and(|r| r.0);
                self.room.insert(by.to_string(), (cam, ts));
                self.room_id.insert(by.to_string(), room.clone());
            }
            EventBody::RoomLeave { room } => {
                // A leave naming another room than the one I am in is stale and ignored.
                if self.room_id.get(by).is_none_or(|r| r == room) {
                    self.room.remove(by);
                    self.room_id.remove(by);
                    self.room_flags.remove(by);
                }
            }
            EventBody::RoomState {
                room,
                cam,
                muted,
                share,
            } => {
                if self.room_id.get(by).is_some_and(|r| r == room) {
                    if let (Some(c), Some(r)) = (cam, self.room.get_mut(by)) {
                        *r = (*c, ts);
                    }
                    let f = self.room_flags.entry(by.to_string()).or_default();
                    if let Some(m) = muted {
                        f.0 = *m;
                    }
                    if let Some(sh) = share {
                        f.1 = *sh;
                    }
                }
            }
            EventBody::MeetingStart { topic, agenda } => {
                self.counts.hearth += 1;
                self.meetings.push(MeetingSt {
                    topic: topic.clone(),
                    start_ts: ts,
                    agenda: agenda
                        .iter()
                        .map(|a| AgendaSt {
                            text: a.text.clone(),
                            who: a.who.clone(),
                            done: false,
                        })
                        .collect(),
                    notes: 0,
                    note_list: Vec::new(),
                    ended: None,
                });
            }
            EventBody::MeetingEnd {} => {
                if let Some(m) = self.meetings.iter_mut().rev().find(|m| m.ended.is_none()) {
                    m.ended = Some((ts, ord, ev.id.clone()));
                }
            }
            EventBody::AgendaToggle { idx } => {
                if let Some(a) = self
                    .active_meeting_mut()
                    .and_then(|m| m.agenda.get_mut(*idx as usize))
                {
                    a.done = !a.done;
                }
            }
            EventBody::NoteAdd { text } => {
                if let Some(m) = self.active_meeting_mut() {
                    m.notes += 1;
                    m.note_list.push((by.to_string(), ts, text.clone()));
                }
            }
            EventBody::BoardCreate {
                board_id,
                name,
                due,
                cols,
            } => {
                if !self.boards.iter().any(|b| &b.id == board_id) {
                    self.boards.push(BoardSt {
                        id: board_id.clone(),
                        name: name.clone(),
                        due: due.clone(),
                        cols: cols
                            .iter()
                            .map(|c| ColSt {
                                id: c.col_id.clone(),
                                name: c.name.clone(),
                                cards: Vec::new(),
                            })
                            .collect(),
                    });
                }
            }
            EventBody::ColumnCreate {
                board_id,
                col_id,
                name,
            } => {
                if let Some(b) = self.boards.iter_mut().find(|b| &b.id == board_id)
                    && !b.cols.iter().any(|c| &c.id == col_id)
                {
                    b.cols.push(ColSt {
                        id: col_id.clone(),
                        name: name.clone(),
                        cards: Vec::new(),
                    });
                }
            }
            EventBody::CardCreate {
                board_id,
                card_id,
                col_id,
                title,
                tag,
                snap,
            } => {
                if self.card_exists(card_id) {
                    return;
                }
                let col = self
                    .boards
                    .iter_mut()
                    .find(|b| &b.id == board_id)
                    .and_then(|b| b.cols.iter_mut().find(|c| &c.id == col_id));
                if let Some(c) = col {
                    c.cards.push(CardSt {
                        id: card_id.clone(),
                        title: title.clone(),
                        tag: tag.clone(),
                        by: by.to_string(),
                        snap: snap.clone(),
                        assignee: None,
                        due: None,
                        ts,
                    });
                    self.counts.board += 1;
                }
            }
            EventBody::CardMove { card_id, col_id } => self.move_card(card_id, col_id),
            EventBody::CardUpdate {
                card_id,
                title,
                tag,
                snap,
                assignee,
                due,
            } => {
                // A peer can send anything: an assignee must be a current member, a due a real date.
                let assignee_ok = assignee
                    .as_deref()
                    .is_none_or(|a| a.is_empty() || self.role_of(a).is_some());
                let due_ok = due.as_deref().is_none_or(|d| d.is_empty() || real_date(d));
                if !assignee_ok || !due_ok {
                    return;
                }
                if let Some(c) = self
                    .boards
                    .iter_mut()
                    .flat_map(|b| b.cols.iter_mut())
                    .flat_map(|c| c.cards.iter_mut())
                    .find(|c| &c.id == card_id)
                {
                    if let Some(t) = title {
                        c.title = t.clone();
                    }
                    if let Some(t) = tag {
                        c.tag = t.clone();
                    }
                    if snap.is_some() {
                        c.snap = snap.clone();
                    }
                    // Empty string clears; absent leaves the field alone.
                    if let Some(a) = assignee {
                        c.assignee = Some(a.clone()).filter(|a| !a.is_empty());
                    }
                    if let Some(d) = due {
                        c.due = Some(d.clone()).filter(|d| !d.is_empty());
                    }
                }
            }
            EventBody::CardDelete { card_id } => {
                for col in self.boards.iter_mut().flat_map(|b| b.cols.iter_mut()) {
                    col.cards.retain(|c| &c.id != card_id);
                }
            }
            EventBody::PinboardCreate { board_id, name } => {
                if !self.pinboards.iter().any(|p| &p.id == board_id) {
                    self.pinboards.push(PinboardSt {
                        id: board_id.clone(),
                        name: name.clone(),
                        by: by.to_string(),
                        pins: Vec::new(),
                    });
                }
            }
            EventBody::PinAdd {
                board_id,
                blob,
                title,
                label,
            } => {
                if let Some(p) = self.pinboards.iter_mut().find(|p| &p.id == board_id) {
                    let label = if label.is_empty() {
                        blob_label(blob)
                    } else {
                        label.clone()
                    };
                    p.pins.push(PinSt {
                        blob: blob.clone(),
                        label,
                        title: title.clone(),
                        seed: blob.hash.clone(),
                        by: by.to_string(),
                    });
                }
            }
            EventBody::DocCreate {
                doc_id,
                title,
                kicker,
            } => {
                if !self.docs.iter().any(|d| &d.id == doc_id) {
                    self.docs.push(DocSt {
                        id: doc_id.clone(),
                        title: title.clone(),
                        kicker: kicker.clone(),
                        blocks: Vec::new(),
                        editors: vec![by.to_string()],
                        last_edit: (ts, by.to_string()),
                        versions: vec![(ts, ev.id.clone())],
                        comments: Vec::new(),
                    });
                }
            }
            EventBody::DocBlock {
                doc_id,
                op,
                block_id,
                block,
                after,
            } => {
                if let Some(d) = self.docs.iter_mut().find(|d| &d.id == doc_id)
                    && apply_block(d, *op, block_id, block.as_ref(), after.as_deref())
                {
                    if !d.editors.iter().any(|e| e == by) {
                        d.editors.push(by.to_string());
                    }
                    d.last_edit = (ts, by.to_string());
                    d.versions.push((ts, ev.id.clone()));
                }
            }
            EventBody::DocComment {
                doc_id,
                block_id,
                text,
            } => {
                if let Some(d) = self.docs.iter_mut().find(|d| &d.id == doc_id)
                    && let Some(b) = d.blocks.iter().find(|b| &b.id == block_id)
                {
                    let on: String = b.text.chars().take(40).collect();
                    d.comments.push(DocCommentSt {
                        by: by.to_string(),
                        on,
                        text: text.clone(),
                    });
                }
            }
            EventBody::EventCreate {
                ev_id,
                day,
                start,
                end,
                title,
                place,
                note,
                meeting,
            } => {
                if !slot_ok(*day, *start, *end) {
                    return;
                }
                if !self.cal.iter().any(|c| &c.id == ev_id) {
                    self.cal.push(CalSt {
                        id: ev_id.clone(),
                        by: by.to_string(),
                        d: *day,
                        s: *start,
                        e: *end,
                        title: title.clone(),
                        place: place.clone(),
                        note: note.clone(),
                        meeting: *meeting,
                        people: vec![by.to_string()],
                    });
                }
            }
            EventBody::EventRsvp { ev_id } => {
                if let Some(c) = self.cal.iter_mut().find(|c| &c.id == ev_id) {
                    match c.people.iter().position(|p| p == by) {
                        Some(i) => {
                            c.people.remove(i);
                        }
                        None => c.people.push(by.to_string()),
                    }
                }
            }
            EventBody::EventUpdate {
                ev_id,
                day,
                start,
                end,
                title,
                place,
                note,
                meeting,
            } => {
                let admin = my_role >= Some(Role::Admin);
                if let Some(c) = self
                    .cal
                    .iter_mut()
                    .find(|c| &c.id == ev_id && (c.by == by || admin))
                {
                    if !slot_ok(day.unwrap_or(c.d), start.unwrap_or(c.s), end.unwrap_or(c.e)) {
                        return;
                    }
                    if let Some(v) = day {
                        c.d = *v;
                    }
                    if let Some(v) = start {
                        c.s = *v;
                    }
                    if let Some(v) = end {
                        c.e = *v;
                    }
                    if let Some(v) = title {
                        c.title = v.clone();
                    }
                    if let Some(v) = place {
                        c.place = v.clone();
                    }
                    if let Some(v) = note {
                        c.note = v.clone();
                    }
                    if let Some(v) = meeting {
                        c.meeting = *v;
                    }
                }
            }
            EventBody::EventCancel { ev_id } => {
                let admin = my_role >= Some(Role::Admin);
                self.cal
                    .retain(|c| !(&c.id == ev_id && (c.by == by || admin)));
            }
            EventBody::LineCreate {
                line_id,
                name,
                note,
                ..
            } => {
                if !self.lines.iter().any(|l| &l.id == line_id) {
                    self.lines.push(LineSt {
                        id: line_id.clone(),
                        name: name.clone(),
                        note: note.clone(),
                        by: Some(by.to_string()),
                    });
                }
            }
            EventBody::SnapCreate {
                snap_id,
                line_id,
                title,
                kind,
                files,
                parent,
            } => {
                if !self.snaps.iter().any(|s| &s.id == snap_id) {
                    self.counts.skein += 1;
                    self.snaps.push(SnapSt {
                        id: snap_id.clone(),
                        line: line_id.clone(),
                        title: title.clone(),
                        by: by.to_string(),
                        ts,
                        kind: kind.clone(),
                        seal: seal_of(snap_id, line_id, files),
                        parent: parent.clone(),
                        files: files
                            .iter()
                            .map(|f| SnapFileSt {
                                blob: f.blob.clone(),
                                path: f.path.clone(),
                                adds: f.adds,
                                dels: f.dels,
                            })
                            .collect(),
                        weave_of: None,
                    });
                }
            }
            EventBody::LineWeave { line_id, into } => {
                let on_line = self
                    .snaps
                    .iter()
                    .filter(|s| &s.line == line_id && s.weave_of.is_none())
                    .count();
                self.woven.insert(line_id.clone(), on_line);
                self.snaps.push(SnapSt {
                    id: format!("weave-{}", ev.id.chars().take(12).collect::<String>()),
                    line: into.clone(),
                    title: format!("Wove {line_id} into {into}"),
                    by: by.to_string(),
                    ts,
                    kind: "Weave".into(),
                    seal: ev.id.chars().take(20).collect(),
                    parent: None,
                    files: Vec::new(),
                    weave_of: Some(line_id.clone()),
                });
                // A-010: every peer folds the same system notice into the default channel.
                self.weave_msgs.push(Msg {
                    id: format!("weave-msg-{}", ev.id.chars().take(12).collect::<String>()),
                    by: "system".into(),
                    ts,
                    ord,
                    arrival: 0,
                    text: format!("Wove {line_id} into {into}"),
                    rx: Vec::new(),
                    thread: Vec::new(),
                    img: None,
                    att: Vec::new(),
                    snap: None,
                    meet: None,
                    removed: None,
                    history: Vec::new(),
                    pinned: false,
                    mentions: Vec::new(),
                    preview: None,
                });
            }
            EventBody::LetterSend {
                to_space,
                channel_id,
                text,
            } => {
                self.letters.push(LetterSt {
                    id: ev.id.clone(),
                    to: to_space.clone().unwrap_or_else(|| self.id.to_string()),
                    by: by.to_string(),
                    ch: channel_id.clone(),
                    text: text.clone(),
                    ts,
                });
            }
            EventBody::ContentRemove { target_id, reason } => {
                let mut hit = false;
                if let Some(m) = self.msg_mut(target_id) {
                    m.removed = Some("admin");
                    hit = true;
                }
                if let Some(p) = self.posts.iter_mut().find(|p| &p.id == target_id) {
                    p.removed = true;
                    hit = true;
                }
                if hit {
                    self.audit(
                        ev,
                        by,
                        "content.remove",
                        Some(target_id),
                        reason.clone().unwrap_or_default(),
                    );
                }
            }
            EventBody::ContentReport { target_id, reason } => {
                self.reports.push(ReportSt {
                    id: ev.id.clone(),
                    by: by.to_string(),
                    target: target_id.clone(),
                    reason: reason.clone().unwrap_or_default(),
                    ts,
                });
            }
            EventBody::DeviceLink { device_pub, cert } => {
                if crate::device::verify_cert(&ev.author, device_pub, cert) {
                    self.devices
                        .entry(by.to_string())
                        .or_default()
                        .insert(device_pub.clone());
                    self.audit(ev, by, "device.link", Some(device_pub), String::new());
                }
            }
            EventBody::DeviceRevoke { device_pub } => {
                if self
                    .devices
                    .get_mut(by)
                    .is_some_and(|d| d.remove(device_pub))
                {
                    self.audit(ev, by, "device.revoke", Some(device_pub), String::new());
                }
            }
            EventBody::DeskConfig { .. }
            | EventBody::TicketCreate { .. }
            | EventBody::TicketUpdate { .. }
            | EventBody::TicketComment { .. }
            | EventBody::TicketLink { .. }
            | EventBody::TicketMerge { .. }
            | EventBody::TicketCsat { .. }
            | EventBody::DeskMacro { .. }
            | EventBody::DeskView { .. } => self.desk.apply(ts, by, &self.roles, ord, &ev.body),
            EventBody::GameCreate { .. }
            | EventBody::GameJoin { .. }
            | EventBody::GameLeave { .. }
            | EventBody::GameMove { .. }
            | EventBody::GameResign { .. }
            | EventBody::GameDraw { .. }
            | EventBody::GameResult { .. }
            | EventBody::PollCreate { .. }
            | EventBody::PollVote { .. }
            | EventBody::PollClose { .. }
            | EventBody::QuizCreate { .. }
            | EventBody::QuizAnswer { .. }
            | EventBody::QuizReveal { .. }
            | EventBody::KudosGive { .. }
            | EventBody::StandupPost { .. } => self.arcade.apply(ts, by, &self.roles, &ev.body),
            EventBody::ReadMark { .. }
            | EventBody::MessageViewed { .. }
            | EventBody::ThreadState { .. }
            | EventBody::ChannelSettings { .. }
            | EventBody::EmojiAdd { .. }
            | EventBody::StickerAdd { .. }
            | EventBody::ProfileExt { .. }
            | EventBody::MemberNick { .. }
            | EventBody::DmInvite { .. }
            | EventBody::AutomationSet { .. }
            | EventBody::Unknown => {}
        }
    }

    /// Author of a top-level message, if it exists.
    pub fn msg_author(&self, id: &str) -> Option<&str> {
        let (ch, idx) = self.msg_index.get(id)?;
        self.msgs.get(ch)?.get(*idx).map(|m| m.by.as_str())
    }

    fn msg_mut(&mut self, id: &str) -> Option<&mut Msg> {
        let (ch, idx) = self.msg_index.get(id)?.clone();
        self.msgs.get_mut(&ch)?.get_mut(idx)
    }

    fn active_meeting_mut(&mut self) -> Option<&mut MeetingSt> {
        self.meetings.iter_mut().rev().find(|m| m.ended.is_none())
    }

    fn card_exists(&self, id: &str) -> bool {
        self.boards
            .iter()
            .flat_map(|b| &b.cols)
            .flat_map(|c| &c.cards)
            .any(|c| c.id == id)
    }

    fn move_card(&mut self, card_id: &str, col_id: &str) {
        for b in &mut self.boards {
            if !b
                .cols
                .iter()
                .any(|c| c.cards.iter().any(|k| k.id == card_id))
                || !b.cols.iter().any(|c| c.id == col_id)
            {
                continue;
            }
            let mut moved = None;
            for c in &mut b.cols {
                if let Some(i) = c.cards.iter().position(|k| k.id == card_id) {
                    moved = Some(c.cards.remove(i));
                }
            }
            if let (Some(card), Some(target)) = (moved, b.cols.iter_mut().find(|c| c.id == col_id))
            {
                target.cards.push(card);
            }
            return;
        }
    }

    /// Adds a summary message to the meeting channel for every ended meeting, then settles order.
    fn finish(&mut self) {
        let Some(ch) = self.default_channel().map(str::to_string) else {
            return;
        };
        let mut summaries = Vec::new();
        for m in &self.meetings {
            if let Some((end_ts, ord, id)) = &m.ended {
                let mins = ((end_ts - m.start_ts).max(0) as f64 / 60_000.0)
                    .round()
                    .max(1.0);
                summaries.push(Msg {
                    id: format!("meet-{}", id.chars().take(16).collect::<String>()),
                    by: "system".into(),
                    ts: *end_ts,
                    ord: *ord,
                    arrival: 0,
                    text: "Meeting summary".into(),
                    rx: Vec::new(),
                    thread: Vec::new(),
                    img: None,
                    att: Vec::new(),
                    snap: None,
                    meet: Some(MeetSummary {
                        title: m.topic.clone(),
                        dur: format!("{mins} min"),
                        notes: m.notes,
                        done: m.agenda.iter().filter(|a| a.done).count() as u32,
                        total: m.agenda.len() as u32,
                    }),
                    removed: None,
                    history: Vec::new(),
                    pinned: false,
                    mentions: Vec::new(),
                    preview: None,
                });
            }
        }
        let weaves = std::mem::take(&mut self.weave_msgs);
        if summaries.is_empty() && weaves.is_empty() {
            return;
        }
        let list = self.msgs.entry(ch).or_default();
        list.extend(summaries);
        // A-010: weave announcements fold on every peer next to the meeting summaries.
        list.extend(weaves);
        list.sort_by_key(|m| m.ord);
    }
}

fn apply_block(
    d: &mut DocSt,
    op: DocOp,
    id: &str,
    block: Option<&DocBlockIn>,
    after: Option<&str>,
) -> bool {
    let pos = d.blocks.iter().position(|b| b.id == id);
    match (op, pos, block) {
        (DocOp::Insert, None, Some(b)) => {
            let at = after
                .and_then(|a| d.blocks.iter().position(|x| x.id == a))
                .map_or(d.blocks.len(), |i| i + 1);
            d.blocks.insert(
                at,
                BlockSt {
                    id: id.to_string(),
                    k: b.k.clone(),
                    text: b.text.clone(),
                    done: b.done.unwrap_or(false),
                },
            );
            true
        }
        (DocOp::Update, Some(i), Some(b)) => {
            d.blocks[i].text = b.text.clone();
            if !b.k.is_empty() {
                d.blocks[i].k = b.k.clone();
            }
            if let Some(done) = b.done {
                d.blocks[i].done = done;
            }
            true
        }
        (DocOp::Delete, Some(i), _) => {
            d.blocks.remove(i);
            true
        }
        (DocOp::Toggle, Some(i), _) => {
            d.blocks[i].done = !d.blocks[i].done;
            true
        }
        _ => false,
    }
}
