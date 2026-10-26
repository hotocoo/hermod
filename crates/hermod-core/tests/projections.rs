mod common;

use common::*;
use hermod_core::event::*;
use hermod_core::growth::GrowthConfig;
use hermod_core::ids::SpaceId;
use hermod_core::projections::shapes::Snapshot;
use hermod_core::projections::{SpaceInput, project};

fn blob(name: &str) -> BlobRef {
    BlobRef {
        hash: "ab".repeat(32),
        size: 1,
        name: name.into(),
        mime: "image/png".into(),
    }
}

struct Studio {
    sid: SpaceId,
    me: hermod_core::ids::UserId,
    ada: hermod_core::ids::UserId,
    bea: hermod_core::ids::UserId,
    inputs: Vec<SpaceInput>,
}

/// A populated studio space plus an empty home, built from real events only.
fn studio() -> Studio {
    let (_, me) = user();
    let (_, ada) = user();
    let (_, bea) = user();
    let (sid, home) = (SpaceId::random(), SpaceId::random());
    let mut l = Log::new();
    let t = |mins: i64| NOW - mins * MIN;

    l.push(
        &ada,
        t(900),
        space_create(
            "Ashgrove Studio",
            &["chat", "hearth", "feed", "board", "skein"],
        ),
    );
    l.push(&ada, t(895), invite());
    for u in [&bea, &me] {
        l.push(u, t(890), join());
    }
    l.push(&ada, t(889), profile("Ada Okafor", "Producer"));
    l.push(&bea, t(888), profile("Bea Quist", "Potter"));
    l.push(&me, t(887), profile("Me Myself", ""));
    l.push(&ada, t(880), channel("general"));
    l.push(&ada, t(879), channel("art"));

    l.push(&ada, t(300), post_msg("art", "a1", "Pushed the palette"));
    l.push(&bea, t(290), post_msg("art", "a2", "Lovely"));
    l.push(
        &bea,
        t(280),
        EventBody::MessagePost {
            channel_id: "art".into(),
            msg_id: "a3".into(),
            text: "reply".into(),
            reply_to: Some("a1".into()),
            attachments: vec![],
            snap: None,
            mentions: vec![],
            preview: None,
            target: None,
            ext: None,
        },
    );
    l.push(
        &me,
        t(270),
        EventBody::ReactionToggle {
            target_id: "a1".into(),
            label: "yes".into(),
        },
    );
    l.push(
        &ada,
        t(269),
        EventBody::ReactionToggle {
            target_id: "a1".into(),
            label: "yes".into(),
        },
    );
    l.push(
        &bea,
        t(260),
        EventBody::MessagePost {
            channel_id: "art".into(),
            msg_id: "a4".into(),
            text: "ref photo".into(),
            reply_to: None,
            attachments: vec![blob("marsh.png")],
            snap: None,
            mentions: vec![],
            preview: None,
            target: None,
            ext: None,
        },
    );
    l.push(
        &ada,
        t(250),
        EventBody::MessageEdit {
            msg_id: "a2".into(),
            text: "hijack".into(),
        },
    );
    l.push(
        &bea,
        t(249),
        EventBody::MessageEdit {
            msg_id: "a2".into(),
            text: "Lovely, truly".into(),
        },
    );
    l.push(&bea, t(240), post_msg("art", "a5", "oops"));
    l.push(
        &bea,
        t(239),
        EventBody::MessageDelete {
            msg_id: "a5".into(),
        },
    );
    l.push(
        &ada,
        t(100),
        EventBody::MessagePost {
            channel_id: "general".into(),
            msg_id: "g1".into(),
            text: "Pastries".into(),
            reply_to: None,
            attachments: vec![],
            snap: Some("s1".into()),
            mentions: vec![],
            preview: None,
            target: None,
            ext: None,
        },
    );

    // skein
    l.push(
        &bea,
        t(230),
        EventBody::LineCreate {
            line_id: "lantern-glow".into(),
            name: "lantern-glow".into(),
            note: "palette work".into(),
            from_line: None,
        },
    );
    l.push(
        &bea,
        t(229),
        EventBody::SnapCreate {
            snap_id: "s1".into(),
            line_id: "lantern-glow".into(),
            title: "Warmer palette".into(),
            kind: "Design".into(),
            files: vec![SnapFileIn {
                path: "art/lantern.palette".into(),
                blob: None,
                adds: 3,
                dels: 3,
            }],
            parent: None,
        },
    );
    l.push(
        &bea,
        t(228),
        EventBody::SnapCreate {
            snap_id: "s2".into(),
            line_id: "lantern-glow".into(),
            title: "More plum".into(),
            kind: "Design".into(),
            files: vec![],
            parent: None,
        },
    );
    l.push(
        &ada,
        t(227),
        EventBody::SnapCreate {
            snap_id: "s3".into(),
            line_id: "main".into(),
            title: "Ramp".into(),
            kind: "Code".into(),
            files: vec![SnapFileIn {
                path: "src/ramp.rs".into(),
                blob: None,
                adds: 1,
                dels: 1,
            }],
            parent: None,
        },
    );

    // board
    l.push(
        &ada,
        t(220),
        EventBody::BoardCreate {
            board_id: "b1".into(),
            name: "Sprint 14".into(),
            due: "Ends Thursday".into(),
            cols: vec![
                ColumnIn {
                    col_id: "todo".into(),
                    name: "Ideas".into(),
                },
                ColumnIn {
                    col_id: "doing".into(),
                    name: "Making".into(),
                },
            ],
        },
    );
    l.push(
        &ada,
        t(219),
        EventBody::CardCreate {
            board_id: "b1".into(),
            card_id: "c1".into(),
            col_id: "todo".into(),
            title: "Fireflies".into(),
            tag: "Design".into(),
            snap: None,
        },
    );
    l.push(
        &bea,
        t(218),
        EventBody::CardCreate {
            board_id: "b1".into(),
            card_id: "c2".into(),
            col_id: "todo".into(),
            title: "Palette".into(),
            tag: "Art".into(),
            snap: Some("s2".into()),
        },
    );
    l.push(
        &bea,
        t(217),
        EventBody::CardMove {
            card_id: "c2".into(),
            col_id: "doing".into(),
        },
    );
    l.push(
        &ada,
        t(216),
        EventBody::CardUpdate {
            card_id: "c1".into(),
            title: Some("Fireflies at low health".into()),
            tag: None,
            snap: None,
            assignee: None,
            due: None,
        },
    );

    // hearth
    l.push(
        &ada,
        t(60),
        EventBody::RoomJoin {
            room: String::new(),
        },
    );
    l.push(
        &bea,
        t(59),
        EventBody::RoomJoin {
            room: String::new(),
        },
    );
    l.push(
        &bea,
        t(58),
        EventBody::RoomState {
            room: String::new(),
            muted: None,
            cam: Some(true),
            share: None,
        },
    );
    l.push(
        &ada,
        t(50),
        EventBody::MeetingStart {
            topic: "Palette walkthrough".into(),
            agenda: vec![
                AgendaItemIn {
                    text: "Warmer palette".into(),
                    who: "bea".into(),
                },
                AgendaItemIn {
                    text: "Glow falloff".into(),
                    who: "ada".into(),
                },
            ],
        },
    );
    l.push(&ada, t(49), EventBody::AgendaToggle { idx: 0 });
    l.push(
        &bea,
        t(48),
        EventBody::NoteAdd {
            text: "plum it is".into(),
        },
    );

    // feed and media
    l.push(
        &bea,
        t(500),
        EventBody::PostCreate {
            post_id: "p1".into(),
            kind: "photo".into(),
            title: "Cylinder".into(),
            text: None,
            blobs: vec![blob("cyl.png")],
            dur: None,
            chapters: vec![],
            captions: None,
        },
    );
    l.push(
        &ada,
        t(400),
        EventBody::PostCreate {
            post_id: "p2".into(),
            kind: "note".into(),
            title: "Devlog".into(),
            text: Some("Why it flickers".into()),
            blobs: vec![],
            dur: None,
            chapters: vec![],
            captions: None,
        },
    );
    l.push(
        &bea,
        t(300),
        EventBody::PostCreate {
            post_id: "p3".into(),
            kind: "video".into(),
            title: "Marsh at 3am".into(),
            text: Some("hydrophone".into()),
            blobs: vec![],
            dur: Some("2:14".into()),
            chapters: vec![],
            captions: None,
        },
    );
    l.push(
        &bea,
        t(200),
        EventBody::PostCreate {
            post_id: "p4".into(),
            kind: "video".into(),
            title: "Foot ring".into(),
            text: None,
            blobs: vec![],
            dur: Some("0:30".into()),
            chapters: vec![],
            captions: None,
        },
    );
    l.push(
        &me,
        t(190),
        EventBody::LikeToggle {
            target_id: "p1".into(),
        },
    );
    l.push(
        &ada,
        t(189),
        EventBody::LikeToggle {
            target_id: "p1".into(),
        },
    );
    l.push(
        &ada,
        t(188),
        EventBody::LikeToggle {
            target_id: "p1".into(),
        },
    );
    l.push(
        &me,
        t(187),
        EventBody::SaveToggle {
            target_id: "p3".into(),
        },
    );
    l.push(
        &bea,
        t(180),
        EventBody::StoryCreate {
            story_id: "st1".into(),
            items: vec![StoryItemIn {
                blob: blob("kiln.png"),
                caption: "Loading".into(),
            }],
            ttl_secs: 24 * 3600,
        },
    );
    l.push(
        &ada,
        t(170),
        EventBody::StoryCreate {
            story_id: "st2".into(),
            items: vec![StoryItemIn {
                blob: blob("old.png"),
                caption: "stale".into(),
            }],
            ttl_secs: 60,
        },
    );
    l.push(
        &bea,
        t(20),
        EventBody::LiveStart {
            live_id: "lv".into(),
            title: "Opening the kiln".into(),
        },
    );
    l.push(
        &ada,
        t(19),
        EventBody::LiveChat {
            live_id: "lv".into(),
            text: "so hot".into(),
        },
    );

    // pinboards, docs, calendar, letters
    l.push(
        &ada,
        t(160),
        EventBody::PinboardCreate {
            board_id: "pb".into(),
            name: "Moodboard".into(),
        },
    );
    l.push(
        &bea,
        t(159),
        EventBody::PinAdd {
            board_id: "pb".into(),
            blob: blob("dusk.png"),
            title: "Dusk".into(),
            label: "dusk reference".into(),
        },
    );
    l.push(
        &me,
        t(158),
        EventBody::PinAdd {
            board_id: "pb".into(),
            blob: blob("fog.png"),
            title: "Fog".into(),
            label: String::new(),
        },
    );
    l.push(
        &ada,
        t(150),
        EventBody::DocCreate {
            doc_id: "d1".into(),
            title: "Chapter two".into(),
            kicker: "lore".into(),
        },
    );
    l.push(
        &ada,
        t(149),
        EventBody::DocBlock {
            doc_id: "d1".into(),
            op: DocOp::Insert,
            block_id: "k1".into(),
            block: Some(DocBlockIn {
                k: "h".into(),
                text: "Where we are".into(),
                done: None,
            }),
            after: None,
        },
    );
    l.push(
        &bea,
        t(148),
        EventBody::DocBlock {
            doc_id: "d1".into(),
            op: DocOp::Insert,
            block_id: "k2".into(),
            block: Some(DocBlockIn {
                k: "t".into(),
                text: "Fireflies".into(),
                done: None,
            }),
            after: Some("k1".into()),
        },
    );
    l.push(
        &bea,
        t(147),
        EventBody::DocBlock {
            doc_id: "d1".into(),
            op: DocOp::Toggle,
            block_id: "k2".into(),
            block: None,
            after: None,
        },
    );
    l.push(
        &ada,
        t(140),
        EventBody::EventCreate {
            ev_id: "e1".into(),
            day: 1,
            start: 14.0,
            end: 15.0,
            title: "Palette review".into(),
            place: "The Hearth".into(),
            note: "n".into(),
            meeting: true,
        },
    );
    l.push(&bea, t(139), EventBody::EventRsvp { ev_id: "e1".into() });
    l.push(
        &ada,
        t(130),
        EventBody::LetterSend {
            to_space: Some(home.to_string()),
            channel_id: "art".into(),
            text: "A raven from the studio".into(),
        },
    );

    let mut h = Log::new();
    h.push(
        &me,
        t(2000),
        EventBody::SpaceCreate {
            name: "Home".into(),
            kind: "Personal".into(),
            tagline: "mine".into(),
            mono: "H".into(),
            sections: vec!["chat".into(), "feed".into()],
            nonce: None,
        },
    );

    Studio {
        sid,
        me,
        ada,
        bea,
        inputs: vec![
            h.input(home, "Home", "Personal", true),
            l.input(sid, "Ashgrove Studio", "Team", false),
        ],
    }
}

