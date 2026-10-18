//! Fields the UI reads beyond the original `data/*.json` shapes (ARCHITECTURE 5.1).

mod common;

use common::*;
use hermod_core::event::*;
use hermod_core::ids::SpaceId;
use hermod_core::projections::project;
use serde_json::Value;

fn blob(name: &str) -> BlobRef {
    BlobRef {
        hash: "cd".repeat(32),
        size: 9,
        name: name.into(),
        mime: "video/mp4".into(),
    }
}

fn post(id: &str, kind: &str, dur: Option<&str>, blobs: Vec<BlobRef>) -> EventBody {
    EventBody::PostCreate {
        post_id: id.into(),
        kind: kind.into(),
        title: id.into(),
        text: None,
        blobs,
        dur: dur.map(Into::into),
        chapters: vec![],
        captions: None,
    }
}

fn snapshot() -> (Value, String) {
    let (_, me) = user();
    let (sid, home) = (SpaceId::random(), SpaceId::random());
    let mut l = Log::new();
    let t = |m: i64| NOW - m * MIN;
    l.push(
        &me,
        t(900),
        space_create("Forge", &["chat", "hearth", "feed", "board"]),
    );
    l.push(&me, t(899), channel("general"));
    l.push(&me, t(898), profile("Me", ""));
    l.push(
        &me,
        t(800),
        EventBody::MessagePost {
            channel_id: "general".into(),
            msg_id: "m1".into(),
            text: "hi".into(),
            reply_to: None,
            attachments: vec![blob("a.mp4")],
            snap: None,
            mentions: vec![],
            preview: None,
            target: None,
            ext: None,
        },
    );
    l.push(
        &me,
        t(790),
        EventBody::MessagePin {
            msg_id: "m1".into(),
        },
    );
    l.push(
        &me,
        t(780),
        EventBody::MessageEdit {
            msg_id: "m1".into(),
            text: "hi again".into(),
        },
    );
    l.push(&me, t(700), post("p1", "photo", None, vec![blob("p.png")]));
    l.push(
        &me,
        t(690),
        post("v1", "video", Some("3:00"), vec![blob("v.mp4")]),
    );
    l.push(
        &me,
        t(680),
        post("s1", "video", Some("0:20"), vec![blob("s.mp4")]),
    );
    for id in ["p1", "v1"] {
        l.push(
            &me,
            t(670),
            EventBody::LikeToggle {
                target_id: id.into(),
            },
        );
    }
    l.push(
        &me,
        t(660),
        EventBody::SaveToggle {
            target_id: "p1".into(),
        },
    );
    l.push(
        &me,
        t(650),
        EventBody::StoryCreate {
            story_id: "st1".into(),
            items: vec![StoryItemIn {
                blob: blob("st.png"),
                caption: "c".into(),
            }],
            ttl_secs: 86_400,
        },
    );
    l.push(
        &me,
        t(640),
        EventBody::LiveStart {
            live_id: "lv1".into(),
            title: "Live".into(),
        },
    );
    l.push(
        &me,
        t(630),
        EventBody::PinboardCreate {
            board_id: "pb".into(),
            name: "Pins".into(),
        },
    );
    l.push(
        &me,
        t(629),
        EventBody::PinAdd {
            board_id: "pb".into(),
            blob: blob("pin.png"),
            title: "P".into(),
            label: String::new(),
        },
    );
    l.push(
        &me,
        t(620),
        EventBody::DocCreate {
            doc_id: "d1".into(),
            title: "D".into(),
            kicker: "k".into(),
        },
    );
    l.push(
        &me,
        t(619),
        EventBody::DocBlock {
            doc_id: "d1".into(),
            op: DocOp::Insert,
            block_id: "blk1".into(),
            block: Some(DocBlockIn {
                k: "p".into(),
                text: "x".into(),
                done: None,
            }),
            after: None,
        },
    );
    l.push(
        &me,
        t(610),
        EventBody::EventCreate {
            ev_id: "e1".into(),
            day: 1,
            start: 9.0,
            end: 10.0,
            title: "E".into(),
            place: "here".into(),
            note: String::new(),
            meeting: false,
        },
    );
    l.push(
        &me,
        t(600),
        EventBody::BoardCreate {
            board_id: "b1".into(),
            name: "B".into(),
            due: String::new(),
            cols: vec![],
        },
    );
    l.push(
        &me,
        t(6),
        EventBody::RoomJoin {
            room: String::new(),
        },
    );
    l.push(
        &me,
        t(5),
        EventBody::RoomState {
            room: String::new(),
            muted: Some(true),
            cam: None,
            share: Some(true),
        },
    );
    l.push(
        &me,
        t(580),
        EventBody::MeetingStart {
            topic: "Standup".into(),
            agenda: vec![],
        },
    );
    l.push(
        &me,
        t(579),
        EventBody::NoteAdd {
            text: "decided".into(),
        },
    );
    l.push(
        &me,
        t(570),
        EventBody::LineCreate {
            line_id: "ln".into(),
            name: "ln".into(),
            note: String::new(),
            from_line: None,
        },
    );
    l.push(
        &me,
        t(569),
        EventBody::SnapCreate {
            snap_id: "sn".into(),
            line_id: "ln".into(),
            title: "S".into(),
            kind: "Design".into(),
            files: vec![SnapFileIn {
                path: "a.png".into(),
                blob: Some(blob("a.png")),
                adds: 1,
                dels: 0,
            }],
            parent: None,
        },
    );
    let inputs = vec![
        Log::new().input(home, "Home", "Personal", true),
        l.input(sid, "Forge", "Team", false),
    ];
    let snap = serde_json::to_value(project(&ctx(me), &inputs)).unwrap();
    (snap, sid.to_string())
}

