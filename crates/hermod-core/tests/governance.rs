mod common;

use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;

use common::*;
use hermod_core::api::InviteOptions;
use hermod_core::event::{EventBody, Role};
use hermod_core::ids::{SpaceId, hex_encode};
use hermod_core::projections::shapes::Snapshot;
use hermod_core::projections::{min_role, project, report};
use hermod_core::store::IngestStatus;
use hermod_core::{Core, Error};

fn core() -> (tempfile::TempDir, Core) {
    let d = tempfile::tempdir().unwrap();
    let c = Core::open(d.path()).unwrap();
    (d, c)
}

fn snap(c: &Core) -> Snapshot {
    serde_json::from_value(c.snapshot().unwrap()).unwrap()
}

fn sync(from: &Core, to: &Core, s: &SpaceId) {
    for ev in from.missing_since(s, &to.vector(s).unwrap()).unwrap() {
        to.ingest_sync(ev).unwrap();
    }
}

fn texts(c: &Core, s: &SpaceId) -> Vec<String> {
    snap(c).collections.messages[&format!("{s}/general")]
        .iter()
        .map(|m| m.text.clone())
        .collect()
}

/// owner `a` plus members b (member) and c (admin via invite role), all synced.
fn trio() -> (Core, Core, Core, SpaceId, Vec<tempfile::TempDir>) {
    let (d1, a) = core();
    let (d2, b) = core();
    let (d3, c) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    let member = a.invite_create(&s, None, vec![]).unwrap();
    let admin = a
        .invite_create_with(
            &s,
            InviteOptions {
                role: Role::Admin,
                ..Default::default()
            },
        )
        .unwrap();
    b.invite_accept(&member.code).unwrap();
    c.invite_accept(&admin.code).unwrap();
    for x in [&b, &c] {
        sync(&a, x, &s);
    }
    sync(&b, &a, &s);
    sync(&c, &a, &s);
    for x in [&b, &c] {
        sync(&a, x, &s);
    }
    (a, b, c, s, vec![d1, d2, d3])
}

#[test]
fn role_table_every_event_type_is_gated() {
    use EventBody::*;
    let cases: Vec<(EventBody, Role)> = vec![
        (
            MessagePost {
                channel_id: "g".into(),
                msg_id: "m".into(),
                text: "".into(),
                reply_to: None,
                attachments: vec![],
                snap: None,
                mentions: vec![],
                preview: None,
                target: None,
                ext: None,
            },
            Role::Guest,
        ),
        (
            ReactionToggle {
                target_id: "m".into(),
                label: "x".into(),
            },
            Role::Guest,
        ),
        (
            PostCreate {
                post_id: "p".into(),
                kind: "note".into(),
                title: "".into(),
                text: None,
                blobs: vec![],
                dur: None,
                chapters: vec![],
                captions: None,
            },
            Role::Member,
        ),
        (
            BoardCreate {
                board_id: "b".into(),
                name: "".into(),
                due: "".into(),
                cols: vec![],
            },
            Role::Member,
        ),
        (
            MemberRemove {
                user: "u".into(),
                last_seq: None,
            },
            Role::Admin,
        ),
        (
            SpaceRekey {
                epoch: 1,
                wraps: vec![],
            },
            Role::Admin,
        ),
        (
            InviteCreate {
                id: "i".into(),
                exp: None,
                max_uses: None,
                role: Role::Member,
            },
            Role::Admin,
        ),
        (
            ContentRemove {
                target_id: "m".into(),
                reason: None,
            },
            Role::Admin,
        ),
        (
            SpaceUpdate {
                name: None,
                tagline: None,
                sections: None,
                map_style: None,
                join_pow_bits: None,
            },
            Role::Admin,
        ),
        (
            MemberRole {
                user: "u".into(),
                role: Role::Admin,
            },
            Role::Owner,
        ),
    ];
    for (body, role) in cases {
        assert_eq!(min_role(&body), role, "{body:?}");
    }
}

