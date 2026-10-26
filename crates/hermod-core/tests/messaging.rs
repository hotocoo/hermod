//! Messaging features (docs/MESSAGING.md): fold rules, projection fields, and the Core facade.

mod common;

use common::*;
use hermod_core::event::*;
use hermod_core::ids::{SpaceId, UserId};
use hermod_core::msgext::{AutoAction, AutoRef, AutoTrigger, Forward, MsgExt, QuoteRef, VoiceMeta};
use hermod_core::projections::shapes::{Message, Snapshot};
use hermod_core::projections::{self, ProjectionCtx, SearchFilters, SpaceInput, project};
use hermod_core::{Core, ProfileInput, Role as CoreRole};

fn blob(name: &str, mime: &str) -> BlobRef {
    BlobRef {
        hash: "cd".repeat(32),
        size: 10,
        name: name.into(),
        mime: mime.into(),
    }
}

struct World {
    sid: SpaceId,
    ada: UserId,
    bea: UserId,
    cai: UserId,
    log: Log,
}

/// Ada owns, Bea and Cai are members, Ada promotes nobody. Channels: general.
fn world() -> World {
    let (_, ada) = user();
    let (_, bea) = user();
    let (_, cai) = user();
    let sid = SpaceId::random();
    let mut log = Log::new();
    let t0 = NOW - DAY;
    log.push(&ada, t0, space_create("Studio", &["chat"]));
    log.push(&ada, t0 + 1, invite());
    for u in [&bea, &cai] {
        log.push(u, t0 + 2, join());
    }
    log.push(&ada, t0 + 3, profile("Ada Okafor", ""));
    log.push(&bea, t0 + 3, profile("Bea Quist", ""));
    log.push(&cai, t0 + 3, profile("Cai Lin", ""));
    log.push(&ada, t0 + 4, channel("general"));
    World {
        sid,
        ada,
        bea,
        cai,
        log,
    }
}

impl World {
    fn input(&self) -> SpaceInput {
        self.log.input(self.sid, "Studio", "Team", false)
    }

    fn snap_for(&self, me: UserId, now: i64) -> Snapshot {
        let mut ctx = ctx(me);
        ctx.now_ms = now;
        project(&ctx, &[self.input()])
    }

    fn msgs(&self, me: UserId, ch: &str) -> Vec<Message> {
        let s = self.snap_for(me, NOW);
        let label = self.sid.to_string();
        s.collections.messages[&format!("{label}/{ch}")].clone()
    }

    fn ids(&self, me: UserId, ch: &str) -> Vec<String> {
        self.msgs(me, ch).into_iter().map(|m| m.id).collect()
    }
}

fn post(ch: &str, id: &str, text: &str, ext: Option<MsgExt>, att: Vec<BlobRef>) -> EventBody {
    EventBody::MessagePost {
        channel_id: ch.into(),
        msg_id: id.into(),
        text: text.into(),
        reply_to: None,
        attachments: att,
        snap: None,
        mentions: vec![],
        preview: None,
        target: None,
        ext: ext.map(Box::new),
    }
}

fn settings(ch: &str) -> EventBody {
    EventBody::ChannelSettings {
        channel_id: ch.into(),
        name: None,
        topic: None,
        kind: None,
        category: None,
        position: None,
        slowmode_secs: None,
        ttl_secs: None,
        send_min: None,
        view_min: None,
        manage_min: None,
        mention_min: None,
        tags: None,
        auto_archive_secs: None,
        archived: None,
    }
}

fn with(mut b: EventBody, f: impl FnOnce(&mut EventBody)) -> EventBody {
    f(&mut b);
    b
}

#[test]
fn message_ext_round_trips_and_projects() {
    let mut w = world();
    let ext = MsgExt {
        quote: Some(QuoteRef {
            msg_id: "m0".into(),
            by: w.bea.to_string(),
            text: "x".repeat(400),
        }),
        fwd: Some(Forward {
            by: w.bea.to_string(),
            ts: 5,
            origin: "Elsewhere".into(),
        }),
        kind: Some("voice".into()),
        voice: Some(VoiceMeta {
            dur_ms: 9_999_999,
            peaks: vec![7; 200],
        }),
        ..MsgExt::default()
    };
    let body = post(
        "general",
        "m1",
        "",
        Some(ext),
        vec![blob("v.webm", "audio/webm")],
    );
    let mut plain = Vec::new();
    ciborium::into_writer(&body, &mut plain).unwrap();
    assert_eq!(hermod_core::event::decode_body(&plain).unwrap().body, body);
    w.log.push(&w.bea, NOW - 5 * MIN, body);
    let m = &w.msgs(w.ada, "general")[0];
    let x = m.ext.as_ref().unwrap();
    assert_eq!(x.kind.as_deref(), Some("voice"));
    assert_eq!(
        x.quote.as_ref().unwrap().text.chars().count(),
        240,
        "quote clipped"
    );
    assert_eq!(x.fwd.as_ref().unwrap().origin, "Elsewhere");
    let v = x.voice.as_ref().unwrap();
    assert_eq!((v.dur_ms, v.peaks.len()), (600_000, 64), "voice bounded");
    assert!(x.lp > 0);
}

#[test]
fn kind_without_what_it_needs_is_dropped() {
    let mut w = world();
    let bad = MsgExt {
        kind: Some("voice".into()),
        ..MsgExt::default()
    };
    w.log.push(
        &w.bea,
        NOW - MIN,
        post("general", "m1", "hi", Some(bad), vec![]),
    );
    let sticker = MsgExt {
        kind: Some("hologram".into()),
        ..MsgExt::default()
    };
    w.log.push(
        &w.bea,
        NOW - MIN + 1,
        post("general", "m2", "yo", Some(sticker), vec![]),
    );
    for m in w.msgs(w.ada, "general") {
        assert_eq!(m.ext.unwrap().kind, None);
    }
}

#[test]
fn announcement_channel_blocks_member_posts_but_not_reactions() {
    let mut w = world();
    w.log.push(
        &w.ada,
        NOW - 50 * MIN,
        with(settings("general"), |b| {
            if let EventBody::ChannelSettings { kind, .. } = b {
                *kind = Some("announcement".into());
            }
        }),
    );
    w.log.push(
        &w.bea,
        NOW - 40 * MIN,
        post("general", "b1", "hello", None, vec![]),
    );
    w.log.push(
        &w.ada,
        NOW - 39 * MIN,
        post("general", "a1", "news", None, vec![]),
    );
    w.log.push(
        &w.bea,
        NOW - 38 * MIN,
        EventBody::ReactionToggle {
            target_id: "a1".into(),
            label: "🎉".into(),
        },
    );
    assert_eq!(w.ids(w.cai, "general"), vec!["a1"]);
    let m = &w.msgs(w.cai, "general")[0];
    assert_eq!(m.rx.as_ref().unwrap()[0].l, "🎉");
    let cfg = &w.snap_for(w.bea, NOW).collections.messaging.spaces[&w.sid.to_string()].channels["general"];
    assert!(!cfg.can_send && cfg.kind == "announcement");
    let cfg = &w.snap_for(w.ada, NOW).collections.messaging.spaces[&w.sid.to_string()].channels["general"];
    assert!(cfg.can_send && cfg.can_manage);
}

#[test]
fn slowmode_drops_fast_member_posts_and_exempts_admins() {
    let mut w = world();
    w.log.push(
        &w.ada,
        NOW - 60 * MIN,
        with(settings("general"), |b| {
            if let EventBody::ChannelSettings { slowmode_secs, .. } = b {
                *slowmode_secs = Some(30);
            }
        }),
    );
    let t = NOW - 50 * MIN;
    w.log
        .push(&w.bea, t, post("general", "b1", "one", None, vec![]));
    w.log.push(
        &w.bea,
        t + 10_000,
        post("general", "b2", "too fast", None, vec![]),
    );
    w.log.push(
        &w.bea,
        t + 31_000,
        post("general", "b3", "ok", None, vec![]),
    );
    w.log.push(
        &w.cai,
        t + 11_000,
        post("general", "c1", "other member", None, vec![]),
    );
    w.log.push(
        &w.ada,
        t + 12_000,
        post("general", "a1", "admin one", None, vec![]),
    );
    w.log.push(
        &w.ada,
        t + 13_000,
        post("general", "a2", "admin two", None, vec![]),
    );
    assert_eq!(
        w.ids(w.ada, "general"),
        vec!["b1", "b3", "c1", "a1", "a2"],
        "b2 was inside the window"
    );
}

