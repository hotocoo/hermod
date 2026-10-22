//! The UI sends `event_append` bodies as JSON. These tests pin the field names the TypeScript
//! `EventBody` union (src/lib/bridge/types.ts) uses to the serde shape of the core variants, then
//! run each wired action end to end between two peers.

use hermod_core::api::Core;
use hermod_core::event::{ColumnIn, EventBody};
use hermod_core::ids::SpaceId;
use hermod_core::projections::shapes::Snapshot;
use serde_json::{Value, json};

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

/// Two peers in one space: `a` owns it, `b` joined by invite.
fn pair() -> (Core, Core, SpaceId, Vec<tempfile::TempDir>) {
    let (d1, a) = core();
    let (d2, b) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    let inv = a.invite_create(&s, None, vec![]).unwrap();
    b.invite_accept(&inv.code).unwrap();
    sync(&a, &b, &s);
    sync(&b, &a, &s);
    sync(&a, &b, &s);
    (a, b, s, vec![d1, d2])
}

/// Every action whose ids the UI names, exactly as the TypeScript side sends it.
fn ui_payloads() -> Vec<Value> {
    vec![
        json!({"t": "post.delete", "post_id": "p1"}),
        json!({"t": "event.cancel", "ev_id": "e1"}),
        json!({"t": "event.update", "ev_id": "e1", "title": "T", "day": 2, "start": 9.5, "end": 10.5, "where": "Hall", "note": "n", "meeting": false}),
        json!({"t": "card.delete", "card_id": "k1"}),
        json!({"t": "card.update", "card_id": "k1", "title": "T", "tag": "x", "assignee": "u", "due": "2030-01-02"}),
        json!({"t": "message.post", "channel_id": "", "msg_id": "m1", "text": "nice", "attachments": [], "target": "p1"}),
    ]
}

#[test]
fn ui_payloads_decode_and_round_trip_through_serde() {
    for raw in ui_payloads() {
        let body: EventBody = serde_json::from_value(raw.clone())
            .unwrap_or_else(|e| panic!("{raw} does not decode: {e}"));
        assert_ne!(body, EventBody::Unknown, "{raw} decoded to Unknown");
        let back = serde_json::to_value(&body).unwrap();
        // The core drops defaulted empties (`mentions`, `attachments`); every key the UI sent must survive.
        for (k, v) in raw.as_object().unwrap() {
            if v.as_array().is_some_and(Vec::is_empty) {
                continue;
            }
            assert_eq!(back.get(k), Some(v), "{k} lost in {raw}");
        }
    }
}

#[test]
fn old_target_id_shape_is_rejected() {
    for t in ["post.delete", "event.cancel", "card.delete"] {
        let raw = json!({"t": t, "target_id": "x"});
        assert!(
            serde_json::from_value::<EventBody>(raw).is_err(),
            "{t} must not accept target_id"
        );
    }
}

fn append(c: &Core, s: &SpaceId, raw: Value) {
    let body: EventBody = serde_json::from_value(raw).unwrap();
    c.append(s, body).unwrap();
}

#[test]
fn feed_post_comment_and_delete_sync() {
    let (a, b, s, _d) = pair();
    append(
        &a,
        &s,
        json!({"t": "post.create", "post_id": "p1", "kind": "note", "title": "Hi", "text": "t", "blobs": []}),
    );
    sync(&a, &b, &s);
    append(
        &b,
        &s,
        json!({"t": "message.post", "channel_id": "general", "msg_id": "c1", "text": "nice", "attachments": [], "target": "p1"}),
    );
    sync(&b, &a, &s);
    let sn = snap(&a);
    let post = &sn.collections.feed[&s.to_string()][0];
    assert_eq!(post.comments.as_ref().unwrap()[0].text, "nice");
    let in_channel = sn
        .collections
        .messages
        .get(&format!("{s}/general"))
        .map_or(0, |m| m.iter().filter(|m| m.text == "nice").count());
    assert_eq!(in_channel, 0, "a post comment is not a channel message");

    append(&a, &s, json!({"t": "post.delete", "post_id": "p1"}));
    sync(&a, &b, &s);
    assert!(snap(&b).collections.feed[&s.to_string()].is_empty());
}

#[test]
fn calendar_event_edit_and_cancel_sync_and_respect_authorship() {
    let (a, b, s, _d) = pair();
    let create = json!({"t": "event.create", "ev_id": "e1", "day": 1, "start": 10.0, "end": 11.0, "title": "Sync", "where": "Hall", "note": "", "meeting": false});
    append(&a, &s, create);
    sync(&a, &b, &s);
    // A member who did not author the event cannot edit it.
    append(
        &b,
        &s,
        json!({"t": "event.update", "ev_id": "e1", "title": "Hijack"}),
    );
    sync(&b, &a, &s);
    assert_eq!(snap(&a).collections.events[0].t, "Sync");

    append(
        &a,
        &s,
        json!({"t": "event.update", "ev_id": "e1", "title": "Retro", "day": 3, "start": 14.5, "end": 15.0, "where": "Roof", "note": "bring tea"}),
    );
    sync(&a, &b, &s);
    let ev = &snap(&b).collections.events[0];
    assert_eq!(
        (
            ev.t.as_str(),
            ev.d,
            ev.s,
            ev.e,
            ev.place.as_str(),
            ev.note.as_str()
        ),
        ("Retro", 3, 14.5, 15.0, "Roof", "bring tea")
    );

    append(&a, &s, json!({"t": "event.cancel", "ev_id": "e1"}));
    sync(&a, &b, &s);
    assert!(snap(&b).collections.events.is_empty());
}

#[test]
fn board_card_assign_due_and_delete_sync() {
    let (a, b, s, _d) = pair();
    a.append(
        &s,
        EventBody::BoardCreate {
            board_id: "b1".into(),
            name: "Sprint".into(),
            due: String::new(),
            cols: vec![ColumnIn {
                col_id: "todo".into(),
                name: "Todo".into(),
            }],
        },
    )
    .unwrap();
    append(
        &a,
        &s,
        json!({"t": "card.create", "board_id": "b1", "card_id": "k1", "col_id": "todo", "title": "Ship", "tag": "x"}),
    );
    sync(&a, &b, &s);
    let b_uid = b.user_id().to_string();
    append(
        &b,
        &s,
        json!({"t": "card.update", "card_id": "k1", "assignee": b_uid, "due": "2030-01-02"}),
    );
    sync(&b, &a, &s);
    let card = |c: &Core| {
        snap(c).collections.workboards[&s.to_string()].cols[0]
            .cards
            .first()
            .cloned()
    };
    let k = card(&a).unwrap();
    assert_eq!(
        (k.title.as_str(), k.assignee.as_deref(), k.due.as_deref()),
        ("Ship", Some(b_uid.as_str()), Some("2030-01-02"))
    );

    // Empty string clears; absent leaves alone.
    append(
        &a,
        &s,
        json!({"t": "card.update", "card_id": "k1", "assignee": ""}),
    );
    let k = card(&a).unwrap();
    assert_eq!((k.assignee, k.due.as_deref()), (None, Some("2030-01-02")));

    append(&a, &s, json!({"t": "card.delete", "card_id": "k1"}));
    sync(&a, &b, &s);
    assert!(card(&b).is_none());
}
