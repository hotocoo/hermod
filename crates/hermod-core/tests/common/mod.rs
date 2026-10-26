//! Shared helpers: build real event logs for pure projection tests.
#![allow(dead_code)]

use std::collections::BTreeMap;

use hermod_core::crypto::blake3_hash;
use hermod_core::event::EventBody;
use hermod_core::identity::Identity;
use hermod_core::ids::{SpaceId, UserId, hex_encode};
use hermod_core::projections::{ProjectionCtx, SpaceInput};
use hermod_core::store::Opened;

/// Fixed clock: 2026-10-15 12:30:00 UTC.
pub const NOW: i64 = 1_792_067_400_000;
pub const MIN: i64 = 60_000;
pub const HOUR: i64 = 3_600_000;
pub const DAY: i64 = 86_400_000;

pub struct Log {
    pub events: Vec<Opened>,
    lamport: u64,
    seqs: BTreeMap<UserId, u64>,
}

impl Log {
    pub fn new() -> Self {
        Log {
            events: Vec::new(),
            lamport: 0,
            seqs: BTreeMap::new(),
        }
    }

    /// Appends with the next global lamport.
    pub fn push(&mut self, who: &UserId, ts: i64, body: EventBody) -> String {
        self.lamport += 1;
        let l = self.lamport;
        self.push_at(who, l, ts, body)
    }

    pub fn push_at(&mut self, who: &UserId, lamport: u64, ts: i64, body: EventBody) -> String {
        let seq = self.seqs.entry(*who).or_insert(0);
        *seq += 1;
        let mut buf = who.0.to_vec();
        buf.extend_from_slice(&seq.to_le_bytes());
        buf.extend_from_slice(&lamport.to_le_bytes());
        let id = hex_encode(&blake3_hash(&buf));
        self.events.push(Opened {
            id: id.clone(),
            author: *who,
            seq: *seq,
            lamport,
            ts,
            arrival: self.events.len() as u64 + 1,
            body,
        });
        id
    }

    pub fn input(&self, id: SpaceId, name: &str, kind: &str, home: bool) -> SpaceInput {
        SpaceInput {
            id,
            name: name.into(),
            kind: kind.into(),
            is_home: home,
            creator: None,
            events: self.events.clone().into(),
        }
    }
}

pub fn user() -> (Identity, UserId) {
    let i = Identity::generate();
    let u = i.user_id();
    (i, u)
}

pub fn ctx(me: UserId) -> ProjectionCtx {
    ProjectionCtx::new(me, NOW)
}

pub fn space_create(name: &str, sections: &[&str]) -> EventBody {
    EventBody::SpaceCreate {
        name: name.into(),
        kind: "Team".into(),
        tagline: "t".into(),
        mono: name[..1].to_uppercase(),
        sections: sections.iter().map(|s| s.to_string()).collect(),
        nonce: None,
    }
}

pub fn profile(name: &str, bio: &str) -> EventBody {
    EventBody::ProfileSet {
        name: name.into(),
        bio: bio.into(),
        initials: String::new(),
        avatar: None,
        x25519: None,
    }
}

pub fn channel(id: &str) -> EventBody {
    EventBody::ChannelCreate {
        channel_id: id.into(),
        name: id.into(),
        topic: format!("about {id}"),
        dm: None,
        guest: false,
    }
}

pub fn post_msg(ch: &str, id: &str, text: &str) -> EventBody {
    EventBody::MessagePost {
        channel_id: ch.into(),
        msg_id: id.into(),
        text: text.into(),
        reply_to: None,
        attachments: vec![],
        snap: None,
        mentions: vec![],
        preview: None,
        target: None,
        ext: None,
    }
}

/// Join redeeming the open invite `inv` (see [`invite`]).
pub fn join() -> EventBody {
    EventBody::MemberJoin {
        via_invite_from: None,
        pow: None,
        invite: Some("inv".into()),
    }
}

/// An unlimited member invite with id `inv`.
pub fn invite() -> EventBody {
    EventBody::InviteCreate {
        id: "inv".into(),
        exp: None,
        max_uses: None,
        role: hermod_core::Role::Member,
    }
}