#[test]
fn channel_settings_need_a_manager_and_cannot_raise_floors_above_the_setter() {
    let mut w = world();
    w.log.push(
        &w.bea,
        NOW - 50 * MIN,
        with(settings("general"), |b| {
            if let EventBody::ChannelSettings { slowmode_secs, .. } = b {
                *slowmode_secs = Some(99);
            }
        }),
    );
    w.log.push(
        &w.ada,
        NOW - 49 * MIN,
        with(settings("nowhere"), |b| {
            if let EventBody::ChannelSettings { slowmode_secs, .. } = b {
                *slowmode_secs = Some(5);
            }
        }),
    );
    w.log.push(
        &w.ada,
        NOW - 48 * MIN,
        with(settings("general"), |b| {
            if let EventBody::ChannelSettings {
                send_min,
                slowmode_secs,
                ..
            } = b
            {
                *send_min = Some(Role::Owner);
                *slowmode_secs = Some(21_601);
            }
        }),
    );
    let view = &w.snap_for(w.ada, NOW).collections.messaging.spaces[&w.sid.to_string()].channels["general"];
    assert_eq!(
        view.slowmode_secs, 0,
        "member and out-of-range settings ignored"
    );
    assert_eq!(view.send_min, Role::Member);
    w.log.push(
        &w.ada,
        NOW - 47 * MIN,
        with(settings("general"), |b| {
            if let EventBody::ChannelSettings {
                send_min,
                slowmode_secs,
                category,
                ..
            } = b
            {
                *send_min = Some(Role::Admin);
                *slowmode_secs = Some(10);
                *category = Some("  Team talk ".into());
            }
        }),
    );
    let view = &w.snap_for(w.ada, NOW).collections.messaging.spaces[&w.sid.to_string()].channels["general"];
    assert_eq!(
        (view.slowmode_secs, view.send_min, view.category.as_str()),
        (10, Role::Admin, "Team talk")
    );
}

#[test]
fn disappearing_messages_vanish_after_the_channel_or_message_timer() {
    let mut w = world();
    w.log.push(
        &w.ada,
        NOW - 3 * HOUR,
        with(settings("general"), |b| {
            if let EventBody::ChannelSettings { ttl_secs, .. } = b {
                *ttl_secs = Some(3600);
            }
        }),
    );
    w.log.push(
        &w.bea,
        NOW - 2 * HOUR,
        post("general", "old", "gone", None, vec![]),
    );
    w.log.push(
        &w.bea,
        NOW - 30 * MIN,
        post("general", "new", "here", None, vec![]),
    );
    let short = MsgExt {
        ttl_secs: Some(60),
        ..MsgExt::default()
    };
    w.log.push(
        &w.bea,
        NOW - 10 * MIN,
        post("general", "short", "brief", Some(short), vec![]),
    );
    assert_eq!(w.ids(w.ada, "general"), vec!["new"]);
    let later = w.snap_for(w.ada, NOW + 31 * MIN);
    let key = format!("{}/general", w.sid);
    assert!(later.collections.messages[&key].is_empty());
    let early = w.snap_for(w.ada, NOW - 90 * MIN);
    let ids: Vec<_> = early.collections.messages[&key]
        .iter()
        .map(|m| m.id.as_str())
        .collect();
    assert_eq!(
        ids,
        vec!["old", "new", "short"],
        "evaluated at the render clock, not at fold time"
    );
}

#[test]
fn view_once_media_is_removed_from_the_viewers_projection_after_opening() {
    let mut w = world();
    let ext = MsgExt {
        view_once: true,
        ..MsgExt::default()
    };
    w.log.push(
        &w.bea,
        NOW - 20 * MIN,
        post(
            "general",
            "v1",
            "",
            Some(ext),
            vec![blob("p.png", "image/png")],
        ),
    );
    assert!(w.msgs(w.cai, "general")[0].att.is_some());
    w.log.push(
        &w.cai,
        NOW - 19 * MIN,
        EventBody::MessageViewed {
            msg_id: "v1".into(),
        },
    );
    w.log.push(
        &w.bea,
        NOW - 18 * MIN,
        EventBody::MessageViewed {
            msg_id: "v1".into(),
        },
    );
    let theirs = &w.msgs(w.cai, "general")[0];
    assert!(theirs.att.is_none() && theirs.ext.as_ref().unwrap().viewed);
    let mine = &w.msgs(w.bea, "general")[0];
    assert!(mine.att.is_some(), "the author keeps their own copy");
    assert_eq!(
        mine.ext.as_ref().unwrap().opened,
        vec![w.cai.to_string()],
        "author sees who opened; self-view ignored"
    );
}

#[test]
fn read_receipts_report_who_has_read_up_to_a_message() {
    let mut w = world();
    w.log.push(
        &w.bea,
        NOW - 30 * MIN,
        post("general", "m1", "a", None, vec![]),
    );
    w.log.push(
        &w.bea,
        NOW - 29 * MIN,
        post("general", "m2", "b", None, vec![]),
    );
    let lp1 = w.msgs(w.bea, "general")[0].ext.as_ref().unwrap().lp;
    w.log.push(
        &w.cai,
        NOW - 28 * MIN,
        EventBody::ReadMark {
            channel_id: "general".into(),
            upto: lp1,
        },
    );
    let ms = w.msgs(w.bea, "general");
    assert_eq!(ms[0].ext.as_ref().unwrap().seen_by, vec![w.cai.to_string()]);
    assert!(ms[1].ext.as_ref().unwrap().seen_by.is_empty());
    w.log.push(
        &w.cai,
        NOW - 27 * MIN,
        EventBody::ReadMark {
            channel_id: "general".into(),
            upto: 1,
        },
    );
    assert_eq!(
        w.msgs(w.bea, "general")[0]
            .ext
            .as_ref()
            .unwrap()
            .seen_by
            .len(),
        1,
        "markers only move forward"
    );
}

