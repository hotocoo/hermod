//! SignedEvent (wire and storage form) and the typed EventBody.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::crypto::{self, NONCE_LEN, SpaceKey};
use crate::error::{Error, Result};
use crate::identity::{self, Identity};
use crate::ids::{self, SpaceId, UserId};
pub use crate::msgext::{AutoAction, AutoRef, AutoTrigger, Forward, MsgExt, QuoteRef, VoiceMeta};

/// Largest accepted ciphertext body.
pub const MAX_BODY_BYTES: usize = 1 << 20;
/// Largest accepted serialized event.
pub const MAX_EVENT_BYTES: usize = MAX_BODY_BYTES + 4096;

const DOMAIN: &[u8] = b"hermod/event/v1";

/// One append-only log entry. `body` is `XChaCha20-Poly1305(space_key, CBOR(EventBody))`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedEvent {
    pub space_id: SpaceId,
    pub author: UserId,
    pub seq: u64,
    pub lamport: u64,
    pub ts: i64,
    /// Key epoch the body is sealed under (0 until the first `space.rekey`).
    #[serde(default)]
    pub epoch: u32,
    #[serde(with = "ids::fixed")]
    pub nonce: [u8; NONCE_LEN],
    #[serde(with = "ids::bytes")]
    pub body: Vec<u8>,
    #[serde(with = "ids::fixed")]
    pub sig: [u8; 64],
}

/// A decrypted event body together with its raw form (kept for unknown variants).
#[derive(Debug, Clone, PartialEq)]
pub struct Decoded {
    pub body: EventBody,
    pub raw: Value,
}

impl SignedEvent {
    /// BLAKE3 over every field except the signature. The signature covers this digest.
    pub fn digest(&self) -> [u8; 32] {
        let mut h = blake3::Hasher::new();
        h.update(DOMAIN);
        h.update(&self.space_id.0);
        h.update(&self.author.0);
        h.update(&self.seq.to_le_bytes());
        h.update(&self.lamport.to_le_bytes());
        h.update(&self.ts.to_le_bytes());
        h.update(&self.epoch.to_le_bytes());
        h.update(&self.nonce);
        h.update(&(self.body.len() as u64).to_le_bytes());
        h.update(&self.body);
        *h.finalize().as_bytes()
    }

    /// Event id: hex of the digest.
    pub fn id(&self) -> String {
        ids::hex_encode(&self.digest())
    }

    /// Encrypts `body` under `key`, then signs.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        identity: &Identity,
        key: &SpaceKey,
        epoch: u32,
        space_id: SpaceId,
        seq: u64,
        lamport: u64,
        ts: i64,
        body: &EventBody,
    ) -> Result<Self> {
        let mut plain = Vec::new();
        ciborium::into_writer(body, &mut plain).map_err(|e| Error::Cbor(e.to_string()))?;
        let (nonce, ct) = crypto::seal(key, &plain)?;
        let mut ev = SignedEvent {
            space_id,
            author: identity.user_id(),
            seq,
            lamport,
            ts,
            epoch,
            nonce,
            body: ct,
            sig: [0; 64],
        };
        ev.sig = identity.sign(&ev.digest());
        Ok(ev)
    }

    /// Checks the author's signature.
    pub fn verify(&self) -> Result<()> {
        identity::verify(&self.author, &self.digest(), &self.sig)
    }

    /// Decrypts and decodes the body.
    pub fn open(&self, key: &SpaceKey) -> Result<Decoded> {
        decode_body(&crypto::open(key, &self.nonce, &self.body)?)
    }

    /// Like [`SignedEvent::open`], trying every key held for this event's epoch.
    pub fn open_any(&self, keys: &[SpaceKey]) -> Result<Decoded> {
        for key in keys {
            if let Ok(plain) = crypto::open(key, &self.nonce, &self.body) {
                return decode_body(&plain);
            }
        }
        Err(Error::Decrypt)
    }

    /// CBOR wire form.
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut out = Vec::new();
        ciborium::into_writer(self, &mut out).map_err(|e| Error::Cbor(e.to_string()))?;
        Ok(out)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_EVENT_BYTES {
            return Err(Error::invalid("event", "too large"));
        }
        ciborium::from_reader(bytes).map_err(|e| Error::Cbor(e.to_string()))
    }
}