#[test]
fn fold_ignores_unauthorized_authors_and_converges() {
    let (_, owner) = user();
    let (_, member) = user();
    let (_, guest) = user();
    let (_, outsider) = user();
    let sid = SpaceId::random();
    let mut l = Log::new();
    l.push(&owner, NOW, space_create("S", &["chat"]));
    l.push(&owner, NOW, channel("general"));
    l.push(
        &owner,
        NOW,
        EventBody::InviteCreate {
            id: "m".into(),
            exp: None,
            max_uses: None,
            role: Role::Member,
        },
    );
    l.push(
        &owner,
        NOW,
        EventBody::InviteCreate {
            id: "g".into(),
            exp: None,
            max_uses: None,
            role: Role::Guest,
        },
    );
    l.push(
        &member,
        NOW,
        EventBody::MemberJoin {
            via_invite_from: None,
            pow: None,
            invite: Some("m".into()),
        },
    );
    l.push(
        &guest,
        NOW,
        EventBody::MemberJoin {
            via_invite_from: None,
            pow: None,
            invite: Some("g".into()),
        },
    );
    l.push(&outsider, NOW, post_msg("general", "o1", "outsider"));
    l.push(
        &guest,
        NOW,
        post_msg("general", "g1", "guest in members channel"),
    );
    l.push(&member, NOW, post_msg("general", "m1", "member ok"));
    l.push(
        &guest,
        NOW,
        EventBody::BoardCreate {
            board_id: "b".into(),
            name: "x".into(),
            due: "".into(),
            cols: vec![],
        },
    );
    l.push(
        &member,
        NOW,
        EventBody::MemberRole {
            user: member.to_string(),
            role: Role::Owner,
        },
    );
    l.push(
        &member,
        NOW,
        EventBody::MemberRemove {
            user: owner.to_string(),
            last_seq: None,
        },
    );
    l.push(
        &member,
        NOW,
        EventBody::InviteCreate {
            id: "x".into(),
            exp: None,
            max_uses: None,
            role: Role::Member,
        },
    );
    l.push(
        &owner,
        NOW,
        EventBody::ChannelCreate {
            channel_id: "open".into(),
            name: "open".into(),
            topic: "".into(),
            dm: None,
            guest: true,
        },
    );
    l.push(
        &guest,
        NOW,
        post_msg("open", "g2", "guest in guest channel"),
    );
    let input = l.input(sid, "S", "Team", false);
    let snap = project(&ctx(owner), std::slice::from_ref(&input));
    let general: Vec<_> = snap.collections.messages[&format!("{sid}/general")]
        .iter()
        .map(|m| m.id.as_str())
        .collect();
    assert_eq!(general, vec!["m1"]);
    assert_eq!(snap.collections.messages[&format!("{sid}/open")].len(), 1);
    assert!(snap.collections.workboards.is_empty());
    let rep = report(&ctx(owner), &input);
    assert_eq!(
        rep.members
            .iter()
            .map(|m| (m.role, 1))
            .fold(BTreeMap::new(), |mut a, (r, n)| {
                *a.entry(r).or_insert(0) += n;
                a
            })
            .len(),
        3
    );
    assert_eq!(rep.invites.len(), 2, "member could not create an invite");
    assert_eq!(rep.my_role, Some(Role::Owner));
    let mut shuffled = input.clone();
    shuffled.events.reverse();
    assert_eq!(
        serde_json::to_string(&project(&ctx(owner), &[shuffled])).unwrap(),
        serde_json::to_string(&snap).unwrap()
    );
}

#[test]
fn invites_expire_cap_uses_and_revoke() {
    let (_, owner) = user();
    let (_, a) = user();
    let (_, b) = user();
    let (_, c) = user();
    let sid = SpaceId::random();
    let mut l = Log::new();
    l.push(&owner, NOW, space_create("S", &["chat"]));
    l.push(
        &owner,
        NOW,
        EventBody::InviteCreate {
            id: "one".into(),
            exp: None,
            max_uses: Some(1),
            role: Role::Member,
        },
    );
    l.push(
        &owner,
        NOW,
        EventBody::InviteCreate {
            id: "old".into(),
            exp: Some(1),
            max_uses: None,
            role: Role::Member,
        },
    );
    l.push(
        &owner,
        NOW,
        EventBody::InviteCreate {
            id: "rev".into(),
            exp: None,
            max_uses: None,
            role: Role::Member,
        },
    );
    l.push(
        &owner,
        NOW,
        EventBody::InviteRevoke {
            id: "rev".into(),
            joined: None,
        },
    );
    let j = |i: &str| EventBody::MemberJoin {
        via_invite_from: None,
        pow: None,
        invite: Some(i.into()),
    };
    l.push(&a, NOW, j("one"));
    l.push(&b, NOW, j("one"));
    l.push(&c, NOW, j("old"));
    l.push(&c, NOW, j("rev"));
    l.push(&c, NOW, j("missing"));
    let rep = report(&ctx(owner), &l.input(sid, "S", "Team", false));
    let users: Vec<_> = rep.members.iter().map(|m| m.user.clone()).collect();
    assert!(users.contains(&a.to_string()));
    assert!(!users.contains(&b.to_string()) && !users.contains(&c.to_string()));
    let one = rep.invites.iter().find(|i| i.id == "one").unwrap();
    assert_eq!(one.uses, 1);
    assert!(rep.invites.iter().find(|i| i.id == "rev").unwrap().revoked);
}

#[test]
fn removal_rekeys_and_the_removed_peer_cannot_read_new_epochs() {
    let (a, b, c, s, _dirs) = trio();
    let b_id = b.user_id();
    assert_eq!(a.members(&s).unwrap().len(), 3);
    assert!(
        b.member_remove(&s, &c.user_id()).is_err(),
        "members cannot remove"
    );
    assert!(
        c.member_remove(&s, &a.user_id()).is_err(),
        "cannot remove someone at or above your role"
    );

    a.append(&s, post_msg("general", "before", "before removal"))
        .unwrap();
    sync(&a, &b, &s);
    let removal = a.member_remove(&s, &b_id).unwrap();
    assert_eq!(removal.len(), 2);
    assert_eq!(
        removal[1].epoch, 0,
        "the rekey itself is sealed under the old epoch"
    );
    a.append(&s, post_msg("general", "after", "secret after removal"))
        .unwrap();
    let after = a.missing_since(&s, &b.vector(&s).unwrap());
    let after = after.unwrap();
    assert_eq!(after.iter().filter(|e| e.epoch == 1).count(), 1);

    for ev in &after {
        let r = b.ingest_sync(ev.clone()).unwrap();
        if ev.epoch == 1 {
            assert_eq!(
                r.status,
                IngestStatus::Pending,
                "removed peer holds no epoch 1 key"
            );
        }
    }
    assert_eq!(b.pending(&s).unwrap().1, 1);
    assert!(!texts(&b, &s).iter().any(|t| t.contains("secret")));
    assert!(
        texts(&b, &s).contains(&"before removal".to_string()),
        "old history stays readable"
    );
    assert_eq!(snap(&b).spaces[1].removed, Some(true));

    sync(&a, &c, &s);
    assert!(texts(&c, &s).contains(&"secret after removal".to_string()));
    assert_eq!(c.pending(&s).unwrap(), (0, 0));
    c.append(&s, post_msg("general", "c1", "from c at epoch 1"))
        .unwrap();
    sync(&c, &a, &s);
    assert!(texts(&a, &s).contains(&"from c at epoch 1".to_string()));
    let audit: Vec<_> = a
        .audit_list(&s)
        .unwrap()
        .into_iter()
        .map(|e| e.kind)
        .collect();
    for k in [
        "space.create",
        "invite.create",
        "member.join",
        "member.remove",
        "space.rekey",
    ] {
        assert!(audit.iter().any(|x| x == k), "{k}");
    }
    assert!(b.audit_list(&s).is_err(), "audit is admin only");
}