#[test]
fn forum_posts_need_a_title_and_list_as_threads_with_auto_archive() {
    let mut w = world();
    w.log.push(&w.ada, NOW - 10 * DAY, channel("help"));
    w.log.push(
        &w.ada,
        NOW - 10 * DAY + 1,
        with(settings("help"), |b| {
            if let EventBody::ChannelSettings {
                kind,
                tags,
                auto_archive_secs,
                ..
            } = b
            {
                *kind = Some("forum".into());
                *tags = Some(vec!["bug".into(), "idea".into()]);
                *auto_archive_secs = Some(86_400);
            }
        }),
    );
    w.log.push(
        &w.bea,
        NOW - 9 * DAY,
        post("help", "p0", "no title", None, vec![]),
    );
    let ext = MsgExt {
        kind: Some("forum_post".into()),
        title: Some("Kiln will not heat".into()),
        tags: vec!["bug".into()],
        ..MsgExt::default()
    };
    w.log.push(
        &w.bea,
        NOW - 9 * DAY + 1,
        post("help", "p1", "details", Some(ext.clone()), vec![]),
    );
    w.log.push(
        &w.bea,
        NOW - 2 * HOUR,
        post(
            "help",
            "p2",
            "fresh",
            Some(MsgExt {
                title: Some("Glaze".into()),
                ..ext
            }),
            vec![],
        ),
    );
    w.log.push(
        &w.cai,
        NOW - 8 * DAY,
        EventBody::MessagePost {
            channel_id: "help".into(),
            msg_id: "r1".into(),
            text: "try the breaker".into(),
            reply_to: Some("p1".into()),
            attachments: vec![],
            snap: None,
            mentions: vec![],
            preview: None,
            target: None,
            ext: None,
        },
    );
    assert_eq!(w.ids(w.ada, "help"), vec!["p1", "p2"]);
    let v = &w.snap_for(w.ada, NOW).collections.messaging.spaces[&w.sid.to_string()];
    let threads = &v.threads["help"];
    assert_eq!(threads[0].id, "p2");
    assert!(!threads[0].archived);
    assert!(
        threads[1].archived && threads[1].replies == 1,
        "idle past auto-archive"
    );
    assert_eq!(threads[1].title, "Kiln will not heat");
    w.log.push(
        &w.cai,
        NOW - MIN,
        EventBody::MessagePost {
            channel_id: "help".into(),
            msg_id: "r2".into(),
            text: "any news?".into(),
            reply_to: Some("p1".into()),
            attachments: vec![],
            snap: None,
            mentions: vec![],
            preview: None,
            target: None,
            ext: None,
        },
    );
    let v = &w.snap_for(w.ada, NOW).collections.messaging.spaces[&w.sid.to_string()];
    assert!(
        v.threads["help"].iter().all(|t| !t.archived),
        "a new reply reopens the thread"
    );
    w.log.push(
        &w.bea,
        NOW - 30_000,
        EventBody::ThreadState {
            msg_id: "p2".into(),
            archived: true,
        },
    );
    let v = &w.snap_for(w.ada, NOW).collections.messaging.spaces[&w.sid.to_string()];
    assert!(
        v.threads["help"]
            .iter()
            .find(|t| t.id == "p2")
            .unwrap()
            .archived
    );
    w.log.push(
        &w.cai,
        NOW - 20_000,
        EventBody::ThreadState {
            msg_id: "p2".into(),
            archived: false,
        },
    );
    let v = &w.snap_for(w.ada, NOW).collections.messaging.spaces[&w.sid.to_string()];
    assert!(
        v.threads["help"]
            .iter()
            .find(|t| t.id == "p2")
            .unwrap()
            .archived,
        "only the author or an admin changes thread state"
    );
}