/// Decodes CBOR plaintext. Unknown `t` values become [`EventBody::Unknown`] with the raw value kept.
pub fn decode_body(plain: &[u8]) -> Result<Decoded> {
    let raw: Value = ciborium::from_reader(plain).map_err(|e| Error::Cbor(e.to_string()))?;
    if !raw.get("t").is_some_and(Value::is_string) {
        return Err(Error::invalid("event body", "missing tag"));
    }
    let body = serde_json::from_value(raw.clone())?;
    Ok(Decoded { body, raw })
}

/// Reference to a content-addressed blob (see [`crate::blobs`]).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct BlobRef {
    /// Blob id: hex BLAKE3 of the manifest.
    pub hash: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub mime: String,
}

/// Space role. Ordering is privilege: `Guest < Member < Admin < Owner`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Guest,
    Member,
    Admin,
    Owner,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Guest => "guest",
            Role::Member => "member",
            Role::Admin => "admin",
            Role::Owner => "owner",
        }
    }
}

fn member_role() -> Role {
    Role::Member
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoryItemIn {
    pub blob: BlobRef,
    #[serde(default)]
    pub caption: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgendaItemIn {
    pub text: String,
    /// User id (base58) who owns the item.
    #[serde(default)]
    pub who: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnIn {
    pub col_id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocBlockIn {
    /// Block kind: `h` heading, `p` paragraph, `q` quote, `t` todo.
    pub k: String,
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocOp {
    Insert,
    Update,
    Delete,
    Toggle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapFileIn {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<BlobRef>,
    #[serde(default)]
    pub adds: u32,
    #[serde(default)]
    pub dels: u32,
}

/// Space key for the next epoch, sealed to one member (see [`crate::keywrap`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyWrap {
    pub user: String,
    /// Hex of `eph_pub || nonce || ciphertext`.
    pub sealed_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChapterIn {
    /// Start offset in seconds.
    pub t: u32,
    pub title: String,
}

/// Link preview fetched on the sender's device so receivers never fetch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkPreview {
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<BlobRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeskQueueIn {
    pub queue_id: String,
    pub name: String,
    #[serde(default)]
    pub desc: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeskFieldIn {
    pub field_id: String,
    pub label: String,
    /// `text`, `number`, `select`, `date` or `checkbox`.
    pub kind: String,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeskSlaIn {
    /// `low`, `normal`, `high` or `urgent`.
    pub priority: String,
    pub first_response_mins: u32,
    pub resolve_mins: u32,
}

/// Working hours: fixed UTC offset (`UTC`, `+08:00`, `-0530`), weekdays (0 = Sunday) and the
/// daily window in minutes after local midnight.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BusinessHoursIn {
    pub tz: String,
    pub days: Vec<u8>,
    pub start: u32,
    pub end: u32,
}

/// One step of a macro. The UI applies a macro as ordinary events; the core only stores it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct MacroActionIn {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_priority: Option<String>,
    #[serde(default)]
    pub add_tags: Vec<String>,
    /// User id, or empty to unassign.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assign: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// The comment is an internal note.
    #[serde(default)]
    pub internal: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ViewFilterIn {
    #[serde(default)]
    pub status: Vec<String>,
    #[serde(default)]
    pub priority: Vec<String>,
    #[serde(default)]
    pub queue: Vec<String>,
    #[serde(default)]
    pub assignee: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// A quiz question; `answer_hash` commits to the right option (see `games::quiz_commitment`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuizQuestionIn {
    pub q: String,
    pub options: Vec<String>,
    pub answer_hash: String,
}

/// An opened quiz commitment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuizOpenIn {
    pub answer: u32,
    pub salt: String,
}

/// Every event type (`{"t": "...", ...}`). Unknown tags decode to `Unknown`; the ciphertext is
/// stored untouched so relays and later versions lose nothing.
/// Map styles a space default may name (see src/scene/styles).
pub const MAP_STYLES: [&str; 2] = ["village", "sanctuary"];
/// True for a known style or the empty string (clear).
pub fn valid_map_style(s: &str) -> bool {
    s.is_empty() || MAP_STYLES.contains(&s)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum EventBody {
    #[serde(rename = "space.create")]
    SpaceCreate {
        name: String,
        kind: String,
        tagline: String,
        mono: String,
        sections: Vec<String>,
        /// Hex nonce the space id was derived from (`SpaceId::derive`). Absent on spaces created before ids were bound to their creator.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        nonce: Option<String>,
    },
    #[serde(rename = "space.update")]
    SpaceUpdate {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tagline: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sections: Option<Vec<String>>,
        /// Space default map style (`village` or `sanctuary`); an empty string clears it. Absent leaves it unchanged.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        map_style: Option<String>,
        /// Leading zero bits a join request must prove (`0` = off, capped by `pow::MAX_JOIN_POW_BITS`). Absent leaves it unchanged.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        join_pow_bits: Option<u8>,
    },
    #[serde(rename = "section.raise")]
    SectionRaise { section: String },
    #[serde(rename = "member.join")]
    MemberJoin {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        via_invite_from: Option<String>,
        /// Id of the `invite.create` this join redeems.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        invite: Option<String>,
        /// Proof-of-work nonce when the space asks for one (see `pow`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pow: Option<u64>,
    },
    #[serde(rename = "member.leave")]
    MemberLeave {},
    #[serde(rename = "member.role")]
    MemberRole { user: String, role: Role },
    #[serde(rename = "member.remove")]
    MemberRemove {
        user: String,
        /// Highest `seq` the remover saw from the target. Later seqs from the target are rejected whatever lamport they claim. Absent on older events.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        last_seq: Option<u64>,
    },
    #[serde(rename = "space.rekey")]
    SpaceRekey { epoch: u32, wraps: Vec<KeyWrap> },
    #[serde(rename = "invite.create")]
    InviteCreate {
        id: String,
        /// Expiry as unix seconds.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exp: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_uses: Option<u32>,
        #[serde(default = "member_role")]
        role: Role,
    },
    #[serde(rename = "invite.revoke")]
    InviteRevoke {
        id: String,
        /// Users the revoker saw joined through this invite. When present, no one else can join through it, whatever lamport they claim. Absent on older events (revocation then applies by fold order).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        joined: Option<Vec<String>>,
    },
    #[serde(rename = "profile.set")]
    ProfileSet {
        name: String,
        #[serde(default)]
        bio: String,
        #[serde(default)]
        initials: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        avatar: Option<BlobRef>,
        /// Hex X25519 public key (informational; wraps derive it from the author key).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        x25519: Option<String>,
    },
    #[serde(rename = "channel.create")]
    ChannelCreate {
        channel_id: String,
        name: String,
        #[serde(default)]
        topic: String,
        /// Other participant (user id) for direct channels.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dm: Option<String>,
        /// Guests may post here.
        #[serde(default)]
        guest: bool,
    },
    #[serde(rename = "message.post")]
    MessagePost {
        channel_id: String,
        msg_id: String,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reply_to: Option<String>,
        #[serde(default)]
        attachments: Vec<BlobRef>,
        /// Snap id of a skein snap shared in the message.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        snap: Option<String>,
        /// User ids mentioned in the text.
        #[serde(default)]
        mentions: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        preview: Option<LinkPreview>,
        /// Post id this message comments on (not shown in the channel).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target: Option<String>,
        /// Messaging extension (docs/MESSAGING.md 3.1).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ext: Option<Box<MsgExt>>,
    },
    #[serde(rename = "message.edit")]
    MessageEdit { msg_id: String, text: String },
    #[serde(rename = "message.delete")]
    MessageDelete { msg_id: String },
    #[serde(rename = "message.pin")]
    MessagePin { msg_id: String },
    #[serde(rename = "reaction.toggle")]
    ReactionToggle { target_id: String, label: String },
    #[serde(rename = "post.create")]
    PostCreate {
        post_id: String,
        /// `photo`, `video` or `note`.
        kind: String,
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        #[serde(default)]
        blobs: Vec<BlobRef>,
        /// Duration label such as `2:14`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dur: Option<String>,
        #[serde(default)]
        chapters: Vec<ChapterIn>,
        /// WebVTT captions blob.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        captions: Option<BlobRef>,
    },
    #[serde(rename = "post.delete")]
    PostDelete { post_id: String },
    #[serde(rename = "story.create")]
    StoryCreate {
        story_id: String,
        items: Vec<StoryItemIn>,
        ttl_secs: u64,
    },
    #[serde(rename = "story.reply")]
    StoryReply {
        story_id: String,
        #[serde(default)]
        text: String,
    },
    #[serde(rename = "story.love")]
    StoryLove { story_id: String },
    #[serde(rename = "like.toggle")]
    LikeToggle { target_id: String },
    #[serde(rename = "save.toggle")]
    SaveToggle { target_id: String },
    #[serde(rename = "live.start")]
    LiveStart { live_id: String, title: String },
    #[serde(rename = "live.end")]
    LiveEnd { live_id: String },
    #[serde(rename = "live.chat")]
    LiveChat { live_id: String, text: String },
    /// `room` names a voice or stage channel; empty is the Space's main hearth room.
    #[serde(rename = "room.join")]
    RoomJoin {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        room: String,
    },
    #[serde(rename = "room.leave")]
    RoomLeave {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        room: String,
    },
    #[serde(rename = "room.state")]
    RoomState {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        room: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        muted: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cam: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        share: Option<bool>,
    },
    #[serde(rename = "meeting.start")]
    MeetingStart {
        topic: String,
        #[serde(default)]
        agenda: Vec<AgendaItemIn>,
    },
    #[serde(rename = "meeting.end")]
    MeetingEnd {},
    #[serde(rename = "agenda.toggle")]
    AgendaToggle { idx: u32 },
    #[serde(rename = "note.add")]
    NoteAdd { text: String },
    #[serde(rename = "board.create")]
    BoardCreate {
        board_id: String,
        name: String,
        #[serde(default)]
        due: String,
        #[serde(default)]
        cols: Vec<ColumnIn>,
    },
    #[serde(rename = "column.create")]
    ColumnCreate {
        board_id: String,
        col_id: String,
        name: String,
    },
    #[serde(rename = "card.create")]
    CardCreate {
        board_id: String,
        card_id: String,
        col_id: String,
        title: String,
        #[serde(default)]
        tag: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        snap: Option<String>,
    },
    #[serde(rename = "card.move")]
    CardMove { card_id: String, col_id: String },
    #[serde(rename = "card.update")]
    CardUpdate {
        card_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tag: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        snap: Option<String>,
        /// User id of the assignee; empty string unassigns; absent leaves it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        assignee: Option<String>,
        /// Due date label (`YYYY-MM-DD`); empty string clears it; absent leaves it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        due: Option<String>,
    },
    #[serde(rename = "card.delete")]
    CardDelete { card_id: String },
    #[serde(rename = "pinboard.create")]
    PinboardCreate { board_id: String, name: String },
    #[serde(rename = "pin.add")]
    PinAdd {
        board_id: String,
        blob: BlobRef,
        title: String,
        #[serde(default)]
        label: String,
    },
    #[serde(rename = "doc.create")]
    DocCreate {
        doc_id: String,
        title: String,
        #[serde(default)]
        kicker: String,
    },
    #[serde(rename = "doc.block")]
    DocBlock {
        doc_id: String,
        op: DocOp,
        block_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        block: Option<DocBlockIn>,
        /// Insert after this block id; `None` appends.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<String>,
    },
    #[serde(rename = "doc.comment")]
    DocComment {
        doc_id: String,
        block_id: String,
        text: String,
    },
    #[serde(rename = "event.create")]
    EventCreate {
        ev_id: String,
        /// Day index in the UI week view.
        day: u32,
        start: f64,
        end: f64,
        title: String,
        #[serde(rename = "where", default)]
        place: String,
        #[serde(default)]
        note: String,
        #[serde(default)]
        meeting: bool,
    },
    #[serde(rename = "event.rsvp")]
    EventRsvp { ev_id: String },
    #[serde(rename = "event.cancel")]
    EventCancel { ev_id: String },
    /// Edits an event; absent fields stay as they are.
    #[serde(rename = "event.update")]
    EventUpdate {
        ev_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        day: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        end: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(rename = "where", default, skip_serializing_if = "Option::is_none")]
        place: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        note: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        meeting: Option<bool>,
    },
    #[serde(rename = "line.create")]
    LineCreate {
        line_id: String,
        name: String,
        #[serde(default)]
        note: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_line: Option<String>,
    },
    #[serde(rename = "snap.create")]
    SnapCreate {
        snap_id: String,
        line_id: String,
        title: String,
        kind: String,
        #[serde(default)]
        files: Vec<SnapFileIn>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent: Option<String>,
    },
    #[serde(rename = "line.weave")]
    LineWeave { line_id: String, into: String },
    #[serde(rename = "letter.send")]
    LetterSend {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to_space: Option<String>,
        channel_id: String,
        text: String,
    },
    #[serde(rename = "content.remove")]
    ContentRemove {
        target_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    #[serde(rename = "content.report")]
    ContentReport {
        target_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    #[serde(rename = "read.mark")]
    ReadMark { channel_id: String, upto: u64 },
    #[serde(rename = "device.link")]
    DeviceLink { device_pub: String, cert: String },
    #[serde(rename = "device.revoke")]
    DeviceRevoke { device_pub: String },
    #[serde(rename = "desk.config")]
    DeskConfig {
        queues: Vec<DeskQueueIn>,
        #[serde(default)]
        fields: Vec<DeskFieldIn>,
        #[serde(default)]
        sla: Vec<DeskSlaIn>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        business_hours: Option<BusinessHoursIn>,
        #[serde(default)]
        csat: bool,
    },
    #[serde(rename = "ticket.create")]
    TicketCreate {
        ticket_id: String,
        #[serde(default)]
        queue_id: String,
        subject: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        priority: String,
        #[serde(default)]
        fields: BTreeMap<String, String>,
        #[serde(default)]
        attachments: Vec<BlobRef>,
    },
    #[serde(rename = "ticket.update")]
    TicketUpdate {
        ticket_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        priority: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        queue_id: Option<String>,
        /// User id; empty string unassigns; absent leaves it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        assignee: Option<String>,
        #[serde(default)]
        tags_add: Vec<String>,
        #[serde(default)]
        tags_remove: Vec<String>,
        #[serde(default)]
        fields: BTreeMap<String, String>,
        /// Due date in ms since epoch; 0 clears it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        due: Option<i64>,
    },
    #[serde(rename = "ticket.comment")]
    TicketComment {
        ticket_id: String,
        comment_id: String,
        body: String,
        #[serde(default)]
        internal: bool,
        #[serde(default)]
        attachments: Vec<BlobRef>,
    },
    #[serde(rename = "ticket.link")]
    TicketLink {
        ticket_id: String,
        /// `duplicate`, `relates`, `blocks` or `child`.
        kind: String,
        /// A ticket id, card id or message id.
        target: String,
    },
    #[serde(rename = "ticket.merge")]
    TicketMerge { ticket_id: String, into: String },
    #[serde(rename = "ticket.csat")]
    TicketCsat {
        ticket_id: String,
        score: u8,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        comment: Option<String>,
    },
    #[serde(rename = "desk.macro")]
    DeskMacro {
        macro_id: String,
        name: String,
        #[serde(default)]
        actions: Vec<MacroActionIn>,
        #[serde(default)]
        deleted: bool,
    },
    #[serde(rename = "desk.view")]
    DeskView {
        view_id: String,
        name: String,
        #[serde(default)]
        filter: ViewFilterIn,
        #[serde(default)]
        sort: String,
        #[serde(default)]
        shared: bool,
        #[serde(default)]
        deleted: bool,
    },
    /// Arcade: a game table. `players` seats named members, `seats` counts open seats.
    #[serde(rename = "game.create")]
    GameCreate {
        game_id: String,
        kind: String,
        #[serde(default)]
        title: String,
        #[serde(default)]
        players: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        seats: Option<u8>,
        #[serde(default)]
        options: Value,
    },
    #[serde(rename = "game.join")]
    GameJoin {
        game_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        seat: Option<u8>,
    },
    #[serde(rename = "game.leave")]
    GameLeave { game_id: String },
    /// One move; `n` is the 1 based move number (must be the next one).
    #[serde(rename = "game.move")]
    GameMove {
        game_id: String,
        #[serde(rename = "move")]
        mv: Value,
        n: u32,
    },
    #[serde(rename = "game.resign")]
    GameResign { game_id: String },
    /// `offer`, `accept` or `decline` a draw.
    #[serde(rename = "game.draw")]
    GameDraw { game_id: String, action: String },
    /// Real-time games only, signed by the host: `scores` maps seated user id to points.
    #[serde(rename = "game.result")]
    GameResult {
        game_id: String,
        #[serde(default)]
        outcome: String,
        #[serde(default)]
        scores: BTreeMap<String, i64>,
    },
    #[serde(rename = "poll.create")]
    PollCreate {
        poll_id: String,
        question: String,
        options: Vec<String>,
        #[serde(default)]
        multi: bool,
        #[serde(default)]
        anonymous: bool,
    },
    #[serde(rename = "poll.vote")]
    PollVote { poll_id: String, choices: Vec<u32> },
    #[serde(rename = "poll.close")]
    PollClose { poll_id: String },
    #[serde(rename = "quiz.create")]
    QuizCreate {
        quiz_id: String,
        #[serde(default)]
        title: String,
        questions: Vec<QuizQuestionIn>,
    },
    /// One answer index per question.
    #[serde(rename = "quiz.answer")]
    QuizAnswer { quiz_id: String, answers: Vec<u32> },
    /// Host opens the commitments: one `{answer, salt}` per question.
    #[serde(rename = "quiz.reveal")]
    QuizReveal {
        quiz_id: String,
        answers: Vec<QuizOpenIn>,
    },
    #[serde(rename = "kudos.give")]
    KudosGive {
        to: String,
        reason: String,
        #[serde(default)]
        emoji: String,
    },
    #[serde(rename = "standup.post")]
    StandupPost {
        day: String,
        #[serde(default)]
        yesterday: String,
        #[serde(default)]
        today: String,
        #[serde(default)]
        blockers: String,
    },
    #[serde(rename = "message.viewed")]
    MessageViewed { msg_id: String },
    #[serde(rename = "thread.state")]
    ThreadState { msg_id: String, archived: bool },
    #[serde(rename = "channel.settings")]
    ChannelSettings {
        channel_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        topic: Option<String>,
        /// `text`, `announcement`, `forum`, `voice` or `stage`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        kind: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        category: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        position: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        slowmode_secs: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ttl_secs: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        send_min: Option<Role>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        view_min: Option<Role>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        manage_min: Option<Role>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mention_min: Option<Role>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tags: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        auto_archive_secs: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        archived: Option<bool>,
    },
    #[serde(rename = "emoji.add")]
    EmojiAdd {
        emoji_id: String,
        name: String,
        blob: BlobRef,
        #[serde(default)]
        deleted: bool,
    },
    #[serde(rename = "sticker.add")]
    StickerAdd {
        sticker_id: String,
        #[serde(default)]
        pack: String,
        name: String,
        blob: BlobRef,
        #[serde(default)]
        emoji: String,
        #[serde(default)]
        deleted: bool,
    },
    #[serde(rename = "profile.ext")]
    ProfileExt {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        banner: Option<BlobRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status_emoji: Option<String>,
        /// Unix ms when the status clears.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status_until: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pronouns: Option<String>,
    },
    #[serde(rename = "member.nick")]
    MemberNick {
        nick: String,
        /// Admin resetting someone else's nickname.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        user: Option<String>,
    },
    /// Invitation to a dm space, key sealed to `to` (docs/MESSAGING.md 3.15).
    #[serde(rename = "dm.invite")]
    DmInvite {
        to: String,
        space_id: String,
        name: String,
        epoch: u32,
        lc: u64,
        invite_id: String,
        #[serde(default)]
        addrs: Vec<String>,
        sealed_key: String,
        #[serde(default)]
        group: bool,
    },
    #[serde(rename = "automation.set")]
    AutomationSet {
        id: String,
        name: String,
        #[serde(default)]
        enabled: bool,
        trigger: AutoTrigger,
        action: AutoAction,
        #[serde(default)]
        deleted: bool,
    },
    /// Any tag this version does not know. Never produced locally.
    #[serde(other)]
    Unknown,
}

impl EventBody {
    /// Every blob this event references (for storage accounting and cache protection).
    pub fn blob_refs(&self) -> Vec<&BlobRef> {
        match self {
            EventBody::ProfileSet { avatar, .. } => avatar.iter().collect(),
            EventBody::MessagePost {
                attachments,
                preview,
                ..
            } => attachments
                .iter()
                .chain(preview.iter().filter_map(|p| p.image.as_ref()))
                .collect(),
            EventBody::PostCreate {
                blobs, captions, ..
            } => blobs.iter().chain(captions.iter()).collect(),
            EventBody::StoryCreate { items, .. } => items.iter().map(|i| &i.blob).collect(),
            EventBody::PinAdd { blob, .. }
            | EventBody::EmojiAdd { blob, .. }
            | EventBody::StickerAdd { blob, .. } => vec![blob],
            EventBody::ProfileExt { banner, .. } => banner.iter().collect(),
            EventBody::TicketCreate { attachments, .. }
            | EventBody::TicketComment { attachments, .. } => attachments.iter().collect(),
            EventBody::SnapCreate { files, .. } => {
                files.iter().filter_map(|f| f.blob.as_ref()).collect()
            }
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make(body: &EventBody) -> (Identity, SpaceKey, SignedEvent) {
        let id = Identity::generate();
        let key = SpaceKey::random();
        let ev = SignedEvent::create(&id, &key, 0, SpaceId::random(), 1, 1, 1000, body).unwrap();
        (id, key, ev)
    }

    fn post() -> EventBody {
        EventBody::MessagePost {
            channel_id: "general".into(),
            msg_id: "m1".into(),
            text: "hi".into(),
            reply_to: None,
            attachments: vec![],
            snap: None,
            mentions: vec![],
            preview: None,
            target: None,
            ext: None,
        }
    }

    #[test]
    fn sign_open_round_trip() {
        let (id, key, ev) = make(&post());
        ev.verify().unwrap();
        assert_eq!(ev.author, id.user_id());
        assert_eq!(ev.open(&key).unwrap().body, post());
        assert_eq!(ev.id().len(), 64);
    }

    #[test]
    fn tampering_any_field_breaks_signature() {
        let (_, _, ev) = make(&post());
        let mut cases = Vec::new();
        for f in 0..6 {
            let mut e = ev.clone();
            match f {
                0 => e.seq += 1,
                1 => e.lamport += 1,
                2 => e.ts += 1,
                3 => e.nonce[0] ^= 1,
                4 => e.body[0] ^= 1,
                _ => e.space_id.0[0] ^= 1,
            }
            cases.push(e);
        }
        for e in cases {
            assert!(matches!(e.verify(), Err(Error::BadSignature)));
        }
        let mut e = ev.clone();
        e.author = Identity::generate().user_id();
        assert!(e.verify().is_err());
    }

    #[test]
    fn wire_round_trip_cbor_and_json() {
        let (_, _, ev) = make(&post());
        let back = SignedEvent::from_bytes(&ev.to_bytes().unwrap()).unwrap();
        assert_eq!(back, ev);
        let j = serde_json::to_string(&ev).unwrap();
        assert_eq!(serde_json::from_str::<SignedEvent>(&j).unwrap(), ev);
        assert!(SignedEvent::from_bytes(&[0xff, 0x00]).is_err());
    }

    #[test]
    fn unknown_variants_are_preserved_as_raw() {
        let raw = json!({"t": "hologram.cast", "power": 9});
        let mut plain = Vec::new();
        ciborium::into_writer(&raw, &mut plain).unwrap();
        let d = decode_body(&plain).unwrap();
        assert_eq!(d.body, EventBody::Unknown);
        assert_eq!(d.raw, raw);
        let mut bad = Vec::new();
        ciborium::into_writer(&json!({"no": "tag"}), &mut bad).unwrap();
        assert!(decode_body(&bad).is_err());
    }

    #[test]
    fn known_tag_with_bad_fields_is_rejected() {
        let mut plain = Vec::new();
        ciborium::into_writer(&json!({"t": "message.post", "text": 5}), &mut plain).unwrap();
        assert!(decode_body(&plain).is_err());
    }

    #[test]
    fn every_variant_round_trips() {
        let blob = BlobRef {
            hash: "ab".repeat(32),
            size: 3,
            name: "n".into(),
            mime: "image/png".into(),
        };
        let bodies = vec![
            EventBody::SpaceCreate {
                name: "S".into(),
                kind: "Team".into(),
                tagline: "t".into(),
                mono: "S".into(),
                sections: vec!["chat".into()],
                nonce: Some("ab".repeat(32)),
            },
            EventBody::MemberLeave {},
            EventBody::RoomJoin {
                room: String::new(),
            },
            EventBody::EventCreate {
                ev_id: "e".into(),
                day: 1,
                start: 10.0,
                end: 10.5,
                title: "t".into(),
                place: "p".into(),
                note: "".into(),
                meeting: true,
            },
            EventBody::EventUpdate {
                ev_id: "e".into(),
                day: Some(2),
                start: Some(9.5),
                end: None,
                title: Some("t".into()),
                place: Some("p".into()),
                note: None,
                meeting: Some(false),
            },
            EventBody::CardUpdate {
                card_id: "k".into(),
                title: None,
                tag: None,
                snap: None,
                assignee: Some("u".into()),
                due: Some("2030-01-02".into()),
            },
            EventBody::StoryCreate {
                story_id: "s".into(),
                items: vec![StoryItemIn {
                    blob: blob.clone(),
                    caption: "c".into(),
                }],
                ttl_secs: 60,
            },
            EventBody::DocBlock {
                doc_id: "d".into(),
                op: DocOp::Toggle,
                block_id: "b".into(),
                block: None,
                after: None,
            },
            EventBody::SnapCreate {
                snap_id: "s".into(),
                line_id: "l".into(),
                title: "t".into(),
                kind: "Code".into(),
                files: vec![SnapFileIn {
                    path: "a.rs".into(),
                    blob: Some(blob),
                    adds: 1,
                    dels: 0,
                }],
                parent: None,
            },
        ];
        for b in bodies {
            let mut plain = Vec::new();
            ciborium::into_writer(&b, &mut plain).unwrap();
            assert_eq!(decode_body(&plain).unwrap().body, b);
        }
    }
}
