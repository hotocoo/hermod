//! Deterministic projections: fold each space's events into the exact JSON shapes the UI consumes.
//!
//! `project` is a pure function of `(ctx, inputs)`: input event order is irrelevant, `now` and the
//! local user come from the context, and no iteration order depends on hashing.

pub mod arcade;
pub mod desk;
pub mod messaging;
pub mod shapes;
pub mod sla;
pub mod time;

mod render;
mod report;
mod state;

use std::collections::{BTreeMap, BTreeSet};

use crate::event::EventBody;
use crate::growth::GrowthConfig;
use crate::ids::{SpaceId, UserId};
use crate::store::Opened;

pub use report::{InviteInfo, MemberInfo, ReportInfo, SpaceReport, report, search_items};
pub use shapes::Snapshot;
pub use state::{AuditEntry, min_role};

/// Display and retention limits for projections.
#[derive(Debug, Clone)]
pub struct ProjectionConfig {
    /// A member counts as `online` if seen within this window.
    pub online_window_ms: i64,
    /// Room presence older than this is dropped (covers crashed clients).
    pub room_stale_ms: i64,
    /// Maximum inbox entries.
    pub inbox_max: usize,
    /// Maximum posts in the aggregated home feed.
    pub home_feed_max: usize,
    /// Maximum doc versions listed.
    pub versions_max: usize,
    /// Maximum live chat lines listed.
    pub live_chat_max: usize,
    /// Finished games listed per space.
    pub arcade_done_games_max: usize,
    /// Moves listed per game (older ones only count in `moveCount`).
    pub arcade_moves_max: usize,
    /// Kudos listed, newest first.
    pub arcade_kudos_max: usize,
    /// Standup days listed, newest first.
    pub arcade_standup_days: usize,
}

impl Default for ProjectionConfig {
    fn default() -> Self {
        ProjectionConfig {
            online_window_ms: 5 * 60 * 1000,
            room_stale_ms: 4 * 60 * 60 * 1000,
            inbox_max: 50,
            home_feed_max: 100,
            versions_max: 10,
            live_chat_max: 30,
            arcade_done_games_max: 30,
            arcade_moves_max: 300,
            arcade_kudos_max: 100,
            arcade_standup_days: 14,
        }
    }
}

/// Everything besides events that a projection depends on.
#[derive(Debug, Clone)]
pub struct ProjectionCtx {
    pub me: UserId,
    pub now_ms: i64,
    /// Local timezone offset in seconds east of UTC.
    pub tz_offset_secs: i32,
    /// Highest event arrival (device-local apply order) read per `(space, channel)`; drives unread counts and inbox state.
    pub read_markers: BTreeMap<(SpaceId, String), u64>,
    /// Users blocked on this device: their content is flagged or hidden.
    pub blocks: BTreeSet<String>,
    /// `(kind, target)` follows, kind `user` or `space`; filters the home feed when non-empty.
    pub follows: BTreeSet<(String, String)>,
    /// Messages the local user deleted for themselves, `(space, msg id)`; never synced.
    pub hidden: BTreeSet<(SpaceId, String)>,
    /// Chat mute map `space/channel -> until` (0 = forever): muted chats raise no inbox entry (M-035).
    pub muted: BTreeMap<String, i64>,
    /// Per-space retention cutoff (unix ms, D-004): messages older than it are hidden locally.
    /// The signed log is never edited, so sync and verification are unaffected.
    pub retention_cutoffs: BTreeMap<SpaceId, i64>,
    pub config: ProjectionConfig,
    pub growth: GrowthConfig,
}

impl ProjectionCtx {
    pub fn new(me: UserId, now_ms: i64) -> Self {
        ProjectionCtx {
            me,
            now_ms,
            tz_offset_secs: 0,
            read_markers: BTreeMap::new(),
            blocks: BTreeSet::new(),
            follows: BTreeSet::new(),
            hidden: BTreeSet::new(),
            muted: BTreeMap::new(),
            retention_cutoffs: BTreeMap::new(),
            config: ProjectionConfig::default(),
            growth: GrowthConfig::default(),
        }
    }
}

/// One space and its applied events (any order).
#[derive(Debug, Clone)]
pub struct SpaceInput {
    pub id: SpaceId,
    /// Fallback name and kind until `space.create` is in the log.
    pub name: String,
    pub kind: String,
    pub is_home: bool,
    /// Creator pinned locally for spaces whose id is not bound to one; see [`genesis_author`].
    pub creator: Option<UserId>,
    pub events: Vec<Opened>,
}