#[test]
fn ui_reads_blobs_ids_flags_and_space_ids() {
    let (v, sid) = snapshot();
    let c = &v["collections"];
    let hash = "cd".repeat(32);
    let at = |p: &str| {
        v.pointer(p)
            .unwrap_or_else(|| panic!("missing {p}\n{v:#}"))
            .clone()
    };

    let m = c["messages"][format!("{sid}/general")][0].clone();
    assert_eq!(m["att"][0]["hash"], hash.as_str());
    assert_eq!(
        (m["edited"].as_bool(), m["pinned"].as_bool()),
        (Some(true), Some(true))
    );
    assert_eq!(at("/spaces/1/role"), "owner");
    assert!(v.pointer("/spaces/1/growth").is_some());

    let feed = c["feed"][&sid].as_array().unwrap();
    let p1 = feed.iter().find(|p| p["id"] == "p1").unwrap();
    assert_eq!(p1["blob"]["hash"], hash.as_str());
    assert_eq!(
        (p1["liked"].as_bool(), p1["saved"].as_bool()),
        (Some(true), Some(true))
    );
    assert_eq!(p1["spaceId"], sid.as_str());

    // Shorts are listed as videos too (the player opens them by id): pick the liked long one.
    let video = c["media"]["videos"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == "v1")
        .unwrap();
    assert_eq!(
        (video["blob"]["hash"].as_str(), video["liked"].as_bool()),
        (Some(hash.as_str()), Some(true))
    );
    assert_eq!(video["spaceId"], sid.as_str());
    let short = &c["media"]["shorts"][0];
    assert_eq!(
        (short["blob"]["hash"].as_str(), short["spaceId"].as_str()),
        (Some(hash.as_str()), Some(sid.as_str()))
    );
    let story = &c["media"]["stories"][0];
    assert_eq!(
        (story["id"].as_str(), story["spaceId"].as_str()),
        (Some("st1"), Some(sid.as_str()))
    );
    assert_eq!(story["items"][0]["blob"]["hash"], hash.as_str());
    assert_eq!(
        (
            c["media"]["live"]["id"].as_str(),
            c["media"]["live"]["spaceId"].as_str()
        ),
        (Some("lv1"), Some(sid.as_str()))
    );

    let pb = c["pinboards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == "pb")
        .unwrap();
    assert_eq!(pb["spaceId"], sid.as_str());
    assert_eq!(pb["pins"][0]["blob"]["hash"], hash.as_str());
    assert_eq!(c["docs"][0]["blocks"][0]["id"], "blk1");
    assert_eq!(c["docs"][0]["spaceId"], sid.as_str());
    assert_eq!(
        (
            c["events"][0]["going"].as_bool(),
            c["events"][0]["spaceId"].as_str()
        ),
        (Some(true), Some(sid.as_str()))
    );
    assert_eq!(c["workboards"][&sid]["id"], "b1");
    let me_key = c["rooms"][&sid]["inRoom"][0].as_str().unwrap();
    assert_eq!(c["rooms"][&sid]["muted"][me_key], true);
    assert_eq!(c["rooms"][&sid]["share"][me_key], true);
    assert_eq!(c["rooms"][&sid]["meeting"]["topic"], "Standup");
    assert_eq!(c["rooms"][&sid]["meeting"]["notes"][0]["text"], "decided");
    assert_eq!(
        c["skein"][&sid]["snaps"][0]["files"][0]["blob"]["hash"],
        hash.as_str()
    );
}