#[test]
fn custom_emoji_and_stickers_follow_ownership_and_name_rules() {
    let mut w = world();
    let img = blob("e.png", "image/png");
    let add = |id: &str, name: &str, b: &BlobRef| EventBody::EmojiAdd {
        emoji_id: id.into(),
        name: name.into(),
        blob: b.clone(),
        deleted: false,
    };
    w.log
        .push(&w.bea, NOW - 50 * MIN, add("e1", "party_parrot", &img));
    w.log
        .push(&w.cai, NOW - 49 * MIN, add("e2", "party_parrot", &img));
    w.log
        .push(&w.cai, NOW - 48 * MIN, add("e3", "Bad Name", &img));
    w.log.push(
        &w.cai,
        NOW - 47 * MIN,
        add(
            "e4",
            "big",
            &BlobRef {
                size: 999_999,
                ..img.clone()
            },
        ),
    );
    w.log.push(
        &w.cai,
        NOW - 46 * MIN,
        add("e5", "doc", &blob("d.pdf", "application/pdf")),
    );
    w.log.push(
        &w.cai,
        NOW - 45 * MIN,
        EventBody::EmojiAdd {
            emoji_id: "e1".into(),
            name: "party_parrot".into(),
            blob: img.clone(),
            deleted: true,
        },
    );
    let names = |w: &World| {
        w.snap_for(w.ada, NOW).collections.messaging.spaces[&w.sid.to_string()]
            .emoji
            .iter()
            .map(|e| e.name.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        names(&w),
        vec!["party_parrot"],
        "duplicate, invalid, oversize, non-image and foreign delete rejected"
    );
    w.log.push(
        &w.ada,
        NOW - 44 * MIN,
        EventBody::EmojiAdd {
            emoji_id: "e1".into(),
            name: "party_parrot".into(),
            blob: img.clone(),
            deleted: true,
        },
    );
    assert!(names(&w).is_empty(), "admins may delete any emoji");
    w.log.push(
        &w.bea,
        NOW - 43 * MIN,
        EventBody::StickerAdd {
            sticker_id: "s1".into(),
            pack: "".into(),
            name: "wave".into(),
            blob: img.clone(),
            emoji: "👋".into(),
            deleted: false,
        },
    );
    let v = &w.snap_for(w.ada, NOW).collections.messaging.spaces[&w.sid.to_string()];
    assert_eq!(
        (v.stickers[0].pack.as_str(), v.stickers[0].name.as_str()),
        ("Stickers", "wave")
    );
    assert!(
        EventBody::EmojiAdd {
            emoji_id: "x".into(),
            name: "ab".into(),
            blob: img,
            deleted: false
        }
        .blob_refs()
        .len()
            == 1
    );
}

#[test]
fn everyone_mentions_need_the_right_role() {
    let mut w = world();
    w.log.push(
        &w.bea,
        NOW - 10 * MIN,
        post("general", "m1", "hey @everyone look", None, vec![]),
    );
    w.log.push(
        &w.ada,
        NOW - 9 * MIN,
        post("general", "m2", "@here and @everyone!", None, vec![]),
    );
    w.log.push(
        &w.ada,
        NOW - 8 * MIN,
        post("general", "m3", "mail me@everyone.dev", None, vec![]),
    );
    let ms = w.msgs(w.cai, "general");
    let flags: Vec<_> = ms
        .iter()
        .map(|m| {
            let x = m.ext.as_ref().unwrap();
            (x.everyone, x.here)
        })
        .collect();
    assert_eq!(flags, vec![(false, false), (true, true), (false, false)]);
    w.log.push(
        &w.ada,
        NOW - 7 * MIN,
        with(settings("general"), |b| {
            if let EventBody::ChannelSettings { mention_min, .. } = b {
                *mention_min = Some(Role::Member);
            }
        }),
    );
    w.log.push(
        &w.bea,
        NOW - 6 * MIN,
        post("general", "m4", "@everyone now allowed", None, vec![]),
    );
    assert!(w.msgs(w.cai, "general")[3].ext.as_ref().unwrap().everyone);
}

#[test]
fn nicknames_and_profile_extras() {
    let mut w = world();
    w.log.push(
        &w.bea,
        NOW - 9 * MIN,
        EventBody::MemberNick {
            nick: "Bee".into(),
            user: None,
        },
    );
    w.log.push(
        &w.bea,
        NOW - 8 * MIN,
        EventBody::MemberNick {
            nick: "Hijack".into(),
            user: Some(w.cai.to_string()),
        },
    );
    w.log.push(
        &w.ada,
        NOW - 7 * MIN,
        EventBody::MemberNick {
            nick: "Cy".into(),
            user: Some(w.cai.to_string()),
        },
    );
    w.log.push(
        &w.ada,
        NOW - 6 * MIN,
        EventBody::MemberNick {
            nick: "Boss".into(),
            user: Some(w.ada.to_string()),
        },
    );
    w.log.push(
        &w.bea,
        NOW - 5 * MIN,
        EventBody::ProfileExt {
            banner: Some(blob("b.png", "image/png")),
            status: Some("In the kiln".into()),
            status_emoji: Some("🔥".into()),
            status_until: Some(NOW + HOUR),
            pronouns: Some("she/her".into()),
        },
    );
    w.log.push(
        &w.cai,
        NOW - 4 * MIN,
        EventBody::ProfileExt {
            banner: None,
            status: Some("away".into()),
            status_emoji: None,
            status_until: Some(NOW - MIN),
            pronouns: None,
        },
    );
    let v = &w.snap_for(w.ada, NOW).collections.messaging.spaces[&w.sid.to_string()];
    assert_eq!(v.nicks[&w.bea.to_string()], "Bee");
    assert_eq!(
        v.nicks[&w.cai.to_string()],
        "Cy",
        "only admins set someone else's nickname"
    );
    assert_eq!(v.nicks[&w.ada.to_string()], "Boss");
    let p = &v.profiles[&w.bea.to_string()];
    assert_eq!(
        (
            p.status.as_str(),
            p.status_emoji.as_str(),
            p.pronouns.as_str()
        ),
        ("In the kiln", "🔥", "she/her")
    );
    assert!(p.banner.is_some());
    assert_eq!(
        v.profiles[&w.cai.to_string()].status,
        "",
        "expired status is hidden"
    );
}

#[test]
fn dm_requests_show_only_to_the_addressee_until_joined_and_skip_blocked() {
    let mut w = world();
    let dm = SpaceId::random();
    let invite = EventBody::DmInvite {
        to: w.cai.to_string(),
        space_id: dm.to_string(),
        name: "Direct message".into(),
        epoch: 0,
        lc: 3,
        invite_id: "i1".into(),
        addrs: vec![],
        sealed_key: "00".repeat(80),
        group: false,
    };
    w.log.push(&w.bea, NOW - 10 * MIN, invite);
    let reqs = |w: &World, me: UserId, blocked: bool| {
        let mut c: ProjectionCtx = ctx(me);
        if blocked {
            c.blocks.insert(w.bea.to_string());
        }
        project(&c, &[w.input()]).collections.messaging.dm_requests
    };
    assert_eq!(reqs(&w, w.cai, false).len(), 1);
    assert_eq!(reqs(&w, w.cai, false)[0].from, w.bea.to_string());
    assert!(
        reqs(&w, w.ada, false).is_empty(),
        "other members never see it as theirs"
    );
    assert!(
        reqs(&w, w.cai, true).is_empty(),
        "blocked senders are dropped"
    );
    let mut c = ctx(w.cai);
    c.now_ms = NOW;
    let joined = SpaceInput {
        id: dm,
        name: "dm".into(),
        kind: "dm".into(),
        is_home: false,
        creator: None,
        events: vec![],
    };
    let s = project(&c, &[w.input(), joined]);
    assert!(
        s.collections.messaging.dm_requests.is_empty(),
        "joined spaces are no longer requests"
    );
}

#[test]
fn automations_plan_idempotent_actions_authored_by_the_rule_owner() {
    let mut w = world();
    let rule = |kw: &str| EventBody::AutomationSet {
        id: "r1".into(),
        name: "Kiln alerts".into(),
        enabled: true,
        trigger: AutoTrigger {
            kind: "keyword".into(),
            channel: "general".into(),
            words: vec![kw.into()],
            tag: String::new(),
        },
        action: AutoAction {
            kind: "post_message".into(),
            channel: "general".into(),
            text: "Ticket noted: {{text}}".into(),
            ..AutoAction::default()
        },
        deleted: false,
    };
    w.log.push(&w.bea, NOW - 50 * MIN, rule("kiln"));
    w.log.push(&w.ada, NOW - 49 * MIN, rule("kiln"));
    w.log.push(
        &w.bea,
        NOW - 48 * MIN,
        post("general", "m1", "the Kiln is out", None, vec![]),
    );
    w.log.push(
        &w.bea,
        NOW - 47 * MIN,
        post("general", "m2", "lunch?", None, vec![]),
    );
    let plan = |w: &World, me: UserId| projections::automation_pending(&ctx(me), &w.input());
    assert!(plan(&w, w.bea).is_empty(), "members cannot author rules");
    let p = plan(&w, w.ada);
    assert_eq!(p.len(), 1);
    let EventBody::MessagePost {
        msg_id, text, ext, ..
    } = &p[0].body
    else {
        panic!("post_message")
    };
    assert_eq!(text, "Ticket noted: the Kiln is out");
    assert_eq!(
        ext.as_ref().unwrap().auto,
        Some(AutoRef {
            id: "r1".into(),
            src: p[0].src.clone()
        })
    );
    w.log.push(&w.ada, NOW - 46 * MIN, p[0].body.clone());
    assert!(
        plan(&w, w.ada).is_empty(),
        "the answered event is not answered twice"
    );
    w.log.push(
        &w.ada,
        NOW - 45 * MIN,
        post(
            "general",
            "m3",
            "kiln again",
            Some(MsgExt {
                auto: Some(AutoRef {
                    id: "r1".into(),
                    src: "x".into(),
                }),
                ..MsgExt::default()
            }),
            vec![],
        ),
    );
    assert!(
        plan(&w, w.ada).is_empty(),
        "automation output never retriggers a rule"
    );
    assert!(msg_id.starts_with("auto-"));
}

#[test]
fn paging_gallery_and_search_filters() {
    let mut w = world();
    for i in 0..120 {
        w.log.push(
            &w.bea,
            NOW - DAY / 2 + i * MIN,
            post(
                "general",
                &format!("m{i}"),
                &format!("note {i} kiln"),
                None,
                vec![],
            ),
        );
    }
    w.log.push(
        &w.cai,
        NOW - 20 * MIN,
        post(
            "general",
            "pic",
            "see https://example.org/x.",
            None,
            vec![blob("kiln.png", "image/png")],
        ),
    );
    w.log.push(
        &w.cai,
        NOW - 19 * MIN,
        post(
            "general",
            "doc",
            "",
            None,
            vec![blob("plan.pdf", "application/pdf")],
        ),
    );
    let ext = MsgExt {
        kind: Some("voice".into()),
        voice: Some(VoiceMeta {
            dur_ms: 3000,
            peaks: vec![1, 2],
        }),
        ..MsgExt::default()
    };
    w.log.push(
        &w.cai,
        NOW - 18 * MIN,
        post(
            "general",
            "vn",
            "",
            Some(ext),
            vec![blob("n.webm", "audio/webm")],
        ),
    );
    let mut c = ctx(w.ada);
    c.now_ms = NOW;
    let input = w.input();
    let p1 = projections::messages_page(&c, &input, "general", None, 50);
    assert_eq!(p1.messages.len(), 50);
    assert!(p1.has_more);
    assert_eq!(p1.messages.last().unwrap().id, "vn");
    let p2 = projections::messages_page(&c, &input, "general", Some(p1.first_lp), 50);
    assert_eq!(p2.messages.len(), 50);
    assert!(p2.messages.last().unwrap().ext.as_ref().unwrap().lp < p1.first_lp);
    let p3 = projections::messages_page(&c, &input, "general", Some(p2.first_lp), 200);
    assert!(!p3.has_more);
    assert_eq!(p3.messages.len(), 123 - 100);
    let g = |kind: &str| projections::media_gallery(&c, &input, "general", kind, None, 50);
    assert_eq!(g("media").items.len(), 1);
    assert_eq!(g("files").items[0].title.as_deref(), Some("plan.pdf"));
    assert_eq!(g("voice").items.len(), 1);
    assert_eq!(
        g("links").items[0].url.as_deref(),
        Some("https://example.org/x")
    );
    let f = |q: &str| SearchFilters {
        q: q.into(),
        limit: 50,
        ..SearchFilters::default()
    };
    let hits = projections::search_messages(&c, std::slice::from_ref(&input), &f("note 7 "));
    assert!(hits.iter().any(|h| h.id == "m7"));
    assert!(
        hits.iter()
            .all(|h| h.text.contains("note") && h.text.contains('7')),
        "every word must match"
    );
    let by_cai = SearchFilters {
        from: Some("cai".into()),
        ..f("")
    };
    assert_eq!(
        projections::search_messages(&c, std::slice::from_ref(&input), &by_cai).len(),
        3
    );
    let has_file = SearchFilters {
        has: Some("file".into()),
        ..f("")
    };
    assert_eq!(
        projections::search_messages(&c, std::slice::from_ref(&input), &has_file).len(),
        3
    );
    let has_link = SearchFilters {
        has: Some("link".into()),
        ..f("")
    };
    assert_eq!(
        projections::search_messages(&c, std::slice::from_ref(&input), &has_link).len(),
        1
    );
    let in_none = SearchFilters {
        channel: Some("nowhere".into()),
        ..f("")
    };
    assert!(projections::search_messages(&c, std::slice::from_ref(&input), &in_none).is_empty());
    let before = SearchFilters {
        before_ms: Some(NOW - 12 * HOUR),
        ..f("")
    };
    assert!(projections::search_messages(&c, std::slice::from_ref(&input), &before).is_empty());
    let after = SearchFilters {
        after_ms: Some(NOW - 30 * MIN),
        ..f("")
    };
    assert_eq!(
        projections::search_messages(&c, std::slice::from_ref(&input), &after).len(),
        3
    );
}

#[test]
fn hidden_messages_drop_out_of_every_view() {
    let mut w = world();
    w.log.push(
        &w.bea,
        NOW - 5 * MIN,
        post("general", "m1", "keep", None, vec![]),
    );
    w.log.push(
        &w.bea,
        NOW - 4 * MIN,
        post("general", "m2", "hide me", None, vec![]),
    );
    let mut c = ctx(w.ada);
    c.hidden.insert((w.sid, "m2".into()));
    let s = project(&c, &[w.input()]);
    let list = &s.collections.messages[&format!("{}/general", w.sid)];
    assert_eq!(
        list.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        vec!["m1"]
    );
    assert!(s.collections.inbox.iter().all(|r| r.text != "hide me"));
}

// ---- Core facade -------------------------------------------------------------------------

fn core() -> (tempfile::TempDir, Core) {
    let dir = tempfile::tempdir().unwrap();
    let c = Core::open(dir.path()).unwrap();
    (dir, c)
}

fn sync(from: &Core, to: &Core, space: &SpaceId) {
    for ev in from
        .missing_since(space, &to.vector(space).unwrap())
        .unwrap()
    {
        to.ingest_sync(ev).unwrap();
    }
}

fn shared_space() -> (tempfile::TempDir, Core, tempfile::TempDir, Core, SpaceId) {
    let (da, a) = core();
    let (db, b) = core();
    let made = a.space_create("Studio", "", "Team").unwrap();
    let inv = a.invite_create(&made.id, None, vec![]).unwrap();
    let joined = b.invite_accept(&inv.code).unwrap();
    for e in joined.events {
        a.ingest_sync(e).unwrap();
    }
    sync(&a, &b, &made.id);
    sync(&b, &a, &made.id);
    (da, a, db, b, made.id)
}

#[test]
fn core_hide_prefs_and_schedule() {
    let (_d, c) = core();
    let home = c.resolve_space("home").unwrap();
    c.append(&home, post("general", "m1", "stay", None, vec![]))
        .unwrap();
    c.append(&home, post("general", "m2", "go", None, vec![]))
        .unwrap();
    let ids = |c: &Core| -> Vec<String> {
        let s: Snapshot = serde_json::from_value(c.snapshot().unwrap()).unwrap();
        s.collections.messages["home/general"]
            .iter()
            .map(|m| m.id.clone())
            .collect()
    };
    assert_eq!(ids(&c), vec!["m1", "m2"]);
    c.message_hide(&home, "m2").unwrap();
    assert_eq!(ids(&c), vec!["m1"]);
    c.message_unhide(&home, "m2").unwrap();
    assert_eq!(ids(&c), vec!["m1", "m2"]);
    assert!(c.message_hide(&home, "").is_err());

    let p = c
        .chat_prefs_set(
            &serde_json::json!({ "pinned": ["home/general"], "muted": { "home/general": 0 } }),
        )
        .unwrap();
    assert_eq!(p["pinned"][0], "home/general");
    assert!(
        c.chat_prefs_set(&serde_json::json!({ "bogus": 1 }))
            .is_err()
    );
    assert!(
        c.chat_prefs_set(&serde_json::json!({ "muted": { "x": "never" } }))
            .is_err()
    );
    assert_eq!(c.chat_prefs_get().unwrap()["muted"]["home/general"], 0);

    let soon = hermod_core::api::now_ms() + 60_000;
    assert!(
        c.schedule_add(
            &home,
            post("general", "s1", "later", None, vec![]),
            soon - 120_000
        )
        .is_err()
    );
    assert!(
        c.schedule_add(&home, EventBody::MemberLeave {}, soon)
            .is_err()
    );
    let item = c
        .schedule_add(&home, post("general", "s1", "later", None, vec![]), soon)
        .unwrap();
    assert_eq!(c.schedule_list().unwrap().len(), 1);
    assert_eq!(c.schedule_next().unwrap(), Some(soon));
    assert!(c.schedule_run_due(soon - 1, 5000).unwrap().is_empty());
    let out = c.schedule_run_due(soon + 100, 5000).unwrap();
    assert_eq!(out.len(), 1);
    assert!(out[0].result.is_ok() && !out[0].late);
    assert!(c.schedule_list().unwrap().is_empty());
    assert_eq!(ids(&c), vec!["m1", "m2", "s1"]);
    let second = c
        .schedule_add(
            &home,
            post("general", "s2", "cancel me", None, vec![]),
            soon + 5000,
        )
        .unwrap();
    c.schedule_cancel(&second.id).unwrap();
    assert!(c.schedule_cancel(&item.id).is_err());
    let _ = CoreRole::Member;
}

#[test]
fn dm_request_accept_flow_between_two_cores() {
    let (_da, a, _db, b, shared) = shared_space();
    let started = a.dm_start(&[b.user_id()], None, vec![]).unwrap();
    assert!(!started.existing);
    assert_eq!(started.summary.kind, "dm");
    for (space, evs) in &started.events {
        for e in evs {
            if *space == shared {
                b.ingest_sync(e.clone()).unwrap();
            }
        }
    }
    let reqs = b.dm_requests().unwrap();
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].from, a.user_id().to_string());
    assert!(a.dm_requests().unwrap().is_empty());
    let joined = b.dm_accept(&reqs[0].id).unwrap();
    let dm: SpaceId = started.summary.space_id.parse().unwrap();
    assert_eq!(joined.id, dm);
    for e in joined.events {
        a.ingest_sync(e).unwrap();
    }
    sync(&a, &b, &dm);
    a.append(&dm, post("general", "hi", "hello Bea", None, vec![]))
        .unwrap();
    sync(&a, &b, &dm);
    let s: Snapshot = serde_json::from_value(b.snapshot().unwrap()).unwrap();
    assert_eq!(
        s.collections.messages[&format!("{dm}/general")][0].text,
        "hello Bea"
    );
    assert_eq!(
        s.spaces
            .iter()
            .find(|x| x.id == dm.to_string())
            .unwrap()
            .kind,
        "dm"
    );
    assert!(
        b.dm_requests().unwrap().is_empty(),
        "accepted requests disappear"
    );
    assert!(
        b.chat_prefs_get().unwrap()["contacts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|u| u == &a.user_id().to_string())
    );
    let again = a.dm_start(&[b.user_id()], None, vec![]).unwrap();
    assert!(again.existing, "an existing dm is reused");
    assert_eq!(again.summary.space_id, dm.to_string());
}

