mod common;

use std::collections::BTreeMap;

use hermod_core::crypto::SpaceKey;
use hermod_core::event::{EventBody, SignedEvent};
use hermod_core::identity::Identity;
use hermod_core::ids::SpaceId;
use hermod_core::invite::InviteV1;
use hermod_core::projections::shapes::Snapshot;
use hermod_core::projections::{ProjectionCtx, SpaceInput, project};
use hermod_core::store::{IngestStatus, Source, SpaceRow, Store};
use hermod_core::{Core, Error, ProfileInput};
use serde_json::Value;

fn core() -> (tempfile::TempDir, Core) {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(dir.path()).unwrap();
    (dir, core)
}

fn snap(c: &Core) -> Snapshot {
    serde_json::from_value(c.snapshot().unwrap()).unwrap()
}

fn say(c: &Core, space: &SpaceId, id: &str, text: &str) -> SignedEvent {
    c.append(space, common::post_msg("general", id, text))
        .unwrap()
}

/// Pushes every event `from` has that `to` lacks.
fn sync(from: &Core, to: &Core, space: &SpaceId) {
    for ev in from
        .missing_since(space, &to.vector(space).unwrap())
        .unwrap()
    {
        to.ingest_sync(ev).unwrap();
    }
}

#[test]
fn fresh_store_is_an_empty_home_plus_the_local_profile() {
    let (dir, c) = core();
    let s = snap(&c);
    assert_eq!(s.spaces.len(), 1);
    let home = &s.spaces[0];
    assert_eq!(
        (home.id.as_str(), home.kind.as_str(), home.name.as_str()),
        ("home", "Personal", "Home")
    );
    assert_eq!(home.default_channel.as_deref(), Some("general"));
    assert_eq!((home.members, home.online), (None, None));
    assert_eq!(home.growth.members, 1);
    let me = c.user_id().to_string();
    assert_eq!(s.people.len(), 2, "me and the system voice only");
    assert_eq!(s.people[&me].name, c.user_id().short());
    assert!(s.collections.messages["home/general"].is_empty());
    let col = &s.collections;
    assert!(
        col.docs.is_empty()
            && col.events.is_empty()
            && col.letters.is_empty()
            && col.inbox.is_empty()
    );
    assert!(
        col.media.videos.is_empty() && col.media.stories.is_empty() && col.feed["home"].is_empty()
    );
    assert!(col.workboards.is_empty() && col.skein.is_empty() && col.rooms.is_empty());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.path().join("identity.key"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn state_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let (user, sid);
    {
        let c = Core::open(dir.path()).unwrap();
        user = c.user_id();
        sid = c.space_create("Persist", "tag", "Team").unwrap().id;
        say(&c, &sid, "m1", "still here");
        c.setting_set("theme", "dusk").unwrap();
    }
    let c = Core::open(dir.path()).unwrap();
    assert_eq!(c.user_id(), user);
    assert_eq!(c.spaces().unwrap().len(), 2, "home is not recreated");
    assert_eq!(
        snap(&c).collections.messages[&format!("{sid}/general")][0].text,
        "still here"
    );
    assert_eq!(c.setting_get("theme").unwrap().as_deref(), Some("dusk"));
    assert_eq!(
        c.resolve_space("home").unwrap(),
        c.spaces()
            .unwrap()
            .iter()
            .find(|s| s.home)
            .unwrap()
            .space_id
            .parse()
            .unwrap()
    );
}

#[test]
fn space_create_emits_the_documented_events() {
    let (_d, c) = core();
    let made = c.space_create("Kiln Club", "Potters", "Community").unwrap();
    let key = InviteV1::decode(&c.invite_create(&made.id, None, vec![]).unwrap().code)
        .unwrap()
        .space_key;
    let bodies: Vec<_> = made
        .events
        .iter()
        .map(|e| e.open(&key).unwrap().body)
        .collect();
    assert!(matches!(bodies[0], EventBody::SpaceCreate { .. }));
    assert!(matches!(bodies[1], EventBody::ChannelCreate { .. }));
    assert!(matches!(bodies[2], EventBody::ProfileSet { .. }));
    assert_eq!(
        bodies.len(),
        3,
        "the creator is owner and member through space.create alone"
    );
    assert_eq!(
        made.events.iter().map(|e| e.seq).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    let s = snap(&c);
    let sp = s
        .spaces
        .iter()
        .find(|x| x.id == made.id.to_string())
        .unwrap();
    assert_eq!(
        (
            sp.name.as_str(),
            sp.mono.as_str(),
            sp.kind.as_str(),
            sp.members
        ),
        ("Kiln Club", "K", "Community", Some(1))
    );
    assert_eq!(s.collections.channels[&made.label][0].id, "general");
    assert!(c.space_create("  ", "", "Team").is_err());
}

#[test]
fn two_peers_join_by_invite_and_converge() {
    let (_da, a) = core();
    let (_db, b) = core();
    a.profile_set(ProfileInput {
        name: "Ada Okafor".into(),
        bio: "Producer".into(),
        ..Default::default()
    })
    .unwrap();
    b.profile_set(ProfileInput {
        name: "Bea Quist".into(),
        ..Default::default()
    })
    .unwrap();
    let sid = a.space_create("Shared", "both of us", "Team").unwrap().id;
    say(&a, &sid, "a1", "welcome");

    let invite = a
        .invite_create(&sid, Some(3600), vec!["/ip4/127.0.0.1/tcp/4001".into()])
        .unwrap();
    assert!(
        invite
            .link
            .starts_with("https://hotocoo.github.io/hermod/join#")
    );
    assert!(invite.deep_link.starts_with("hermod://join/"));
    let joined = b.invite_accept(&invite.link).unwrap();
    assert_eq!(
        (joined.id, joined.name.as_str(), joined.addrs.len()),
        (sid, "Shared", 1)
    );
    assert_eq!(joined.events.len(), 2);
    assert!(
        b.invite_accept(&invite.code).unwrap().events.is_empty(),
        "idempotent"
    );

    sync(&a, &b, &sid);
    say(&b, &sid, "b1", "thanks");
    sync(&b, &a, &sid);
    assert_eq!(a.vector(&sid).unwrap(), b.vector(&sid).unwrap());

    let (sa, sb) = (snap(&a), snap(&b));
    let key = format!("{sid}/general");
    assert_eq!(sa.collections.messages[&key], sb.collections.messages[&key]);
    assert_eq!(
        sa.collections.messages[&key]
            .iter()
            .map(|m| m.id.as_str())
            .collect::<Vec<_>>(),
        vec!["a1", "b1"]
    );
    let space = |s: &Snapshot| {
        s.spaces
            .iter()
            .find(|x| x.id == sid.to_string())
            .unwrap()
            .clone()
    };
    assert_eq!(space(&sa).role.as_deref(), Some("owner"));
    assert_eq!(space(&sb).role.as_deref(), Some("member"));
    let shared = |s: &Snapshot| hermod_core::projections::shapes::Space {
        role: None,
        ..space(s)
    };
    assert_eq!(
        shared(&sa),
        shared(&sb),
        "everything but the local role is identical"
    );
    assert_eq!(space(&sa).members, Some(2));
    assert_eq!(sb.people[&a.user_id().to_string()].name, "Ada Okafor");
    assert_eq!(sa.people[&b.user_id().to_string()].name, "Bea Quist");
    assert_eq!(sb.spaces[1].name, "Shared");
    let unread = sb.collections.channels[&sid.to_string()][0].unread;
    assert_eq!(unread, Some(1), "a1 is unread for b");
    b.mark_read(&sid, "general").unwrap();
    assert_eq!(
        snap(&b).collections.channels[&sid.to_string()][0].unread,
        None
    );
}

/// A peer's concurrent message can carry a lamport below a read marker and reach this device afterwards;
/// it was never seen, so it must stay unread (the marker covers what had arrived, not a lamport range).
#[test]
fn concurrent_peer_message_arriving_after_mark_read_stays_unread() {
    let (_da, a) = core();
    let (_db, b) = core();
    let sid = a.space_create("Race", "", "Team").unwrap().id;
    b.invite_accept(&a.invite_create(&sid, None, vec![]).unwrap().code)
        .unwrap();
    sync(&a, &b, &sid);
    sync(&b, &a, &sid);
    let unread = |c: &Core| snap(c).collections.channels[&sid.to_string()][0].unread;

    for i in 1..=3 {
        say(&a, &sid, &format!("a{i}"), &format!("ahead {i}"));
    }
    let late = say(&b, &sid, "b1", "written while a was typing");

    a.mark_read(&sid, "general").unwrap();
    assert!(
        late.lamport < a.read_markers().unwrap()[&format!("{sid}/general")],
        "b1 is concurrent: its lamport is below what a has already seen"
    );
    assert_eq!(unread(&a), None);
    sync(&b, &a, &sid);
    assert_eq!(unread(&a), Some(1), "b1 arrived after the marker");
    a.mark_read(&sid, "general").unwrap();
    assert_eq!(unread(&a), None, "reading again covers it");
    assert!(
        snap(&a)
            .collections
            .inbox
            .iter()
            .all(|e| e.read || e.ch != "general")
    );
}

#[test]
fn seq_gap_stays_pending_until_filled() {
    let (_da, a) = core();
    let (_db, b) = core();
    let sid = a.space_create("Gap", "", "Team").unwrap().id;
    b.invite_accept(&a.invite_create(&sid, None, vec![]).unwrap().code)
        .unwrap();
    sync(&a, &b, &sid);
    let evs: Vec<_> = (1..=3)
        .map(|i| say(&a, &sid, &format!("m{i}"), &format!("msg {i}")))
        .collect();
    let key = format!("{sid}/general");
    assert_eq!(
        b.ingest(evs[2].clone()).unwrap().status,
        IngestStatus::Pending
    );
    assert_eq!(
        b.ingest(evs[1].clone()).unwrap().status,
        IngestStatus::Pending
    );
    assert!(
        snap(&b).collections.messages[&key].is_empty(),
        "pending events are invisible"
    );
    let done = b.ingest(evs[0].clone()).unwrap();
    assert_eq!(done.applied.len(), 3);
    assert_eq!(snap(&b).collections.messages[&key].len(), 3);
    assert_eq!(
        b.ingest(evs[0].clone()).unwrap().status,
        IngestStatus::Duplicate
    );
}

#[test]
fn ingest_rejects_forged_and_foreign_events() {
    let (_da, a) = core();
    let (_db, b) = core();
    let sid = a.space_create("Strict", "", "Team").unwrap().id;
    let ev = say(&a, &sid, "m1", "hello");
    assert!(
        matches!(b.ingest(ev.clone()), Err(Error::UnknownSpace(_))),
        "b holds no key for this space"
    );
    b.invite_accept(&a.invite_create(&sid, None, vec![]).unwrap().code)
        .unwrap();
    let mut forged = ev.clone();
    forged.ts += 1;
    assert!(matches!(b.ingest(forged), Err(Error::BadSignature)));
    let key = InviteV1::decode(&a.invite_create(&sid, None, vec![]).unwrap().code)
        .unwrap()
        .space_key;
    let wrong = SignedEvent::create(
        &Identity::generate(),
        &SpaceKey::random(),
        0,
        sid,
        1,
        1,
        1,
        &EventBody::MemberLeave {},
    )
    .unwrap();
    assert!(matches!(b.ingest(wrong), Err(Error::Decrypt)));
    let outsider = Identity::generate();
    let fine = SignedEvent::create(
        &outsider,
        &key,
        0,
        sid,
        1,
        1,
        1,
        &common::post_msg("general", "x", "key holders are members"),
    )
    .unwrap();
    assert_eq!(
        b.ingest(fine).unwrap().status,
        IngestStatus::Applied,
        "the store holds anything the key opens"
    );
    let key_holder = outsider.user_id().to_string();
    let shown = &snap(&b).collections.messages;
    assert!(
        shown.values().flatten().all(|m| m.by != key_holder),
        "but the fold ignores authors who never joined through an invite"
    );
    assert!(b.append(&sid, EventBody::Unknown).is_err());
}

#[test]
fn unknown_event_types_are_stored_and_relayed_but_ignored() {
    let (_da, a) = core();
    let (_db, b) = core();
    let sid = a.space_create("Future", "", "Team").unwrap().id;
    let key = InviteV1::decode(&a.invite_create(&sid, None, vec![]).unwrap().code)
        .unwrap()
        .space_key;
    b.invite_accept(&a.invite_create(&sid, None, vec![]).unwrap().code)
        .unwrap();

    let raw = serde_json::json!({"t": "hologram.cast", "power": 9});
    let mut plain = Vec::new();
    ciborium::into_writer(&raw, &mut plain).unwrap();
    let peer = Identity::generate();
    let (nonce, ct) = hermod_core::crypto::seal(&key, &plain).unwrap();
    let mut ev = SignedEvent {
        space_id: sid,
        author: peer.user_id(),
        epoch: 0,
        seq: 1,
        lamport: 5,
        ts: 1,
        nonce,
        body: ct,
        sig: [0; 64],
    };
    ev.sig = peer.sign(&ev.digest());

    let before = snap(&b).collections;
    assert_eq!(b.ingest(ev.clone()).unwrap().status, IngestStatus::Applied);
    assert_eq!(
        snap(&b).collections,
        before,
        "unknown events change no projection"
    );
    assert!(
        b.missing_since(&sid, &BTreeMap::new())
            .unwrap()
            .contains(&ev),
        "relayed untouched"
    );
}

#[test]
fn shuffled_ingest_converges_in_the_store() {
    // Real signed, encrypted events from two authors ingested in different orders into two stores.
    let (ia, ib) = (Identity::generate(), Identity::generate());
    let key = SpaceKey::random();
    let sid = SpaceId::random();
    let mut events = Vec::new();
    let mut seqs = [0u64; 2];
    let mut lamport = 0u64;
    let mut push = |who: usize, body: EventBody| {
        let id = if who == 0 { &ia } else { &ib };
        lamport += 1;
        seqs[who] += 1;
        events.push(
            SignedEvent::create(
                id,
                &key,
                0,
                sid,
                seqs[who],
                lamport,
                1_000 + lamport as i64,
                &body,
            )
            .unwrap(),
        );
    };
    push(0, common::space_create("Merge", &["chat"]));
    push(0, common::invite());
    push(1, common::join());
    for i in 1..=5 {
        push(0, common::post_msg("general", &format!("a-{i}"), "hi"));
        push(1, common::post_msg("general", &format!("b-{i}"), "hi"));
    }
    let row = SpaceRow {
        epoch: 0,
        id: sid,
        key: key.clone(),
        name: "Merge".into(),
        kind: "Team".into(),
        is_home: false,
        joined_at: 1,
        left: false,
    };
    let run = |order: Vec<usize>| {
        let mut store = Store::open_in_memory().unwrap();
        store.add_space(&row).unwrap();
        for i in order {
            store.ingest_from(&events[i], Source::Sync).unwrap();
        }
        assert_eq!(store.pending_count(&sid).unwrap(), 0);
        let input = SpaceInput {
            id: sid,
            name: "Merge".into(),
            kind: "Team".into(),
            is_home: false,
            events: store.load_opened(&row).unwrap(),
        };
        let snap = project(&ProjectionCtx::new(ia.user_id(), common::NOW), &[input]);
        assert_eq!(
            snap.collections.messages[&format!("{sid}/general")].len(),
            10
        );
        serde_json::to_string(&snap).unwrap()
    };
    let forward: Vec<usize> = (0..events.len()).collect();
    let mut reversed = forward.clone();
    reversed.reverse();
    let mut interleaved: Vec<usize> = forward.iter().copied().filter(|i| i % 2 == 1).collect();
    interleaved.extend(forward.iter().copied().filter(|i| i % 2 == 0).rev());
    let reference = run(forward);
    assert_eq!(run(reversed), reference);
    assert_eq!(run(interleaved), reference);
}

#[test]
fn profile_set_publishes_to_every_space_and_validates() {
    let (_d, c) = core();
    let sid = c.space_create("One", "", "Team").unwrap().id;
    let events = c
        .profile_set(ProfileInput {
            name: "Juno Park".into(),
            bio: "Community lead".into(),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(events.len(), 2, "home and the new space");
    let info = c.identity().unwrap();
    assert_eq!(
        (
            info.name.as_str(),
            info.initials.as_str(),
            info.bio.as_str()
        ),
        ("Juno Park", "JP", "Community lead")
    );
    let s = snap(&c);
    assert_eq!(s.people[&c.user_id().to_string()].i, "JP");
    assert_eq!(s.people[&c.user_id().to_string()].role, "Community lead");
    assert!(
        c.profile_set(ProfileInput {
            name: "  ".into(),
            ..Default::default()
        })
        .is_err()
    );
    assert!(c.space_leave(&sid).is_ok());
    assert_eq!(
        c.profile_set(ProfileInput {
            name: "Juno P".into(),
            ..Default::default()
        })
        .unwrap()
        .len(),
        1,
        "left spaces are skipped"
    );
}

#[test]
fn home_is_local_only_and_leaving_works() {
    let (_d, c) = core();
    let home = c.resolve_space("home").unwrap();
    assert!(c.invite_create(&home, None, vec![]).is_err());
    assert!(c.space_leave(&home).is_err());
    let sid = c.space_create("Temp", "", "Team").unwrap().id;
    let code = c.invite_create(&sid, None, vec![]).unwrap().code;
    c.space_leave(&sid).unwrap();
    assert_eq!(c.spaces().unwrap().len(), 1);
    assert!(
        c.append(&sid, common::post_msg("general", "x", "x"))
            .is_err()
    );
    let rejoined = c.invite_accept(&code).unwrap();
    assert_eq!(
        rejoined.events.len(),
        2,
        "rejoining a left space is allowed"
    );
    assert_eq!(snap(&c).spaces.len(), 2);
    assert!(c.resolve_space("nope").is_err());
}

#[test]
fn expired_and_malformed_invites_are_refused() {
    let (_da, a) = core();
    let (_db, b) = core();
    let sid = a.space_create("Brief", "", "Team").unwrap().id;
    let expired = a.invite_create(&sid, Some(0), vec![]).unwrap();
    assert!(matches!(
        b.invite_accept(&expired.code),
        Err(Error::InviteExpired)
    ));
    assert!(b.invite_accept("definitely not an invite").is_err());
    assert_eq!(b.spaces().unwrap().len(), 1);
}

#[test]
fn legal_and_settings() {
    let (_d, c) = core();
    let before = c.legal_status().unwrap();
    assert_eq!(
        (
            before.accepted_version,
            before.accepted_at,
            before.share_resources
        ),
        (None, None, false)
    );
    let after = c.legal_accept("2026-10", true).unwrap();
    assert_eq!(after.accepted_version.as_deref(), Some("2026-10"));
    assert!(after.share_resources && after.accepted_at.is_some());
    assert!(c.legal_accept("", false).is_err());
    assert!(!c.legal_accept("2026-11", false).unwrap().share_resources);

    c.setting_set("relay.max_circuits", "8").unwrap();
    c.setting_set("tz_offset_secs", "3600").unwrap();
    assert_eq!(c.settings().unwrap().len(), 2);
    assert!(c.setting_set("bad key!", "x").is_err());
    assert!(c.setting_set("ok", &"x".repeat(5000)).is_err());
    let home = c.resolve_space("home").unwrap();
    c.append(&home, common::post_msg("general", "t", "now"))
        .unwrap();
    let clock = |c: &Core| -> u32 {
        let v = c.snapshot().unwrap();
        v["collections"]["messages"]["home/general"][0]["t"]
            .as_str()
            .unwrap()[..2]
            .parse()
            .unwrap()
    };
    c.setting_set("tz_offset_secs", "0").unwrap();
    let utc = clock(&c);
    c.setting_set("tz_offset_secs", "3600").unwrap();
    assert_eq!(clock(&c), (utc + 1) % 24);
}

#[test]
fn blobs_attach_to_messages_and_stream() {
    let (_d, c) = core();
    let data: Vec<u8> = (0..600_000).map(|i| (i % 253) as u8).collect();
    let blob = c.blob_put_bytes("photo.png", &data).unwrap();
    assert_eq!((blob.size, blob.mime.as_str()), (600_000, "image/png"));
    let home = c.resolve_space("home").unwrap();
    c.append(
        &home,
        EventBody::MessagePost {
            channel_id: "general".into(),
            msg_id: "p".into(),
            text: "look".into(),
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
    assert_eq!(
        snap(&c).collections.messages["home/general"][0]
            .img
            .as_deref(),
        Some("photo.png")
    );
    assert_eq!(
        c.blobs().read_range(&blob.hash, 262_000, 500).unwrap(),
        &data[262_000..262_500]
    );
    assert!(c.blobs().is_complete(&blob.hash).unwrap());
    let path = _d.path().join("note.md");
    std::fs::write(&path, b"# hi").unwrap();
    let from_path = c.blob_put_path(&path).unwrap();
    assert_eq!(
        (
            from_path.name.as_str(),
            from_path.mime.as_str(),
            from_path.size
        ),
        ("note.md", "text/plain", 4)
    );
}

#[test]
fn snapshot_value_has_seed_shape() {
    let (_d, c) = core();
    let v: Value = c.snapshot().unwrap();
    assert!(v["people"].is_object() && v["spaces"].is_array() && v["collections"].is_object());
    assert!(v.get("sections").is_none(), "UI copy lives in the frontend");
}