#[test]
fn offline_member_gets_the_key_on_next_sync_and_late_events_unlock() {
    let (a, b, c, s, _dirs) = trio();
    a.rekey(&s).unwrap();
    a.append(&s, post_msg("general", "n1", "epoch one"))
        .unwrap();
    let evs = a.missing_since(&s, &b.vector(&s).unwrap()).unwrap();
    let (rekey, rest): (Vec<_>, Vec<_>) = evs.into_iter().partition(|e| e.epoch == 0);
    assert!(!rekey.is_empty());
    for e in rest.iter().filter(|e| e.epoch == 1) {
        assert_eq!(
            b.ingest_sync(e.clone()).unwrap().status,
            IngestStatus::Pending
        );
    }
    for e in rekey {
        b.ingest_sync(e).unwrap();
    }
    assert!(
        texts(&b, &s).contains(&"epoch one".to_string()),
        "pending events unlock once the key arrives"
    );
    assert_eq!(b.pending(&s).unwrap(), (0, 0));
    sync(&a, &c, &s);
    assert!(texts(&c, &s).contains(&"epoch one".to_string()));
}

#[test]
fn invite_revoke_rekeys_so_a_leaked_code_reads_nothing_new() {
    let (d1, a) = core();
    let (_d2, leaked) = core();
    let s = a.space_create("Leak", "", "Team").unwrap().id;
    let inv = a.invite_create(&s, None, vec![]).unwrap();
    assert_eq!(a.invite_list(&s).unwrap().len(), 1);
    a.invite_revoke(&s, &inv.id).unwrap();
    assert!(a.invite_list(&s).unwrap()[0].revoked);
    a.append(&s, post_msg("general", "x", "after revoke"))
        .unwrap();
    leaked.invite_accept(&inv.code).unwrap();
    sync(&a, &leaked, &s);
    assert!(!texts(&leaked, &s).contains(&"after revoke".to_string()));
    assert_eq!(
        snap(&leaked)
            .collections
            .messages
            .get(&format!("{s}/general"))
            .map_or(0, Vec::len),
        0
    );
    drop(d1);
}

#[test]
fn owner_protection_and_role_changes() {
    let (a, b, _c, s, _d) = trio();
    assert!(
        a.member_set_role(&s, &a.user_id(), Role::Admin).is_err(),
        "last owner"
    );
    a.member_set_role(&s, &b.user_id(), Role::Owner).unwrap();
    sync(&a, &b, &s);
    assert_eq!(b.space_report(&s).unwrap().my_role, Some(Role::Owner));
    a.member_set_role(&s, &a.user_id(), Role::Member).unwrap();
    assert!(
        a.member_set_role(&s, &b.user_id(), Role::Member).is_err(),
        "no longer an owner"
    );
}

#[test]
fn ingest_rate_cap_applies_to_gossip_but_not_to_backfill() {
    let d = tempfile::tempdir().unwrap();
    let cfg = hermod_core::CoreConfig {
        rate: hermod_core::ratelimit::RateConfig {
            events_per_sec: 1.0,
            burst: 5,
            max_event_bytes: 1 << 20,
        },
        ..Default::default()
    };
    let b = Core::open_with(d.path(), cfg).unwrap();
    let (_d2, a) = core();
    let s = a.space_create("Flood", "", "Team").unwrap().id;
    b.invite_accept(&a.invite_create(&s, None, vec![]).unwrap().code)
        .unwrap();
    for i in 0..30 {
        a.append(&s, post_msg("general", &format!("m{i}"), "x"))
            .unwrap();
    }
    let evs = a.missing_since(&s, &b.vector(&s).unwrap()).unwrap();
    let mut limited = 0;
    for e in evs.iter().take(20) {
        if matches!(b.ingest(e.clone()), Err(Error::RateLimited(_))) {
            limited += 1;
        }
    }
    assert!(
        limited > 0,
        "a flooding author is dropped on the gossip path"
    );
    sync(&a, &b, &s);
    assert_eq!(texts(&b, &s).len(), 30, "backfill is exempt");
}