#[test]
fn dm_without_a_shared_space_asks_for_a_contact_card() {
    let (_da, a) = core();
    let (_db, b) = core();
    let err = a
        .dm_start(&[b.user_id()], None, vec![])
        .unwrap_err()
        .to_string();
    assert!(err.contains("contact card"), "{err}");
    let (card, events) = a.contact_card(vec![]).unwrap();
    assert!(!events.is_empty());
    let (again, none) = a.contact_card(vec![]).unwrap();
    assert_eq!(card.code, again.code, "an unclaimed card is reused");
    assert!(none.is_empty());
    let joined = b.invite_accept(&card.code).unwrap();
    assert_eq!(joined.inviter, a.user_id());
    assert!(a.dm_start(&[a.user_id()], None, vec![]).is_err());
}

#[test]
fn saved_channel_is_created_once_in_home() {
    let (_d, c) = core();
    let (label, ch, evs) = c.saved_open().unwrap();
    assert_eq!(
        (label.as_str(), ch.as_str(), evs.len()),
        ("home", "saved", 1)
    );
    let (_, _, evs) = c.saved_open().unwrap();
    assert!(evs.is_empty());
}

#[test]
fn search_and_page_through_core() {
    let (_d, c) = core();
    let home = c.resolve_space("home").unwrap();
    for i in 0..7 {
        c.append(
            &home,
            post(
                "general",
                &format!("m{i}"),
                &format!("alpha {i}"),
                None,
                vec![],
            ),
        )
        .unwrap();
    }
    let page = c.messages_page(&home, "general", None, 3).unwrap();
    assert_eq!(page.messages.len(), 3);
    assert!(page.has_more);
    let hits = c
        .messages_search(
            None,
            &SearchFilters {
                q: "alpha 6".into(),
                limit: 10,
                ..SearchFilters::default()
            },
        )
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert!(
        c.media_gallery(&home, "general", "bogus", None, 10)
            .is_err()
    );
}