/// Creator to pin for `id`: the author whose nonce derives the id, else the first `space.create` in fold order.
pub fn genesis_author(id: &SpaceId, events: &[Opened]) -> Option<UserId> {
    let first = events
        .iter()
        .filter(|e| matches!(e.body, EventBody::SpaceCreate { .. }))
        .min_by_key(|e| (e.lamport, e.author.0, e.seq));
    let derived = state::derived_author(id, events);
    first
        .filter(|_| derived.is_none())
        .map(|e| e.author)
        .or_else(|| {
            events
                .iter()
                .find(|e| Some(e.author.to_string()) == derived)
                .map(|e| e.author)
        })
}

/// Two uppercase letters from the first letters of the first two words, else the first two chars.
pub fn initials_of(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().collect();
    let s: String = if words.len() >= 2 {
        words
            .iter()
            .take(2)
            .filter_map(|w| w.chars().next())
            .collect()
    } else {
        name.trim().chars().take(2).collect()
    };
    s.to_uppercase()
}

/// Folds every input and renders the full snapshot.
pub fn project(ctx: &ProjectionCtx, inputs: &[SpaceInput]) -> Snapshot {
    let states: Vec<state::SpaceState> = inputs.iter().map(|i| fold_pruned(ctx, i)).collect();
    render::World::new(ctx, &states).snapshot()
}

/// All user keys that should appear in `people`.
fn known_users(ctx: &ProjectionCtx, states: &[state::SpaceState]) -> BTreeSet<String> {
    let mut users: BTreeSet<String> = states
        .iter()
        .flat_map(|s| s.authors.iter().cloned())
        .collect();
    users.insert(ctx.me.to_string());
    users
}

/// Sorts and folds one input. Passes repeat until the position-independent facts they derive
/// (removal seq caps, revoked-invite joiner lists) stop changing, so authorization never depends on
/// an author-chosen lamport.
pub(crate) fn fold_input(inp: &SpaceInput) -> state::SpaceState {
    let mut evs: Vec<&Opened> = inp.events.iter().collect();
    evs.sort_by_key(|e| (e.lamport, e.author.0, e.seq));
    let run = |prior: state::Prior| {
        state::SpaceState::new(inp.id, inp.is_home, &inp.name, &inp.kind)
            .with_creator(inp.creator.map(|c| c.to_string()))
            .with_prior(prior)
            .fold(&evs)
    };
    let mut st = run(state::Prior::default());
    for _ in 1..state::MAX_FOLD_PASSES {
        let next = run(st.found.clone());
        let settled = next.found == st.found;
        st = next;
        if settled {
            break;
        }
    }
    st
}

/// Folds one input like [`project`] does (sorted, authorized, pruned).
fn fold_pruned(ctx: &ProjectionCtx, inp: &SpaceInput) -> state::SpaceState {
    let mut st = fold_input(inp);
    let hidden: BTreeSet<String> = ctx
        .hidden
        .iter()
        .filter(|(sp, _)| *sp == inp.id)
        .map(|(_, m)| m.clone())
        .collect();
    st.prune(
        ctx.now_ms,
        &hidden,
        ctx.retention_cutoffs.get(&inp.id).copied(),
    );
    st
}

pub use messaging::{MessagingView, Planned};
pub use render::render_messaging::{Gallery, GalleryItem, MessagePage, MsgHit, SearchFilters};

/// Newest page of one channel (see docs/MESSAGING.md 3.23).
pub fn messages_page(
    ctx: &ProjectionCtx,
    input: &SpaceInput,
    channel: &str,
    before: Option<u64>,
    limit: usize,
) -> MessagePage {
    render::render_messaging::page(ctx, &fold_pruned(ctx, input), channel, before, limit)
}

/// Media, files, links or voice of one channel, newest first.
pub fn media_gallery(
    ctx: &ProjectionCtx,
    input: &SpaceInput,
    channel: &str,
    kind: &str,
    before: Option<u64>,
    limit: usize,
) -> Gallery {
    render::render_messaging::gallery(ctx, &fold_pruned(ctx, input), channel, kind, before, limit)
}

/// Message search with filters across inputs.
pub fn search_messages(
    ctx: &ProjectionCtx,
    inputs: &[SpaceInput],
    filters: &SearchFilters,
) -> Vec<MsgHit> {
    let states: Vec<state::SpaceState> = inputs.iter().map(|i| fold_pruned(ctx, i)).collect();
    render::render_messaging::search(ctx, &states, filters)
}

/// Actions automation rules authored by the local user still owe in one space.
pub fn automation_pending(ctx: &ProjectionCtx, input: &SpaceInput) -> Vec<Planned> {
    fold_pruned(ctx, input).automation_pending(&ctx.me.to_string())
}