fn snapshot(s: &Studio) -> Snapshot {
    project(&ctx(s.me), &s.inputs)
}

#[test]
fn people_spaces_and_growth() {
    let s = studio();
    let snap = snapshot(&s);
    let ada = &snap.people[&s.ada.to_string()];
    assert_eq!(
        (ada.name.as_str(), ada.i.as_str(), ada.role.as_str()),
        ("Ada Okafor", "AO", "Producer")
    );
    assert_eq!(snap.people["system"].i, "H");
    assert!(snap.people.contains_key(&s.me.to_string()));

    assert_eq!(snap.spaces.len(), 2);
    let home = &snap.spaces[0];
    assert_eq!(
        (
            home.id.as_str(),
            home.kind.as_str(),
            home.members,
            home.online
        ),
        ("home", "Personal", None, None)
    );
    let sp = &snap.spaces[1];
    assert_eq!(sp.id, s.sid.to_string());
    assert_eq!(
        (sp.name.as_str(), sp.mono.as_str(), sp.members),
        ("Ashgrove Studio", "A", Some(3))
    );
    assert_eq!(sp.default_channel.as_deref(), Some("general"));
    assert_eq!(sp.meeting_channel.as_deref(), Some("general"));
    assert_eq!(sp.growth.tier, 2);
    assert_eq!(sp.growth.houses.len(), 3);
    assert_eq!(
        sp.growth
            .houses
            .iter()
            .map(|h| h.plot_index)
            .collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    assert_eq!(sp.growth.active7d, 3);
    assert_eq!(sp.growth.buildings.chat, 1);
    assert_eq!(sp.growth.buildings.hearth, 1);
    assert_eq!(snap.collections.rooms.len(), 1);
}

#[test]
fn chat_edits_reactions_threads_and_unread() {
    let s = studio();
    let snap = snapshot(&s);
    let key = format!("{}/art", s.sid);
    let msgs = &snap.collections.messages[&key];
    let ids: Vec<_> = msgs.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["a1", "a2", "a4", "a5"],
        "reply folded into thread, deleted kept as a tombstone"
    );
    let a1 = &msgs[0];
    assert_eq!(a1.thread.as_ref().unwrap()[0].text, "reply");
    let rx = &a1.rx.as_ref().unwrap()[0];
    assert_eq!((rx.l.as_str(), rx.n, rx.mine), ("yes", 2, Some(true)));
    assert_eq!(msgs[1].text, "Lovely, truly", "only the author may edit");
    assert_eq!(msgs[2].img.as_deref(), Some("marsh.png"));
    assert_eq!(a1.t, "07:30");

    let art = snap.collections.channels[&s.sid.to_string()]
        .iter()
        .find(|c| c.id == "art")
        .unwrap();
    assert_eq!(art.unread, Some(3), "a1, a2, a4 from others");
    assert_eq!(art.topic, "about art");

    let mut c = ctx(s.me);
    c.read_markers.insert((s.sid, "art".into()), u64::MAX);
    let read = project(&c, &s.inputs);
    let art = read.collections.channels[&s.sid.to_string()]
        .iter()
        .find(|c| c.id == "art")
        .unwrap();
    assert_eq!(art.unread, None);
    assert!(
        read.collections
            .inbox
            .iter()
            .all(|e| e.read || e.ch != "art")
    );
}

