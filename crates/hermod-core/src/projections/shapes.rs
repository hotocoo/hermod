//! Typed mirror of the UI data shapes (`src/lib/data/types.ts`, `src/state/dataTypes.ts`).
//! Projections build these and serialize them, so the JSON shape is enforced by the compiler.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::event::BlobRef;
use crate::growth::Growth;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Person {
    pub name: String,
    pub i: String,
    pub role: String,
    /// Avatar blob hash from the member's latest `profile.set`, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub av: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    pub name: String,
    pub mono: String,
    pub kind: String,
    pub tagline: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub online: Option<u32>,
    pub sections: Vec<String>,
    /// Space default map style chosen by an admin (`village` or `sanctuary`); a device override wins.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_channel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meeting_channel: Option<String>,
    pub growth: Growth,
    /// The local user's role in this space.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// True when the local user was removed from this space by an admin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed: Option<bool>,
    /// For a dm space: whether it was started as a group, fixed at creation by its `dm.invite`
    /// (absent while no invite for it is known).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dm: Option<String>,
    pub topic: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unread: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Reaction {
    pub l: String,
    pub n: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mine: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Reply {
    pub by: String,
    pub t: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnapRef {
    pub id: String,
    pub title: String,
    pub line: String,
    pub files: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MeetSummary {
    pub title: String,
    pub dur: String,
    pub notes: u32,
    pub done: u32,
    pub total: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub by: String,
    pub t: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rx: Option<Vec<Reaction>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread: Option<Vec<Reply>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub img: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub att: Option<Vec<BlobRef>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snap: Option<SnapRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meet: Option<MeetSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fresh: Option<bool>,
    /// `author` or `admin` when the message was removed: `text` is then empty (a tombstone).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edited: Option<bool>,
    /// Prior texts, oldest first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history: Option<Vec<EditRev>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<Preview>,
    /// Author is blocked on this device: the UI collapses the message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked: Option<bool>,
    /// Messaging fields (docs/MESSAGING.md 3.1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext: Option<super::messaging::MsgView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EditRev {
    pub t: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Preview {
    pub url: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    pub name: String,
    pub in_room: Vec<String>,
    pub cams: BTreeMap<String, bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<u32>,
    pub topic: String,
    /// User id to muted, for users in the room (`room.state`).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub muted: BTreeMap<String, bool>,
    /// User id to screen sharing.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub share: BTreeMap<String, bool>,
    /// People in each voice or stage channel room, by channel id (the main room is `in_room`).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub channels: BTreeMap<String, Vec<String>>,
    /// The meeting running in the room, with its shared notes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meeting: Option<RoomMeeting>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoomNote {
    pub by: String,
    pub t: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoomMeeting {
    pub topic: String,
    pub at: String,
    pub notes: Vec<RoomNote>,
}

/// Superset of the UI's `AgendaSeed`: also carries `done` and `cur` (the UI's `AgendaItem`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgendaItem {
    pub text: String,
    pub who: String,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub cur: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    pub title: String,
    pub tag: String,
    pub by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snap: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fresh: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Column {
    pub id: String,
    pub name: String,
    pub cards: Vec<Card>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkBoard {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub due: String,
    pub cols: Vec<Column>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkeinLine {
    pub id: String,
    pub name: String,
    pub note: String,
    pub ahead: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkeinFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<BlobRef>,
    pub path: String,
    pub kind: String,
    pub adds: u32,
    pub dels: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub swatches: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lines: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Linked {
    pub label: String,
    pub ch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snap {
    pub id: String,
    pub line: String,
    pub title: String,
    pub by: String,
    pub when: String,
    pub kind: String,
    pub seal: String,
    pub parent: String,
    pub linked: Linked,
    pub files: Vec<SkeinFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weave_of: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Skein {
    pub repo: String,
    pub blurb: String,
    pub lines: Vec<SkeinLine>,
    pub snaps: Vec<Snap>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Post {
    pub id: String,
    pub by: String,
    pub space: String,
    pub title: String,
    pub kind: String,
    pub h: u32,
    pub label: String,
    pub likes: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dur: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments: Option<Vec<Reply>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<BlobRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved: Option<bool>,
    #[serde(default, rename = "spaceId", skip_serializing_if = "Option::is_none")]
    pub space_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Video {
    pub id: String,
    pub title: String,
    pub by: String,
    pub len: u32,
    pub views: String,
    pub when: String,
    pub likes: u32,
    pub label: String,
    pub desc: String,
    pub chapters: Vec<(u32, String)>,
    /// Blob id of the WebVTT captions file, if any.
    #[serde(
        default,
        rename = "captionsBlob",
        skip_serializing_if = "Option::is_none"
    )]
    pub captions_blob: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<BlobRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liked: Option<bool>,
    #[serde(default, rename = "spaceId", skip_serializing_if = "Option::is_none")]
    pub space_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Short {
    pub id: String,
    pub title: String,
    pub views: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<BlobRef>,
    #[serde(default, rename = "spaceId", skip_serializing_if = "Option::is_none")]
    pub space_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveChatLine {
    pub by: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Live {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, rename = "spaceId", skip_serializing_if = "Option::is_none")]
    pub space_id: Option<String>,
    pub title: String,
    pub host: String,
    pub viewers: u32,
    pub chat: Vec<LiveChatLine>,
    pub pool: Vec<LiveChatLine>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoryItem {
    pub label: String,
    pub caption: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<BlobRef>,
    /// Story this item belongs to (stories of one author are merged).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Story {
    /// Newest story of this author.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, rename = "spaceId", skip_serializing_if = "Option::is_none")]
    pub space_id: Option<String>,
    pub by: String,
    pub when: String,
    pub items: Vec<StoryItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loves: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replies: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Media {
    pub videos: Vec<Video>,
    pub captions: Vec<String>,
    pub shorts: Vec<Short>,
    pub live: Live,
    pub stories: Vec<Story>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pin {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<BlobRef>,
    pub h: u32,
    pub label: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PinBoard {
    #[serde(default, rename = "spaceId", skip_serializing_if = "Option::is_none")]
    pub space_id: Option<String>,
    pub id: String,
    pub name: String,
    pub who: String,
    pub pins: Vec<Pin>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocBlock {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub k: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocComment {
    pub by: String,
    pub on: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocVersion {
    pub t: String,
    pub seal: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Doc {
    #[serde(default, rename = "spaceId", skip_serializing_if = "Option::is_none")]
    pub space_id: Option<String>,
    pub id: String,
    pub title: String,
    pub kicker: String,
    pub edited: String,
    pub people: Vec<String>,
    pub blocks: Vec<DocBlock>,
    pub comments: Vec<DocComment>,
    pub versions: Vec<DocVersion>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CalEvent {
    #[serde(default, rename = "spaceId", skip_serializing_if = "Option::is_none")]
    pub space_id: Option<String>,
    /// The local user RSVP'd.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub going: Option<bool>,
    pub id: String,
    pub d: u32,
    pub s: f64,
    pub e: f64,
    pub t: String,
    #[serde(rename = "where")]
    pub place: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meeting: Option<bool>,
    pub note: String,
    pub people: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fresh: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Letter {
    pub by: String,
    pub ch: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RookEntry {
    pub by: String,
    pub sp: String,
    pub ch: String,
    pub text: String,
    pub t: String,
    pub read: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fresh: Option<bool>,
}

/// The `collections` object of the former `Seed`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Collections {
    pub channels: BTreeMap<String, Vec<Channel>>,
    pub messages: BTreeMap<String, Vec<Message>>,
    pub rooms: BTreeMap<String, Room>,
    pub agenda: Vec<AgendaItem>,
    pub workboards: BTreeMap<String, WorkBoard>,
    pub skein: BTreeMap<String, Skein>,
    pub feed: BTreeMap<String, Vec<Post>>,
    pub media: Media,
    pub pinboards: Vec<PinBoard>,
    pub docs: Vec<Doc>,
    pub events: Vec<CalEvent>,
    pub letters: BTreeMap<String, Vec<Letter>>,
    pub inbox: Vec<RookEntry>,
    /// Help Desk per space, as seen by the local user (absent where there is nothing to show).
    #[serde(default)]
    pub desk: BTreeMap<String, super::desk::DeskView>,
    /// Channel settings, custom emoji, stickers, threads, nicknames, DM requests.
    #[serde(default)]
    pub messaging: super::messaging::Messaging,
    /// Arcade per space (absent where nothing happened yet).
    #[serde(default)]
    pub arcade: BTreeMap<String, super::arcade::ArcadeView>,
}

/// The former `Seed` minus `sections` (UI copy lives in `src/config/sections.ts`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    pub people: BTreeMap<String, Person>,
    pub spaces: Vec<Space>,
    pub collections: Collections,
}