#[test]
fn set_rate_tightens_the_gossip_cap_on_an_open_core() {
    let (_d, b) = core();
    let (_d2, a) = core();
    let s = a.space_create("Flood", "", "Team").unwrap().id;
    b.invite_accept(&a.invite_create(&s, None, vec![]).unwrap().code)
        .unwrap();
    b.set_rate(hermod_core::ratelimit::RateConfig {
        events_per_sec: 1.0,
        burst: 2,
        max_event_bytes: 1 << 20,
    });
    for i in 0..10 {
        a.append(&s, post_msg("general", &format!("m{i}"), "x"))
            .unwrap();
    }
    let evs = a.missing_since(&s, &b.vector(&s).unwrap()).unwrap();
    let limited = evs
        .iter()
        .take(10)
        .filter(|e| matches!(b.ingest((*e).clone()), Err(Error::RateLimited(_))))
        .count();
    assert!(limited > 0, "the new cap applies without reopening");
}

#[test]
fn size_cap_applies_to_gossip_but_not_to_local_or_sync() {
    let d = tempfile::tempdir().unwrap();
    let cfg = hermod_core::CoreConfig {
        rate: hermod_core::ratelimit::RateConfig {
            events_per_sec: 1000.0,
            burst: 1000,
            max_event_bytes: 1024,
        },
        ..Default::default()
    };
    let b = Core::open_with(d.path(), cfg).unwrap();
    let (_d2, a) = core();
    let s = a.space_create("Big", "", "Team").unwrap().id;
    b.invite_accept(&a.invite_create(&s, None, vec![]).unwrap().code)
        .unwrap();
    let big = "x".repeat(4096);
    a.append(&s, post_msg("general", "big", &big)).unwrap();
    let evs = a.missing_since(&s, &b.vector(&s).unwrap()).unwrap();
    let (ev, rest) = evs.split_last().unwrap();
    for e in rest {
        b.ingest_sync(e.clone()).unwrap();
    }
    let ev = ev.clone();
    assert!(
        matches!(b.ingest(ev.clone()), Err(Error::Invalid { .. })),
        "gossip over the cap is refused"
    );
    b.ingest_sync(ev).unwrap();
    b.append(&s, post_msg("general", "mine", &big)).unwrap();
    assert!(texts(&b, &s).iter().any(|t| t.len() == big.len()));
}

#[test]
fn moderation_tombstones_posts_comments_and_cheap_arms() {
    let (a, b, _c, s, _d) = trio();
    b.append(&s, post_msg("general", "bad", "spam")).unwrap();
    b.append(
        &s,
        EventBody::PostCreate {
            post_id: "p".into(),
            kind: "note".into(),
            title: "T".into(),
            text: Some("body".into()),
            blobs: vec![],
            dur: None,
            chapters: vec![],
            captions: None,
        },
    )
    .unwrap();
    sync(&b, &a, &s);
    b.append(
        &s,
        EventBody::MessagePost {
            channel_id: "general".into(),
            msg_id: "cm".into(),
            text: "nice".into(),
            reply_to: None,
            attachments: vec![],
            snap: None,
            mentions: vec![],
            preview: None,
            target: Some("p".into()),
            ext: None,
        },
    )
    .unwrap();
    b.append(
        &s,
        EventBody::MessageEdit {
            msg_id: "bad".into(),
            text: "spam v2".into(),
        },
    )
    .unwrap();
    sync(&b, &a, &s);
    assert!(b.content_remove(&s, "bad", None).is_err());
    a.content_remove(&s, "bad", Some("spam".into())).unwrap();
    a.append(
        &s,
        EventBody::ContentReport {
            target_id: "p".into(),
            reason: Some("meh".into()),
        },
    )
    .unwrap();
    a.append(
        &s,
        EventBody::MessagePin {
            msg_id: "bad".into(),
        },
    )
    .unwrap();
    sync(&a, &b, &s);
    let sn = snap(&b);
    let m = &sn.collections.messages[&format!("{s}/general")][0];
    assert_eq!(
        (m.removed.as_deref(), m.text.as_str(), m.edited),
        (Some("admin"), "", Some(true))
    );
    assert_eq!(m.history.as_ref().unwrap()[0].text, "spam");
    let post = &sn.collections.feed[&s.to_string()][0];
    assert_eq!(post.comments.as_ref().unwrap()[0].text, "nice");
    assert_eq!(a.reports_list(&s).unwrap().len(), 1);
    b.append(
        &s,
        EventBody::PostDelete {
            post_id: "p".into(),
        },
    )
    .unwrap();
    sync(&b, &a, &s);
    assert!(snap(&a).collections.feed[&s.to_string()].is_empty());
}

#[test]
fn blocks_and_follows_are_local_and_shape_the_projection() {
    let (a, b, _c, s, _d) = trio();
    a.append(&s, post_msg("general", "m", "hi")).unwrap();
    sync(&a, &b, &s);
    b.block_user(&a.user_id()).unwrap();
    let sn = snap(&b);
    let msg = &sn.collections.messages[&format!("{s}/general")][0];
    assert_eq!(msg.blocked, Some(true));
    let ch = sn.collections.channels[&s.to_string()]
        .iter()
        .find(|c| c.id == "general")
        .unwrap();
    assert_eq!(ch.unread, None, "blocked authors do not count as unread");
    assert!(b.block_user(&b.user_id()).is_err());
    b.unblock_user(&a.user_id()).unwrap();
    assert!(b.blocked().unwrap().is_empty());
    b.follow("user", "someone").unwrap();
    assert!(b.follow("planet", "x").is_err());
    assert_eq!(b.follows().unwrap().len(), 1);
    b.unfollow("user", "someone").unwrap();
    assert!(b.follows().unwrap().is_empty());
}