#[test]
fn hearth_agenda_and_meeting_summary() {
    let s = studio();
    let snap = snapshot(&s);
    let room = &snap.collections.rooms[&s.sid.to_string()];
    assert_eq!(room.in_room, vec![s.ada.to_string(), s.bea.to_string()]);
    assert!(room.cams[&s.bea.to_string()]);
    assert_eq!(room.topic, "Palette walkthrough");
    let agenda = &snap.collections.agenda;
    assert_eq!(agenda.len(), 2);
    assert!(agenda[0].done && !agenda[0].cur);
    assert!(agenda[1].cur);

    let mut s2 = studio();
    let mut extra = Log::new();
    extra.push_at(&s2.ada, 10_000, NOW - 10 * MIN, EventBody::MeetingEnd {});
    s2.inputs[1].events_mut().extend(extra.events);
    let snap = snapshot(&s2);
    let general = &snap.collections.messages[&format!("{}/general", s2.sid)];
    let summary = general
        .iter()
        .find(|m| m.by == "system")
        .expect("summary message");
    let meet = summary.meet.as_ref().unwrap();
    assert_eq!(
        (meet.title.as_str(), meet.notes, meet.done, meet.total),
        ("Palette walkthrough", 1, 1, 2)
    );
    assert_eq!(meet.dur, "40 min");
    assert!(snap.collections.agenda.is_empty(), "no active meeting");
    assert_eq!(snap.collections.rooms[&s2.sid.to_string()].topic, "");
}