#[test]
fn voice_rooms_are_separate_per_channel_and_stale_events_are_ignored() {
    let mut w = world();
    let join_room = |room: &str| EventBody::RoomJoin { room: room.into() };
    let leave_room = |room: &str| EventBody::RoomLeave { room: room.into() };
    w.log.push(&w.ada, NOW - 30 * MIN, join_room(""));
    w.log.push(&w.bea, NOW - 29 * MIN, join_room("lounge"));
    w.log.push(&w.cai, NOW - 28 * MIN, join_room("lounge"));
    let key = w.sid.to_string();
    let room = |w: &World| w.snap_for(w.ada, NOW).collections.rooms[&key].clone();
    let r = room(&w);
    assert_eq!(r.in_room, vec![w.ada.to_string()]);
    assert_eq!(r.channels["lounge"].len(), 2);
    // Muting in the wrong room does nothing; in the right room it shows.
    w.log.push(
        &w.bea,
        NOW - 27 * MIN,
        EventBody::RoomState {
            room: "".into(),
            muted: Some(true),
            cam: None,
            share: None,
        },
    );
    assert!(room(&w).muted.get(&w.bea.to_string()).is_none_or(|m| !m));
    w.log.push(
        &w.bea,
        NOW - 26 * MIN,
        EventBody::RoomState {
            room: "lounge".into(),
            muted: Some(true),
            cam: None,
            share: None,
        },
    );
    assert_eq!(room(&w).muted.get(&w.bea.to_string()), Some(&true));
    // A leave for another room is stale; moving rooms replaces the old seat.
    w.log.push(&w.bea, NOW - 25 * MIN, leave_room(""));
    assert_eq!(room(&w).channels["lounge"].len(), 2);
    w.log.push(&w.bea, NOW - 24 * MIN, join_room("stage"));
    let r = room(&w);
    assert_eq!(r.channels["lounge"], vec![w.cai.to_string()]);
    assert_eq!(r.channels["stage"], vec![w.bea.to_string()]);
    w.log.push(&w.cai, NOW - 23 * MIN, leave_room("lounge"));
    assert!(!room(&w).channels.contains_key("lounge"));
}