#[test]
fn search_finds_across_types_and_honours_removal_and_blocks() {
    let (a, b, _c, s, _d) = trio();
    a.append(&s, post_msg("general", "k1", "The kiln is cooling"))
        .unwrap();
    a.append(
        &s,
        EventBody::PostCreate {
            post_id: "pk".into(),
            kind: "note".into(),
            title: "Kiln notes".into(),
            text: Some("cone 6".into()),
            blobs: vec![],
            dur: None,
            chapters: vec![],
            captions: None,
        },
    )
    .unwrap();
    a.append(
        &s,
        EventBody::DocCreate {
            doc_id: "d".into(),
            title: "Firing plan".into(),
            kicker: "kiln".into(),
        },
    )
    .unwrap();
    a.append(
        &s,
        EventBody::EventCreate {
            ev_id: "e".into(),
            day: 1,
            start: 9.0,
            end: 10.0,
            title: "Open the kiln".into(),
            place: "Studio".into(),
            note: "".into(),
            meeting: false,
        },
    )
    .unwrap();
    b.append(&s, post_msg("general", "k2", "glazes for the kiln"))
        .unwrap();
    sync(&a, &b, &s);
    sync(&b, &a, &s);
    let hits = a.search_query("kil", None, &[], 20).unwrap();
    let kinds: Vec<_> = hits.iter().map(|h| h.kind.as_str()).collect();
    for k in ["message", "post", "doc", "event"] {
        assert!(kinds.contains(&k), "{k} in {kinds:?}");
    }
    assert!(hits[0].snippet.contains('\u{1}'), "match is highlighted");
    let only = a
        .search_query("kiln", Some(&s), &["post".to_string()], 20)
        .unwrap();
    assert_eq!(only.len(), 1);
    assert!(a.search_query("\"; DROP TABLE x; --", None, &[], 5).is_ok());
    assert!(a.search_query("   ", None, &[], 5).unwrap().is_empty());

    a.content_remove(&s, "k2", None).unwrap();
    assert!(
        !a.search_query("glazes", None, &[], 20)
            .unwrap()
            .iter()
            .any(|h| h.id == "k2"),
        "removed content leaves the index"
    );
    a.append(
        &s,
        EventBody::MessageEdit {
            msg_id: "k1".into(),
            text: "now about glazing".into(),
        },
    )
    .unwrap();
    assert!(
        a.search_query("cooling", None, &[], 20).unwrap().is_empty(),
        "edits reindex"
    );
    b.block_user(&a.user_id()).unwrap();
    sync(&a, &b, &s);
    assert!(
        b.search_query("glazing", None, &[], 20).unwrap().is_empty(),
        "blocked authors are hidden"
    );
}

#[test]
fn backup_round_trip_restores_identity_state_and_blobs() {
    let (d1, a) = core();
    let (_d2, b) = core();
    a.profile_set(hermod_core::ProfileInput {
        name: "Ada".into(),
        bio: "x".into(),
        ..Default::default()
    })
    .unwrap();
    let s = a.space_create("Keep", "t", "Team").unwrap().id;
    b.invite_accept(&a.invite_create(&s, None, vec![]).unwrap().code)
        .unwrap();
    let blob = a.blob_put_bytes("pic.png", &vec![7u8; 300_000]).unwrap();
    a.append(
        &s,
        EventBody::MessagePost {
            channel_id: "general".into(),
            msg_id: "m".into(),
            text: "with pic".into(),
            reply_to: None,
            attachments: vec![blob.clone()],
            snap: None,
            mentions: vec![],
            preview: None,
            target: None,
            ext: None,
        },
    )
    .unwrap();
    a.rekey(&s).unwrap();
    a.append(&s, post_msg("general", "m2", "epoch one"))
        .unwrap();
    a.setting_set("theme", "dusk").unwrap();
    a.block_user(&b.user_id()).unwrap();
    a.mark_read(&s, "general", None).unwrap();
    let before = a.snapshot_at(common::NOW).unwrap();

    let file = d1.path().join("backup.hbk");
    assert!(
        a.backup_export(&file, "short", true).is_err(),
        "weak passphrase refused"
    );
    let cfg = hermod_core::CoreConfig {
        backup_kdf: hermod_core::backup::KdfParams {
            m_cost_kib: 8,
            t_cost: 1,
            p_cost: 1,
        },
        ..Default::default()
    };
    let a_fast = Core::open_with(d1.path(), cfg).unwrap();
    a_fast
        .backup_export(&file, "correct horse battery", true)
        .unwrap();

    let fresh = tempfile::tempdir().unwrap();
    assert!(Core::backup_import(fresh.path(), &file, "wrong passphrase!").is_err());
    assert!(Core::backup_import(fresh.path(), &fresh.path().join("nope"), "x").is_err());
    Core::backup_import(fresh.path(), &file, "correct horse battery").unwrap();
    let r = Core::open(fresh.path()).unwrap();
    assert_eq!(r.user_id(), a.user_id());
    assert_eq!(r.snapshot_at(common::NOW).unwrap(), before);
    assert_eq!(r.setting_get("theme").unwrap().as_deref(), Some("dusk"));
    assert_eq!(r.blocked().unwrap().len(), 1);
    assert_eq!(r.blobs().read_all(&blob.hash).unwrap().len(), 300_000);
    r.append(&s, post_msg("general", "m3", "after restore"))
        .unwrap();
    assert!(
        Core::backup_import(fresh.path(), &file, "correct horse battery").is_err(),
        "no overwrite"
    );

    let mut bytes = std::fs::read(&file).unwrap();
    let n = bytes.len();
    bytes[n - 5] ^= 1;
    std::fs::write(&file, bytes).unwrap();
    let other = tempfile::tempdir().unwrap();
    assert!(Core::backup_import(other.path(), &file, "correct horse battery").is_err());
}