#[test]
fn board_and_skein() {
    let s = studio();
    let snap = snapshot(&s);
    let board = &snap.collections.workboards[&s.sid.to_string()];
    assert_eq!(
        (board.name.as_str(), board.due.as_str()),
        ("Sprint 14", "Ends Thursday")
    );
    assert_eq!(
        board.cols[0]
            .cards
            .iter()
            .map(|c| c.title.as_str())
            .collect::<Vec<_>>(),
        vec!["Fireflies at low health"]
    );
    assert_eq!(board.cols[1].cards[0].id, "c2");
    assert_eq!(board.cols[1].cards[0].snap.as_deref(), Some("s2"));

    let skein = &snap.collections.skein[&s.sid.to_string()];
    assert_eq!(skein.repo, "ashgrove-studio");
    assert_eq!(skein.lines[0].id, "main");
    let glow = skein.lines.iter().find(|l| l.id == "lantern-glow").unwrap();
    assert_eq!(
        (glow.ahead, glow.by.as_deref()),
        (2, Some(s.bea.to_string().as_str()))
    );
    let ids: Vec<_> = skein.snaps.iter().map(|x| x.id.as_str()).collect();
    assert_eq!(ids, vec!["s3", "s2", "s1"], "newest first");
    let s1 = skein.snaps.iter().find(|x| x.id == "s1").unwrap();
    assert_eq!(s1.linked.label, "#general");
    assert_eq!(s1.linked.ch.as_deref(), Some("general"));
    assert_eq!(s1.files[0].kind, "swatch");
    assert_eq!(s1.seal.len(), 20);
    let s2 = skein.snaps.iter().find(|x| x.id == "s2").unwrap();
    assert_eq!(s2.linked.label, "Sprint 14 \u{b7} Making");
    assert_eq!(
        s2.parent,
        s1.seal[..8],
        "parent defaults to the previous snap on the line"
    );

    let msg = snap.collections.messages[&format!("{}/general", s.sid)]
        .iter()
        .find(|m| m.id == "g1")
        .unwrap();
    assert_eq!(msg.snap.as_ref().unwrap().files, 1);

    let mut s2 = studio();
    let mut extra = Log::new();
    extra.push_at(
        &s2.ada,
        10_000,
        NOW,
        EventBody::LineWeave {
            line_id: "lantern-glow".into(),
            into: "main".into(),
        },
    );
    s2.inputs[1].events_mut().extend(extra.events);
    let skein = &snapshot(&s2).collections.skein[&s2.sid.to_string()];
    assert_eq!(
        skein
            .lines
            .iter()
            .find(|l| l.id == "lantern-glow")
            .unwrap()
            .ahead,
        0
    );
    assert!(
        skein
            .snaps
            .iter()
            .any(|x| x.weave_of.as_deref() == Some("lantern-glow") && x.line == "main")
    );

    // A-010: the weave also folds a system chat message every peer can read.
    let snap2 = snapshot(&s2);
    let sys = snap2.collections.messages[&format!("{}/general", s2.sid)]
        .iter()
        .find(|m| m.id.starts_with("weave-msg-"))
        .expect("the weave posts a system message");
    assert_eq!(sys.by, "system");
    assert_eq!(sys.text, "Wove lantern-glow into main");
}

