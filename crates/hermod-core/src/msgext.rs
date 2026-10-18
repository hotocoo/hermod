//! Wire types for the messaging features (docs/MESSAGING.md section 3). Pure data: the
//! rules that interpret them live in `projections/messaging.rs`.
use serde::{Deserialize, Serialize};

/// Longest message text kept by the fold, in characters.
pub const MAX_TEXT_CHARS: usize = 16_000;
/// Longest inline quote text.
pub const MAX_QUOTE_CHARS: usize = 240;
/// Waveform bars kept for a voice or video note.
pub const MAX_PEAKS: usize = 64;
/// Longest accepted voice or video note in milliseconds.
pub const MAX_NOTE_MS: u32 = 600_000;
/// Per-message lifetime bounds in seconds (5 s to 1 year).
pub const MIN_TTL_SECS: u32 = 5;
pub const MAX_TTL_SECS: u32 = 365 * 24 * 3600;
/// Slowmode ceiling in seconds (6 hours).
pub const MAX_SLOWMODE_SECS: u32 = 21_600;
/// Most forum tags a channel or post may carry.
pub const MAX_TAGS: usize = 20;
pub const MAX_POST_TAGS: usize = 5;
pub const MAX_TAG_CHARS: usize = 32;
pub const MAX_CATEGORY_CHARS: usize = 32;
pub const MAX_AUTOMATIONS: usize = 25;

/// Inline reply: a snapshot of the quoted message taken by the author.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuoteRef {
    pub msg_id: String,
    #[serde(default)]
    pub by: String,
    #[serde(default)]
    pub text: String,
}

/// Forward label: who wrote the original, when, and where it came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Forward {
    pub by: String,
    #[serde(default)]
    pub ts: i64,
    #[serde(default)]
    pub origin: String,
}

/// Voice or video note facts the player needs before the blob arrives.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct VoiceMeta {
    pub dur_ms: u32,
    #[serde(default)]
    pub peaks: Vec<u8>,
}

/// Set on events an automation rule appended (idempotency tag, never re-triggers rules).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutoRef {
    pub id: String,
    pub src: String,
}

/// Everything message-shaped beyond text, replies and attachments.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct MsgExt {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote: Option<QuoteRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fwd: Option<Forward>,
    /// `voice`, `video_note`, `sticker`, `gif`, `poll` or `forum_post`.
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttl_secs: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<AutoRef>,
}

/// What an automation rule listens for.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct AutoTrigger {
    /// `keyword` or `event`.
    pub kind: String,
    #[serde(default)]
    pub channel: String,
    #[serde(default)]
    pub words: Vec<String>,
    /// Event tag for `event` triggers (`member.join`, `ticket.create`, `poll.close`, `post.create`).
    #[serde(default)]
    pub tag: String,
}

/// What an automation rule does.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct AutoAction {
    /// `post_message`, `create_ticket` or `assign_ticket`.
    pub kind: String,
    #[serde(default)]
    pub channel: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub queue: String,
    #[serde(default)]
    pub assignee: String,
}