#[test]
fn storage_usage_counts_events_and_referenced_blobs() {
    let (_d, c) = core();
    let s = c.space_create("Disk", "", "Team").unwrap().id;
    let blob = c.blob_put_bytes("a.bin", &vec![1u8; 5000]).unwrap();
    c.append(
        &s,
        EventBody::MessagePost {
            channel_id: "general".into(),
            msg_id: "m".into(),
            text: "x".into(),
            reply_to: None,
            attachments: vec![blob],
            snap: None,
            mentions: vec![],
            preview: None,
            target: None,
            ext: None,
        },
    )
    .unwrap();
    let older = c.blob_put_bytes("old.bin", &vec![3u8; 3000]).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    let orphan = c.blob_put_bytes("o.bin", &vec![2u8; 4000]).unwrap();
    let u = c.storage_usage().unwrap();
    let sp = u.spaces.iter().find(|x| x.name == "Disk").unwrap();
    assert_eq!((sp.blobs, sp.blob_bytes), (1, 5000));
    assert!(sp.events >= 4 && sp.event_bytes > 0);
    assert!(u.cache_bytes >= 4000);
    // A cache limit evicts the oldest unreferenced blob first and never a referenced one.
    let none = std::time::Duration::ZERO;
    assert_eq!(c.storage_trim_cache_with(u64::MAX, none).unwrap(), 0);
    assert!(c.storage_trim_cache_with(u.cache_bytes - 1, none).unwrap() >= 3000);
    assert!(c.blobs().manifest(&older.hash).unwrap().is_none());
    assert!(c.blobs().manifest(&orphan.hash).unwrap().is_some());
    assert_eq!(
        c.storage_usage()
            .unwrap()
            .spaces
            .iter()
            .find(|x| x.name == "Disk")
            .unwrap()
            .blob_bytes,
        5000
    );
    assert_eq!(
        c.storage_clear_cache().unwrap(),
        0,
        "fresh uploads are protected"
    );
    assert!(
        c.storage_clear_cache_with(std::time::Duration::ZERO)
            .unwrap()
            >= 4000
    );
    assert!(c.blobs().manifest(&orphan.hash).unwrap().is_none());
}

#[test]
fn migrations_upgrade_old_schema_and_report_corruption() {
    use hermod_core::migrations;
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("old.db");
    {
        let mut conn = rusqlite::Connection::open(&path).unwrap();
        migrations::migrate_to(&mut conn, 1).unwrap();
        assert_eq!(migrations::version(&conn).unwrap(), 1);
        conn.execute("INSERT INTO spaces(space_id, space_key, name, kind, joined_at) VALUES (x'01', x'0202', 'Old', 'Team', 1)", []).unwrap();
    }
    let bad = d.path().join("bad.db");
    std::fs::write(
        &bad,
        b"this is definitely not sqlite, just some bytes padding padding padding",
    )
    .unwrap();
    assert!(matches!(
        hermod_core::store::Store::open(&bad),
        Err(Error::Corrupt(_))
    ));
    let c = Core::open(tempfile::tempdir().unwrap().path()).unwrap();
    assert_eq!(c.schema_version().unwrap(), migrations::LATEST);
    c.integrity_check().unwrap();
}

#[test]
fn rekey_requires_admin_and_devices_are_logged() {
    let (a, b, _c, s, _d) = trio();
    assert!(matches!(b.rekey(&s), Err(Error::Forbidden(_))));
    let dev = [9u8; 32];
    a.device_link(&dev).unwrap();
    a.device_revoke(&dev).unwrap();
}

#[test]
fn snap_seal_covers_files_and_verification_flags_missing_blobs() {
    let (_d, c) = core();
    let s = c.space_create("Seal", "", "Team").unwrap().id;
    let f = c.blob_put_bytes("a.rs", b"fn main() {}").unwrap();
    let ghost = hermod_core::BlobRef {
        hash: "ab".repeat(32),
        size: 3,
        name: "g".into(),
        mime: String::new(),
    };
    for (id, blob) in [("s1", &f), ("s2", &ghost)] {
        c.append(
            &s,
            EventBody::SnapCreate {
                snap_id: id.into(),
                line_id: "main".into(),
                title: id.into(),
                kind: "Code".into(),
                files: vec![hermod_core::event::SnapFileIn {
                    path: "a.rs".into(),
                    blob: Some(blob.clone()),
                    adds: 1,
                    dels: 0,
                }],
                parent: None,
            },
        )
        .unwrap();
    }
    assert!(c.snap_verify(&s, "s1").unwrap().ok);
    let bad = c.snap_verify(&s, "s2").unwrap();
    assert!(!bad.ok && bad.missing == vec!["a.rs".to_string()]);
    assert!(c.snap_verify(&s, "nope").is_err());
    let sk = &snap(&c).collections.skein[&s.to_string()];
    assert_ne!(
        sk.snaps[0].seal, sk.snaps[1].seal,
        "seal depends on file content hashes"
    );
}