#[test]
fn feed_media_stories_and_pinboards() {
    let s = studio();
    let snap = snapshot(&s);
    let sid = s.sid.to_string();
    let feed = &snap.collections.feed[&sid];
    assert_eq!(
        feed.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
        vec!["p4", "p3", "p2", "p1"],
        "newest first"
    );
    let p1 = feed.iter().find(|p| p.id == "p1").unwrap();
    assert_eq!(
        (p1.likes, p1.kind.as_str(), p1.space.as_str()),
        (1, "photo", "Ashgrove Studio")
    );
    assert_eq!(p1.label, "photo \u{b7} cyl.png");
    assert!((200..360).contains(&p1.h));
    let note = feed.iter().find(|p| p.id == "p2").unwrap();
    assert_eq!((note.h, note.text.as_deref()), (0, Some("Why it flickers")));
    assert_eq!(
        snap.collections.feed["home"].len(),
        4,
        "home feed aggregates every space"
    );

    let media = &snap.collections.media;
    // A short is also listed as a video so the player can open it; the Shorts row is a highlight.
    assert_eq!(media.videos.len(), 2);
    let long = media.videos.iter().find(|v| v.len == 134).unwrap();
    assert_eq!(long.desc, "hydrophone");
    assert_eq!(media.shorts.len(), 1);
    assert_eq!(media.shorts[0].title, "Foot ring");
    assert_eq!(
        media.stories.len(),
        1,
        "expired story dropped, grouped per author"
    );
    assert_eq!(
        (media.stories[0].by.as_str(), media.stories[0].when.as_str()),
        (s.bea.to_string().as_str(), "3h")
    );
    assert_eq!(media.stories[0].items[0].label, "kiln.png");
    assert_eq!(media.live.title, "Opening the kiln");
    assert_eq!((media.live.viewers, media.live.chat.len()), (2, 1));

    let boards = &snap.collections.pinboards;
    assert_eq!(boards.len(), 2);
    assert_eq!(boards[0].who, "Ada and 2 others");
    assert_eq!(boards[0].pins.len(), 2);
    assert_eq!(boards[0].pins[0].label, "dusk reference");
    assert_eq!(
        boards[0].pins[1].label, "fog.png",
        "label falls back to blob name"
    );
    assert_eq!(
        (boards[1].id.as_str(), boards[1].who.as_str()),
        ("saved", "Just you")
    );
    assert_eq!(boards[1].pins[0].title, "Marsh at 3am");
}

