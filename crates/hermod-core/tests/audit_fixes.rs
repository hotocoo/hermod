//! Regression tests for the hermod-core audit findings.
mod common;

use common::*;
use hermod_core::event::SignedEvent;
use hermod_core::identity::Identity;
use hermod_core::ids::SpaceId;
use hermod_core::invite::InviteV1;
use hermod_core::projections::shapes::Snapshot;
use hermod_core::store::{CLOCK_HEADROOM, MAX_CLOCK};
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
    snap(c)
        .collections
        .messages
        .get(&format!("{s}/general"))
        .map(|v| v.iter().map(|m| m.text.clone()).collect())
        .unwrap_or_default()
}

#[test]
fn invite_after_rekey_reads_history_and_can_post() {
    let (_d1, a) = core();
    let (_d2, c) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    a.append(&s, post_msg("general", "m0", "epoch zero")).unwrap();
    a.rekey(&s).unwrap();
    a.rekey(&s).unwrap();
    a.append(&s, post_msg("general", "m1", "epoch two")).unwrap();
    let inv = a.invite_create(&s, None, vec![]).unwrap();
    assert!(!InviteV1::parse(&inv.code).unwrap().keys.is_empty());
    c.invite_accept(&inv.code).unwrap();
    sync(&a, &c, &s);
    assert_eq!(c.pending(&s).unwrap(), (0, 0));
    assert_eq!(texts(&c, &s), ["epoch zero", "epoch two"]);
    assert!(c.space_report(&s).unwrap().my_role.is_some());
    c.append(&s, post_msg("general", "c1", "hello from c")).unwrap();
    sync(&c, &a, &s);
    assert!(texts(&a, &s).contains(&"hello from c".to_string()));
}

#[test]
fn forged_clock_near_the_limit_is_refused_and_local_writes_survive() {
    let (_d1, a) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    let key = InviteV1::parse(&a.invite_create(&s, None, vec![]).unwrap().code)
        .unwrap()
        .space_key;
    let who = Identity::generate();
    for (seq, lamport) in [
        (1, MAX_CLOCK),
        (1, MAX_CLOCK - CLOCK_HEADROOM + 1),
        (MAX_CLOCK, 5),
    ] {
        let ev = SignedEvent::create(
            &who,
            &key,
            0,
            s,
            seq,
            lamport,
            1,
            &post_msg("general", "x", "boom"),
        )
        .unwrap();
        assert!(matches!(a.ingest_sync(ev), Err(Error::Invalid { .. })));
    }
    a.append(&s, post_msg("general", "y", "after")).unwrap();
}