#[test]
fn map_style_folds_validates_and_clears() {
    let upd = |m: Option<&str>| EventBody::SpaceUpdate {
        name: None,
        tagline: None,
        sections: None,
        map_style: m.map(String::from),
        join_pow_bits: None,
    };
    let style = |c: &Core| {
        snap(c)
            .spaces
            .iter()
            .find(|s| s.name == "Maps")
            .unwrap()
            .map_style
            .clone()
    };
    let (_d, a) = core();
    let s = a.space_create("Maps", "", "Team").unwrap().id;
    assert_eq!(style(&a), None);
    a.append(&s, upd(Some("sanctuary"))).unwrap();
    assert_eq!(style(&a).as_deref(), Some("sanctuary"));
    a.append(&s, upd(None)).unwrap();
    assert_eq!(
        style(&a).as_deref(),
        Some("sanctuary"),
        "absent leaves it unchanged"
    );
    assert!(
        a.append(&s, upd(Some("castle"))).is_err(),
        "unknown style rejected at append"
    );
    assert_eq!(style(&a).as_deref(), Some("sanctuary"));
    a.append(&s, upd(Some(""))).unwrap();
    assert_eq!(style(&a), None, "empty string clears");

    // a peer event carrying an unknown style is ignored by the fold, not applied
    let (_, owner) = user();
    let mut l = Log::new();
    l.push(&owner, NOW, space_create("Maps", &["chat"]));
    l.push(&owner, NOW, upd(Some("castle")));
    let snapshot = project(
        &ctx(owner),
        &[l.input(SpaceId::random(), "Maps", "Team", false)],
    );
    assert_eq!(snapshot.spaces[0].map_style, None);
}

fn create_with_nonce(nonce: Option<&[u8; 32]>) -> EventBody {
    let mut body = space_create("S", &["chat"]);
    if let EventBody::SpaceCreate { nonce: n, .. } = &mut body {
        *n = nonce.map(|b| hex_encode(b));
    }
    body
}

fn owners(rep: &hermod_core::projections::SpaceReport) -> Vec<String> {
    rep.members
        .iter()
        .filter(|m| m.role == Role::Owner)
        .map(|m| m.user.clone())
        .collect()
}

#[test]
fn forged_space_create_cannot_take_over_a_creator_bound_id() {
    let (_, owner) = user();
    let (_, thief) = user();
    let nonce = [7u8; 32];
    let sid = SpaceId::derive(&owner, &nonce);
    let mut l = Log::new();
    l.push_at(&thief, 1, NOW, create_with_nonce(None));
    l.push_at(&thief, 2, NOW, create_with_nonce(Some(&[9u8; 32])));
    l.push_at(&owner, 5, NOW, create_with_nonce(Some(&nonce)));
    let rep = report(&ctx(owner), &l.input(sid, "S", "Team", false));
    assert_eq!(owners(&rep), vec![owner.to_string()]);
}

#[test]
fn pinned_creator_beats_a_forged_earlier_create_on_a_legacy_id() {
    let (_, owner) = user();
    let (_, thief) = user();
    let sid = SpaceId::random();
    let mut l = Log::new();
    l.push_at(&owner, 5, NOW, create_with_nonce(None));
    let honest = l.events.clone();
    l.push_at(&thief, 1, NOW, create_with_nonce(None));
    let mut input = l.input(sid, "S", "Team", false);
    assert_eq!(
        owners(&report(&ctx(owner), &input)),
        vec![thief.to_string()],
        "unpinned: first in fold order wins"
    );
    input.creator = hermod_core::projections::genesis_author(&sid, &honest);
    assert_eq!(input.creator, Some(owner));
    assert_eq!(
        owners(&report(&ctx(owner), &input)),
        vec![owner.to_string()]
    );
}

#[test]
fn revoke_listing_joiners_rejects_backdated_joins() {
    let (_, owner) = user();
    let (_, early) = user();
    let (_, late) = user();
    let sid = SpaceId::random();
    let mut l = Log::new();
    l.push(&owner, NOW, space_create("S", &["chat"]));
    l.push(
        &owner,
        NOW,
        EventBody::InviteCreate {
            id: "i".into(),
            exp: None,
            max_uses: None,
            role: Role::Member,
        },
    );
    let join = || EventBody::MemberJoin {
        via_invite_from: None,
        pow: None,
        invite: Some("i".into()),
    };
    l.push(&early, NOW, join());
    let revoke = EventBody::InviteRevoke {
        id: "i".into(),
        joined: Some(vec![early.to_string()]),
    };
    l.push_at(&owner, 10, NOW, revoke);
    // Signed just after invite.create, long before the revoke in fold order.
    l.push_at(&late, 3, NOW, join());
    let rep = report(&ctx(owner), &l.input(sid, "S", "Team", false));
    let users: Vec<_> = rep.members.iter().map(|m| m.user.clone()).collect();
    assert!(
        users.contains(&early.to_string()),
        "honest earlier join stays"
    );
    assert!(!users.contains(&late.to_string()));
}