#[test]
fn docs_events_letters_inbox() {
    let s = studio();
    let snap = snapshot(&s);
    let doc = &snap.collections.docs[0];
    assert_eq!((doc.id.as_str(), doc.kicker.as_str()), ("d1", "lore"));
    assert_eq!(
        doc.blocks
            .iter()
            .map(|b| (b.k.as_str(), b.done))
            .collect::<Vec<_>>(),
        vec![("h", None), ("t", Some(true))]
    );
    assert_eq!(doc.edited, "2h ago by Bea");
    assert_eq!(doc.people, vec![s.ada.to_string(), s.bea.to_string()]);
    assert_eq!(doc.versions.len(), 4);
    assert_eq!(doc.versions[0].seal.len(), 7);

    let ev = &snap.collections.events[0];
    assert_eq!(
        (ev.id.as_str(), ev.d, ev.s, ev.e, ev.meeting),
        ("e1", 1, 14.0, 15.0, Some(true))
    );
    assert_eq!(ev.people, vec![s.ada.to_string(), s.bea.to_string()]);

    let letters = &snap.collections.letters["home"];
    assert_eq!(
        (letters[0].ch.as_str(), letters[0].text.as_str()),
        ("art", "A raven from the studio")
    );

    let inbox = &snap.collections.inbox;
    assert!(!inbox.is_empty());
    assert!(inbox.iter().all(|e| e.by != s.me.to_string()));
    let general = inbox.iter().find(|e| e.ch == "general").unwrap();
    assert_eq!(
        (general.sp.as_str(), general.read),
        (s.sid.to_string().as_str(), false)
    );
}