#[test]
fn room_events_without_a_room_field_still_decode_as_the_main_room() {
    let b: EventBody = serde_json::from_str(r#"{"t":"room.join"}"#).unwrap();
    assert!(matches!(b, EventBody::RoomJoin { room } if room.is_empty()));
    let j = serde_json::to_string(&EventBody::RoomLeave {
        room: String::new(),
    })
    .unwrap();
    assert_eq!(j, r#"{"t":"room.leave"}"#);
}

fn seen_by(c: &Core, msg: &str) -> Vec<String> {
    let s: Snapshot = serde_json::from_value(c.snapshot().unwrap()).unwrap();
    s.collections
        .messages
        .values()
        .flatten()
        .find(|m| m.id == msg)
        .and_then(|m| m.ext.as_ref().map(|e| e.seen_by.clone()))
        .unwrap_or_default()
}

#[test]
fn mark_read_hands_back_the_receipt_only_when_receipts_are_on_so_the_host_can_gossip_it() {
    let (_da, a, _db, b, sid) = shared_space();
    a.append(
        &sid,
        post("general", "a1", "did you read this", None, vec![]),
    )
    .unwrap();
    sync(&a, &b, &sid);
    assert!(
        b.mark_read(&sid, "general", None).unwrap().is_none(),
        "receipts are opt in: nothing is published"
    );
    b.setting_set("read_receipts", "1").unwrap();
    let receipt = b
        .mark_read(&sid, "general", None)
        .unwrap()
        .expect("with receipts on the read.mark event is returned for publishing");
    assert!(seen_by(&a, "a1").is_empty(), "A has not received it yet");
    a.ingest(receipt).unwrap();
    assert_eq!(seen_by(&a, "a1"), vec![b.user_id().to_string()]);
}

#[test]
fn chat_list_prefs_round_trip_and_reject_bad_shapes() {
    let (dir, c) = core();
    let folder = serde_json::json!({ "id": "f1", "name": "DMs", "include": ["s/general"], "types": ["dm", "group"] });
    c.chat_prefs_set(&serde_json::json!({
        "folders": [folder],
        "archived": ["s/old"],
        "pinned": ["s/general"],
        "muted": { "s/general": 0, "s/later": 1_800_000_000_000_i64 },
    }))
    .unwrap();
    // A later patch to one key keeps the others (shallow merge).
    c.chat_prefs_set(&serde_json::json!({ "archived": [] }))
        .unwrap();
    drop(c);
    let c = Core::open(dir.path()).unwrap();
    let p = c.chat_prefs_get().unwrap();
    assert_eq!(p["folders"][0]["name"], "DMs");
    assert_eq!(p["folders"][0]["include"][0], "s/general");
    assert_eq!(p["folders"][0]["types"][1], "group");
    assert_eq!(p["archived"].as_array().unwrap().len(), 0);
    assert_eq!(p["pinned"][0], "s/general");
    assert_eq!(p["muted"]["s/general"], 0);
    assert_eq!(p["muted"]["s/later"], 1_800_000_000_000_i64);
    for bad in [
        serde_json::json!({ "folders": "all" }),
        serde_json::json!({ "archived": {} }),
        serde_json::json!({ "pinned": 1 }),
    ] {
        assert!(c.chat_prefs_set(&bad).is_err(), "{bad}");
    }
    assert_eq!(
        c.chat_prefs_get().unwrap(),
        p,
        "a rejected patch changes nothing"
    );
}

#[test]
fn a_dm_space_never_reaches_a_third_member_of_the_shared_space() {
    let (_da, a, _db, b, shared) = shared_space();
    let (_dc, c) = core();
    let inv = a.invite_create(&shared, None, vec![]).unwrap();
    let joined = c.invite_accept(&inv.code).unwrap();
    for e in joined.events {
        a.ingest_sync(e).unwrap();
    }
    sync(&a, &c, &shared);
    sync(&a, &b, &shared);
    sync(&c, &a, &shared);
    let started = a.dm_start(&[b.user_id()], None, vec![]).unwrap();
    // The carrier events travel through the shared space, so the third member ingests the same
    // log as Bea; the sealed invite is addressed to Bea alone.
    for (space, evs) in &started.events {
        for e in evs {
            if *space == shared {
                b.ingest_sync(e.clone()).unwrap();
                c.ingest_sync(e.clone()).unwrap();
            }
        }
    }
    assert_eq!(b.dm_requests().unwrap().len(), 1);
    assert!(c.dm_requests().unwrap().is_empty());
    let dm: SpaceId = started.summary.space_id.parse().unwrap();
    // Offer the dm space's own events to the third member too: it holds no key, so it must not
    // end up with the space, whatever the ingest call reports.
    for (space, evs) in &started.events {
        if *space == dm {
            for e in evs {
                let _ = c.ingest_sync(e.clone());
            }
        }
    }
    assert!(
        c.members(&dm).is_err(),
        "a non-member has no view of dm space"
    );
    let snap: Snapshot = serde_json::from_value(c.snapshot().unwrap()).unwrap();
    assert!(
        snap.spaces.iter().all(|s| s.id != dm.to_string()),
        "the dm space never appears for the third member"
    );
    assert!(
        snap.collections
            .messages
            .keys()
            .all(|k| !k.starts_with(&dm.to_string())),
        "none of its chat reaches the third member"
    );
}

#[test]
fn an_unnamed_dm_shows_the_other_person_on_both_sides_even_before_accept() {
    let (_da, a, _db, b, shared) = shared_space();
    for (core, name) in [(&a, "Ada Okafor"), (&b, "Bea Quist")] {
        core.profile_set(ProfileInput {
            name: name.into(),
            ..Default::default()
        })
        .unwrap();
    }
    sync(&a, &b, &shared);
    sync(&b, &a, &shared);
    let started = a.dm_start(&[b.user_id()], None, vec![]).unwrap();
    let dm: SpaceId = started.summary.space_id.parse().unwrap();
    let name_in = |c: &Core| -> Option<String> {
        let s: Snapshot = serde_json::from_value(c.snapshot().unwrap()).unwrap();
        s.spaces
            .iter()
            .find(|x| x.id == dm.to_string())
            .map(|x| x.name.clone())
    };
    assert_eq!(
        name_in(&a).as_deref(),
        Some("Bea Quist"),
        "the starter sees the invitee before they accept"
    );
    for (space, evs) in &started.events {
        for e in evs {
            if *space == shared {
                b.ingest_sync(e.clone()).unwrap();
            }
        }
    }
    let joined = b.dm_accept(&b.dm_requests().unwrap()[0].id).unwrap();
    for e in joined.events {
        a.ingest_sync(e).unwrap();
    }
    sync(&a, &b, &dm);
    assert_eq!(name_in(&a).as_deref(), Some("Bea Quist"));
    assert_eq!(name_in(&b).as_deref(), Some("Ada Okafor"));
    for c in [&a, &b] {
        let s: Snapshot = serde_json::from_value(c.snapshot().unwrap()).unwrap();
        let sp = s.spaces.iter().find(|x| x.id == dm.to_string()).unwrap();
        assert_eq!(sp.group, Some(false), "a 1:1 dm is never a group");
    }
}

// ---- tests for the DONE-NEEDS-TEST audit rows (docs/FEATURES.md Acceptance) ----

/// A-016: pin is author-or-admin at the fold, toggles, and ignores removed messages.
#[test]
fn pin_needs_author_or_admin_and_toggles() {
    let mut w = world();
    w.log.push(
        &w.bea,
        NOW - 10 * MIN,
        post("general", "m1", "pin me", None, vec![]),
    );
    w.log.push(
        &w.bea,
        NOW - 9 * MIN,
        post("general", "m2", "mine too", None, vec![]),
    );
    // Owner pins Bea's message.
    w.log.push(
        &w.ada,
        NOW - 8 * MIN,
        EventBody::MessagePin {
            msg_id: "m1".into(),
        },
    );
    // A member who is neither author nor admin cannot pin Bea's m2.
    w.log.push(
        &w.cai,
        NOW - 7 * MIN,
        EventBody::MessagePin {
            msg_id: "m2".into(),
        },
    );
    // The author can pin her own.
    w.log.push(
        &w.bea,
        NOW - 6 * MIN,
        EventBody::MessagePin {
            msg_id: "m2".into(),
        },
    );
    let msgs = w.msgs(w.ada, "general");
    assert!(msgs[0].pinned.unwrap_or(false), "admin pinned m1");
    assert!(msgs[1].pinned.unwrap_or(false), "author pinned m2");

    // A second pin toggles it back off.
    let mut w2 = world();
    w2.log.push(
        &w2.bea,
        NOW - 10 * MIN,
        post("general", "m1", "pin me", None, vec![]),
    );
    w2.log.push(
        &w2.ada,
        NOW - 8 * MIN,
        EventBody::MessagePin {
            msg_id: "m1".into(),
        },
    );
    w2.log.push(
        &w2.ada,
        NOW - 7 * MIN,
        EventBody::MessagePin {
            msg_id: "m1".into(),
        },
    );
    assert!(
        !w2.msgs(w2.ada, "general")[0].pinned.unwrap_or(false),
        "pin toggles"
    );

    // A forged pin of a removed message changes nothing.
    let mut w3 = world();
    w3.log.push(
        &w3.bea,
        NOW - 10 * MIN,
        post("general", "m1", "gone", None, vec![]),
    );
    w3.log.push(
        &w3.bea,
        NOW - 9 * MIN,
        EventBody::MessageDelete {
            msg_id: "m1".into(),
        },
    );
    w3.log.push(
        &w3.ada,
        NOW - 8 * MIN,
        EventBody::MessagePin {
            msg_id: "m1".into(),
        },
    );
    let tomb = w3.msgs(w3.ada, "general")[0].clone();
    assert!(
        tomb.removed.is_some() && !tomb.pinned.unwrap_or(false),
        "tombstones do not pin"
    );
}

/// A-016: the pin reaches the other peer through sync, both directions.
#[test]
fn pin_syncs_between_two_cores() {
    let (_da, a, _db, b, shared) = shared_space();
    a.append(&shared, post("general", "m1", "pin me", None, vec![]))
        .unwrap();
    sync(&a, &b, &shared);
    a.append(
        &shared,
        EventBody::MessagePin {
            msg_id: "m1".into(),
        },
    )
    .unwrap();
    sync(&a, &b, &shared);
    let pinned = |c: &Core| {
        let s: Snapshot = serde_json::from_value(c.snapshot().unwrap()).unwrap();
        s.collections.messages[&format!("{shared}/general")][0]
            .pinned
            .unwrap_or(false)
    };
    assert!(pinned(&a) && pinned(&b), "the pin synced");
    a.append(
        &shared,
        EventBody::MessagePin {
            msg_id: "m1".into(),
        },
    )
    .unwrap();
    sync(&a, &b, &shared);
    assert!(!pinned(&a) && !pinned(&b), "the unpin synced too");
}

/// M-014 / M-016: gif needs an attachment; video_note needs attachment plus voice meta,
/// and its duration is clamped like voice.
#[test]
fn gif_and_video_note_kinds_follow_their_requirements() {
    let mut w = world();
    let gif_ok = MsgExt {
        kind: Some("gif".into()),
        ..MsgExt::default()
    };
    let gif_no_att = MsgExt {
        kind: Some("gif".into()),
        ..MsgExt::default()
    };
    let video_ok = MsgExt {
        kind: Some("video_note".into()),
        voice: Some(VoiceMeta {
            dur_ms: 9_999_999,
            peaks: vec![3; 10],
        }),
        ..MsgExt::default()
    };
    let video_no_voice = MsgExt {
        kind: Some("video_note".into()),
        ..MsgExt::default()
    };
    let video_no_att = MsgExt {
        kind: Some("video_note".into()),
        voice: Some(VoiceMeta {
            dur_ms: 1_000,
            peaks: vec![],
        }),
        ..MsgExt::default()
    };
    w.log.push(
        &w.bea,
        NOW - 10 * MIN,
        post(
            "general",
            "g1",
            "",
            Some(gif_ok),
            vec![blob("g.gif", "image/gif")],
        ),
    );
    w.log.push(
        &w.bea,
        NOW - 9 * MIN,
        post("general", "g2", "gifless", Some(gif_no_att), vec![]),
    );
    w.log.push(
        &w.bea,
        NOW - 8 * MIN,
        post(
            "general",
            "v1",
            "",
            Some(video_ok),
            vec![blob("v.webm", "video/webm")],
        ),
    );
    w.log.push(
        &w.bea,
        NOW - 7 * MIN,
        post(
            "general",
            "v2",
            "silent",
            Some(video_no_voice),
            vec![blob("v.webm", "video/webm")],
        ),
    );
    w.log.push(
        &w.bea,
        NOW - 6 * MIN,
        post("general", "v3", "no file", Some(video_no_att), vec![]),
    );
    let msgs = w.msgs(w.ada, "general");
    assert_eq!(msgs[0].ext.as_ref().unwrap().kind.as_deref(), Some("gif"));
    assert_eq!(
        msgs[1].ext.as_ref().unwrap().kind,
        None,
        "gif without attachment dropped"
    );
    let v = msgs[2].ext.as_ref().unwrap();
    assert_eq!(v.kind.as_deref(), Some("video_note"));
    assert_eq!(
        v.voice.as_ref().unwrap().dur_ms,
        600_000,
        "duration clamped"
    );
    assert_eq!(
        msgs[3].ext.as_ref().unwrap().kind,
        None,
        "video_note without voice meta dropped"
    );
    assert_eq!(
        msgs[4].ext.as_ref().unwrap().kind,
        None,
        "video_note without attachment dropped"
    );
}

/// M-014: the My GIFs list round-trips through chat preferences.
#[test]
fn chat_prefs_gifs_list_round_trips() {
    let (_d, c) = core();
    let gif = serde_json::json!({ "hash": "ab".repeat(32), "size": 9, "name": "g.gif", "mime": "image/gif" });
    let after = c
        .chat_prefs_set(&serde_json::json!({ "gifs": [gif] }))
        .unwrap();
    assert_eq!(after["gifs"].as_array().unwrap().len(), 1);
    let got = c.chat_prefs_get().unwrap();
    assert_eq!(
        got["gifs"][0]["name"], "g.gif",
        "the list survives a reload"
    );
    let cleared = c
        .chat_prefs_set(&serde_json::json!({ "gifs": [] }))
        .unwrap();
    assert!(cleared["gifs"].as_array().unwrap().is_empty());
}

/// M-019: a link preview carried by the sender survives the fold and reaches every peer.
#[test]
fn link_preview_carried_by_the_sender_projects() {
    let mut w = world();
    let body = with(
        post("general", "m1", "look: https://example.com", None, vec![]),
        |b| {
            if let EventBody::MessagePost { preview, .. } = b {
                *preview = Some(LinkPreview {
                    url: "https://example.com".into(),
                    title: "Example".into(),
                    description: "A domain".into(),
                    image: None,
                });
            }
        },
    );
    w.log.push(&w.bea, NOW - MIN, body);
    let m = &w.msgs(w.ada, "general")[0];
    let p = m.preview.as_ref().expect("the preview projected");
    assert_eq!(
        (p.url.as_str(), p.title.as_str()),
        ("https://example.com", "Example")
    );
}

/// M-020: an in-chat poll message keeps its kind only with the poll id.
#[test]
fn poll_kind_requires_the_poll_id() {
    let mut w = world();
    let with_id = MsgExt {
        kind: Some("poll".into()),
        poll: Some("p1".into()),
        ..MsgExt::default()
    };
    let without = MsgExt {
        kind: Some("poll".into()),
        ..MsgExt::default()
    };
    w.log.push(
        &w.ada,
        NOW - 3 * MIN,
        post("general", "p1", "Vote", Some(with_id), vec![]),
    );
    w.log.push(
        &w.ada,
        NOW - 2 * MIN,
        post("general", "p2", "Orphan", Some(without), vec![]),
    );
    let msgs = w.msgs(w.ada, "general");
    let x = msgs[0].ext.as_ref().unwrap();
    assert_eq!(
        (x.kind.as_deref(), x.poll.as_deref()),
        (Some("poll"), Some("p1"))
    );
    assert_eq!(
        msgs[1].ext.as_ref().unwrap().kind,
        None,
        "poll without id dropped"
    );
}

/// M-028: a group DM spans three peers: group flag, default name, and one shared message.
#[test]
fn group_dm_three_peers_sync_with_group_flag() {
    let (_da, a) = core();
    let (_db, b) = core();
    let (_dc, c) = core();
    let sid = a.space_create("Trio", "", "Team").unwrap().id;
    for peer in [&b, &c] {
        peer.invite_accept(&a.invite_create(&sid, None, vec![]).unwrap().code)
            .unwrap();
    }
    for peer in [&b, &c] {
        sync(&a, peer, &sid);
        sync(peer, &a, &sid);
    }

    let started = a
        .dm_start(&[b.user_id(), c.user_id()], None, vec![])
        .unwrap();
    assert!(!started.existing);
    let dm: SpaceId = started.summary.space_id.parse().unwrap();
    assert_eq!(started.summary.name, "Group", "the default group name");
    // Recipients see requests and accept: the carrier invites live in the shared space.
    for peer in [&b, &c] {
        for (space, evs) in &started.events {
            if *space == sid {
                for e in evs {
                    peer.ingest_sync(e.clone()).unwrap();
                }
            }
        }
        let reqs = peer.dm_requests().unwrap();
        assert_eq!(reqs.len(), 1, "one request each");
        let joined = peer.dm_accept(&reqs[0].id).unwrap();
        assert_eq!(joined.id, dm);
        for e in joined.events {
            a.ingest_sync(e).unwrap();
        }
    }
    for peer in [&b, &c] {
        sync(&a, peer, &dm);
        sync(peer, &a, &dm);
    }
    a.append(&dm, post("general", "hi", "group hello", None, vec![]))
        .unwrap();
    for peer in [&b, &c] {
        sync(&a, peer, &dm);
    }
    for peer in [&a, &b, &c] {
        let s: Snapshot = serde_json::from_value(peer.snapshot().unwrap()).unwrap();
        let space = s.spaces.iter().find(|x| x.id == dm.to_string()).unwrap();
        assert_eq!(space.kind, "dm");
        assert_eq!(space.group, Some(true), "the group flag reached everyone");
        assert_eq!(space.name, "Group");
        assert_eq!(
            s.collections.messages[&format!("{dm}/general")][0].text,
            "group hello"
        );
    }

    // Size bounds answer before any contact lookup.
    assert!(
        a.dm_start(&[], None, vec![]).is_err(),
        "no recipients rejected"
    );
    let many: Vec<UserId> = (0..16).map(|_| user().1).collect();
    assert!(
        a.dm_start(&many, None, vec![]).is_err(),
        "16 recipients rejected"
    );
}

/// M-031: saving a message lands in the local home/saved channel and survives a reload.
#[test]
fn saved_messages_land_in_home_saved_and_stay_local() {
    let (_da, a, _db, b, shared) = shared_space();
    a.append(&shared, post("general", "m1", "keep this", None, vec![]))
        .unwrap();
    sync(&a, &b, &shared);
    let (label, ch, evs) = a.saved_open().unwrap();
    assert_eq!((label.as_str(), ch.as_str()), ("home", "saved"));
    assert_eq!(evs.len(), 1, "the channel is created on first open");
    let home = a.resolve_space("home").unwrap();
    let fwd = with(post("saved", "s1", "keep this", None, vec![]), |e| {
        if let EventBody::MessagePost { ext, .. } = e {
            *ext = Some(Box::new(MsgExt {
                fwd: Some(Forward {
                    by: b.user_id().to_string(),
                    ts: 5,
                    origin: format!("{shared}/general"),
                }),
                ..MsgExt::default()
            }));
        }
    });
    a.append(&home, fwd).unwrap();
    let s: Snapshot = serde_json::from_value(a.snapshot().unwrap()).unwrap();
    let saved = &s.collections.messages[&"home/saved".to_string()];
    assert_eq!(saved[0].text, "keep this");
    assert_eq!(
        saved[0].ext.as_ref().unwrap().fwd.as_ref().unwrap().by,
        b.user_id().to_string()
    );
    // The home space is device-local: B never sees A's saved channel.
    let sb: Snapshot = serde_json::from_value(b.snapshot().unwrap()).unwrap();
    assert!(
        !sb.collections.messages.contains_key("home/saved"),
        "saved is local to A"
    );
}