#[test]
fn removed_admin_cannot_backdate_events_past_the_removal() {
    let (_, owner) = user();
    let (_, admin) = user();
    let sid = SpaceId::random();
    let invite = |id: &str, role| EventBody::InviteCreate {
        id: id.into(),
        exp: None,
        max_uses: None,
        role,
    };
    let mut l = Log::new();
    l.push(&owner, NOW, space_create("S", &["chat"]));
    l.push(&owner, NOW, invite("i", Role::Admin));
    let join = EventBody::MemberJoin {
        via_invite_from: None,
        pow: None,
        invite: Some("i".into()),
    };
    l.push(&admin, NOW, join);
    let remove = EventBody::MemberRemove {
        user: admin.to_string(),
        last_seq: Some(1),
    };
    l.push_at(&owner, 10, NOW, remove);
    // The admin's second event claims a lamport before the removal.
    l.push_at(&admin, 4, NOW, invite("backdoor", Role::Member));
    let rep = report(&ctx(owner), &l.input(sid, "S", "Team", false));
    assert!(rep.invites.iter().all(|i| i.id != "backdoor"));
}

fn set_pow(bits: u8) -> EventBody {
    EventBody::SpaceUpdate {
        name: None,
        tagline: None,
        sections: None,
        map_style: None,
        join_pow_bits: Some(bits),
    }
}

/// The space asks `at_invite` bits when the invite is made, then `after` bits; true when a join
/// carrying `nonce(joiner)` is admitted.
fn pow_joined(at_invite: u8, after: u8, nonce: impl Fn(&str) -> Option<u64>) -> bool {
    let (_, owner) = user();
    let (_, joiner) = user();
    let mut l = Log::new();
    l.push(&owner, NOW, space_create("S", &["chat"]));
    l.push(&owner, NOW, set_pow(at_invite));
    l.push(&owner, NOW, invite());
    l.push(&owner, NOW, set_pow(after));
    l.push(
        &joiner,
        NOW,
        EventBody::MemberJoin {
            via_invite_from: None,
            invite: Some("inv".into()),
            pow: nonce(&joiner.to_string()),
        },
    );
    let rep = report(&ctx(owner), &l.input(SpaceId::random(), "S", "Team", false));
    rep.members.iter().any(|m| m.user == joiner.to_string())
}

#[test]
fn join_pow_admits_valid_nonce_and_rejects_missing_or_weak() {
    use hermod_core::pow;
    let mined =
        |bits: u8| move |who: &str| pow::mine("inv", who, bits, &AtomicBool::new(false)).unwrap();
    assert!(pow_joined(10, 10, mined(10)), "valid nonce admitted");
    assert!(!pow_joined(10, 10, |_| None), "missing nonce rejected");
    let weak = |who: &str| (0..).find(|n| !pow::verify("inv", who, Some(*n), 10));
    assert!(!pow_joined(10, 10, weak), "insufficient nonce rejected");
    assert!(pow_joined(0, 0, |_| None), "0 bits needs no work");
}

#[test]
fn invite_keeps_the_bits_the_space_asked_when_it_was_made() {
    use hermod_core::pow;
    let mined =
        |bits: u8| move |who: &str| pow::mine("inv", who, bits, &AtomicBool::new(false)).unwrap();
    assert!(
        pow_joined(0, 16, |_| None),
        "an invite made at 0 bits still admits a no-work join after the space goes to 16"
    );
    assert!(
        !pow_joined(10, 0, |_| None),
        "an invite made at 10 bits still needs work after the space drops to 0"
    );
    assert!(pow_joined(10, 0, mined(10)));
    // A forged invite code claiming fewer bits makes the joiner mine too little.
    let forged = |who: &str| {
        (0..).find(|n| {
            pow::verify("inv", who, Some(*n), 4) && !pow::verify("inv", who, Some(*n), 10)
        })
    };
    assert!(
        !pow_joined(10, 10, forged),
        "forged lower pow_bits rejected"
    );
}

#[test]
fn join_pow_bits_cap_and_invite_carry() {
    let (_d, a) = core();
    let s = a.space_create("P", "", "Team").unwrap().id;
    let upd = |b: u8| EventBody::SpaceUpdate {
        name: None,
        tagline: None,
        sections: None,
        map_style: None,
        join_pow_bits: Some(b),
    };
    let over = hermod_core::pow::MAX_JOIN_POW_BITS + 1;
    assert!(a.append(&s, upd(over)).is_err(), "above the cap refused");
    a.append(&s, upd(4)).unwrap();
    let bits = snap(&a)
        .spaces
        .iter()
        .find(|x| x.name == "P")
        .unwrap()
        .join_pow_bits;
    assert_eq!(bits, 4);
    let out = a.invite_create(&s, None, vec![]).unwrap();
    let inv = hermod_core::invite::InviteV1::parse(&out.code).unwrap();
    assert_eq!(inv.pow_bits, 4, "invite carries the bits for the joiner");
}

#[test]
fn cancelled_join_work_stores_nothing() {
    let (_da, a) = core();
    let (_db, b) = core();
    let s = a.space_create("W", "", "Team").unwrap().id;
    a.append(&s, set_pow(hermod_core::pow::MAX_JOIN_POW_BITS))
        .unwrap();
    let code = a.invite_create(&s, None, vec![]).unwrap().code;
    let stop = AtomicBool::new(true);
    assert!(matches!(
        b.invite_accept_cancellable(&code, &stop),
        Err(Error::Cancelled)
    ));
    assert!(
        b.resolve_space(&s.to_string()).is_err(),
        "a cancelled join leaves no space behind"
    );
}