#[test]
fn snapshot_json_matches_ui_shape() {
    let s = studio();
    let snap = snapshot(&s);
    let v = serde_json::to_value(&snap).unwrap();
    let back: Snapshot = serde_json::from_value(v.clone()).unwrap();
    assert_eq!(back, snap);

    let top: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
    assert_eq!(
        {
            let mut t = top;
            t.sort();
            t
        },
        vec!["collections", "people", "spaces"]
    );
    let mut keys: Vec<_> = v["collections"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    keys.sort();
    let mut expect = vec![
        "channels",
        "messages",
        "rooms",
        "agenda",
        "workboards",
        "skein",
        "feed",
        "media",
        "pinboards",
        "docs",
        "events",
        "letters",
        "inbox",
        "desk",
        "arcade",
        "messaging",
    ];
    expect.sort();
    assert_eq!(keys, expect);
    let mut media: Vec<_> = v["collections"]["media"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    media.sort();
    assert_eq!(
        media,
        vec!["captions", "live", "shorts", "stories", "videos"]
    );

    // spot-check exact key spelling the UI relies on
    let space = &v["spaces"][1];
    for k in [
        "id",
        "name",
        "mono",
        "kind",
        "tagline",
        "members",
        "online",
        "sections",
        "defaultChannel",
        "meetingChannel",
        "growth",
    ] {
        assert!(space.get(k).is_some(), "space.{k}");
    }
    let g = &space["growth"];
    for k in [
        "members",
        "active7d",
        "tier",
        "radius",
        "houses",
        "buildings",
    ] {
        assert!(g.get(k).is_some(), "growth.{k}");
    }
    assert!(g["houses"][0].get("user_id").is_some() && g["houses"][0].get("plot_index").is_some());
    let room = v["collections"]["rooms"]
        .as_object()
        .unwrap()
        .values()
        .next()
        .unwrap();
    assert!(room.get("inRoom").is_some() && room.get("cams").is_some());
    let cal = &v["collections"]["events"][0];
    assert!(cal.get("where").is_some());

    // cross references, as the old fixture checks did
    let people = v["people"].as_object().unwrap();
    for list in v["collections"]["messages"].as_object().unwrap().values() {
        for m in list.as_array().unwrap() {
            assert!(
                people.contains_key(m["by"].as_str().unwrap()),
                "message author missing from people"
            );
        }
    }
    for sp in &snap.spaces {
        for sec in &sp.sections {
            assert!(["chat", "hearth", "feed", "board", "skein"].contains(&sec.as_str()));
        }
    }
    for post in snap.collections.feed.values().flatten() {
        assert!(snap.people.contains_key(&post.by));
    }
}

#[test]
fn fold_is_independent_of_event_arrival_order() {
    let s = studio();
    let reference = serde_json::to_string(&project(&ctx(s.me), &s.inputs)).unwrap();
    let mut state = 0x9e3779b97f4a7c15u64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    for _ in 0..12 {
        let mut shuffled = s.inputs.clone();
        for input in &mut shuffled {
            let n = input.events.len();
            for i in (1..n).rev() {
                input
                    .events_mut()
                    .swap(i, (next() % (i as u64 + 1)) as usize);
            }
        }
        assert_eq!(
            serde_json::to_string(&project(&ctx(s.me), &shuffled)).unwrap(),
            reference
        );
    }
}

#[test]
fn two_authors_with_equal_lamport_merge_deterministically() {
    let (_, me) = user();
    let (_, a) = user();
    let (_, b) = user();
    let sid = SpaceId::random();
    let mut l = Log::new();
    l.push(&a, NOW - HOUR, space_create("Duo", &["chat"]));
    l.push(&a, NOW - HOUR, invite());
    l.push(&b, NOW - HOUR, join());
    l.push(&a, NOW - HOUR, channel("general"));
    l.push_at(&a, 10, NOW - 30 * MIN, post_msg("general", "ma", "from a"));
    l.push_at(&b, 10, NOW - 31 * MIN, post_msg("general", "mb", "from b"));
    let first = project(&ctx(me), &[l.input(sid, "Duo", "Team", false)]);
    let mut rev = l.input(sid, "Duo", "Team", false);
    rev.events_mut().reverse();
    let second = project(&ctx(me), &[rev]);
    assert_eq!(first, second);
    let order: Vec<_> = first.collections.messages[&format!("{sid}/general")]
        .iter()
        .map(|m| m.id.as_str())
        .collect();
    let expect = if a.0 < b.0 {
        ["ma", "mb"]
    } else {
        ["mb", "ma"]
    };
    assert_eq!(order, expect, "ties break on author bytes, not wall clock");
}

#[test]
fn growth_tiers_and_buildings_follow_the_log() {
    let (_, me) = user();
    let sid = SpaceId::random();
    let mut l = Log::new();
    l.push(&me, NOW, space_create("Town", &["chat"]));
    l.push(&me, NOW, invite());
    let mut c = ctx(me);
    c.growth = GrowthConfig {
        tier_min_members: [1, 2, 3, 4, 5],
        ..GrowthConfig::default()
    };
    assert_eq!(
        project(&c, &[l.input(sid, "Town", "Team", false)]).spaces[0]
            .growth
            .tier,
        1
    );
    for i in 0..4 {
        let (_, u) = user();
        l.push(&u, NOW - i * HOUR, join());
    }
    let g = project(&c, &[l.input(sid, "Town", "Team", false)]).spaces[0]
        .growth
        .clone();
    assert_eq!((g.members, g.tier), (5, 5));
    assert_eq!(g.buildings.board, 0);
    l.push(
        &me,
        NOW,
        EventBody::SectionRaise {
            section: "board".into(),
        },
    );
    let g = project(&c, &[l.input(sid, "Town", "Team", false)]).spaces[0]
        .growth
        .clone();
    assert_eq!(g.buildings.board, 1);
    let (_, leaver) = user();
    l.push(&leaver, NOW, join());
    l.push(&leaver, NOW, EventBody::MemberLeave {});
    let g2 = project(&c, &[l.input(sid, "Town", "Team", false)]).spaces[0]
        .growth
        .clone();
    assert_eq!(
        g2.members, g.members,
        "leavers drop out but keep their plot reserved"
    );
}

#[test]
fn unknown_events_and_orphans_are_ignored() {
    let (_, me) = user();
    let sid = SpaceId::random();
    let mut l = Log::new();
    l.push(&me, NOW, EventBody::Unknown);
    l.push(
        &me,
        NOW,
        EventBody::MessageEdit {
            msg_id: "nope".into(),
            text: "x".into(),
        },
    );
    l.push(
        &me,
        NOW,
        EventBody::CardMove {
            card_id: "nope".into(),
            col_id: "x".into(),
        },
    );
    l.push(
        &me,
        NOW,
        EventBody::DocBlock {
            doc_id: "nope".into(),
            op: DocOp::Delete,
            block_id: "b".into(),
            block: None,
            after: None,
        },
    );
    let snap = project(&ctx(me), &[l.input(sid, "Fallback", "Team", false)]);
    assert_eq!(
        snap.spaces[0].name, "Fallback",
        "name falls back to the locally known one before space.create arrives"
    );
    assert!(snap.collections.messages.is_empty());
}

#[test]
fn doc_block_update_and_delete_edit_an_existing_doc() {
    let (_, me) = user();
    let (_, bea) = user();
    let sid = SpaceId::random();
    let mut l = Log::new();
    let t = |mins: i64| NOW - mins * MIN;
    let block = |op, id: &str, k: &str, text: &str| EventBody::DocBlock {
        doc_id: "d".into(),
        op,
        block_id: id.into(),
        block: (!k.is_empty() || !text.is_empty()).then(|| DocBlockIn {
            k: k.into(),
            text: text.into(),
            done: None,
        }),
        after: None,
    };
    l.push(&me, t(40), space_create("Kiln", &["board"]));
    l.push(&me, t(39), invite());
    l.push(&bea, t(38), join());
    l.push(
        &me,
        t(30),
        EventBody::DocCreate {
            doc_id: "d".into(),
            title: "Kiln manual".into(),
            kicker: "notes".into(),
        },
    );
    l.push(&me, t(29), block(DocOp::Insert, "a", "p", "first draft"));
    l.push(&me, t(28), block(DocOp::Insert, "b", "p", "goes away"));
    l.push(&me, t(27), block(DocOp::Insert, "c", "p", "stays"));
    // Another member edits the first line in place and removes the second.
    l.push(&bea, t(26), block(DocOp::Update, "a", "", "final words"));
    l.push(&bea, t(25), block(DocOp::Delete, "b", "", ""));
    // Comments hang on a live block; one on a missing block is dropped.
    let comment = |id: &str, text: &str| EventBody::DocComment {
        doc_id: "d".into(),
        block_id: id.into(),
        text: text.into(),
    };
    l.push(&bea, t(24), comment("c", "is this still true?"));
    l.push(&me, t(23), comment("b", "on a deleted block"));
    let snap = project(&ctx(me), &[l.input(sid, "Kiln", "Team", false)]);
    let doc = &snap.collections.docs[0];
    assert_eq!(
        doc.blocks
            .iter()
            .map(|b| (b.id.as_deref(), b.k.as_str(), b.text.as_str()))
            .collect::<Vec<_>>(),
        vec![(Some("a"), "p", "final words"), (Some("c"), "p", "stays")],
        "update keeps the kind when none is given; delete removes only that block"
    );

    // V-025: the comment carries its block, author and the text it sits on.
    assert_eq!(doc.comments.len(), 1);
    let cm = &doc.comments[0];
    assert_eq!(
        (
            cm.block_id.as_str(),
            cm.by.as_str(),
            cm.on.as_str(),
            cm.text.as_str()
        ),
        (
            "c",
            bea.to_string().as_str(),
            "stays",
            "is this still true?"
        )
    );

    // V-026: newest first; every version has its author and the blocks as they stood then.
    let texts = |v: &hermod_core::projections::shapes::DocVersion| {
        v.blocks.iter().map(|b| b.text.clone()).collect::<Vec<_>>()
    };
    assert_eq!(doc.versions.len(), 6, "create plus five edits");
    assert_eq!(doc.versions[0].by, bea.to_string());
    assert_eq!(texts(&doc.versions[0]), vec!["final words", "stays"]);
    assert_eq!(
        texts(&doc.versions[1]),
        vec!["final words", "goes away", "stays"]
    );
    assert_eq!(texts(&doc.versions[3]), vec!["first draft", "goes away"]);
    assert_eq!(doc.versions[5].by, me.to_string());
    assert!(
        doc.versions[5].blocks.is_empty(),
        "the create version is empty"
    );
}

#[test]
fn empty_log_has_empty_collections() {
    let (_, me) = user();
    let snap = project(&ctx(me), &[]);
    let c = &snap.collections;
    assert!(
        snap.spaces.is_empty() && c.docs.is_empty() && c.inbox.is_empty() && c.agenda.is_empty()
    );
    assert!(
        c.media.videos.is_empty() && c.media.stories.is_empty() && c.media.live.title.is_empty()
    );
    assert_eq!(c.pinboards.len(), 1, "only the derived Saved board");
}
