//! Cost of one user action on a large space (audit finding 6), plus cached-vs-cold equivalence.
//! The timing test is ignored by default: `cargo test --release -p hermod-core --test audit_perf
//! -- --ignored --nocapture`.
mod common;

use std::time::Instant;

use common::*;
use hermod_core::Core;
use hermod_core::event::{EventBody, Role, SignedEvent};
use hermod_core::identity::Identity;
use hermod_core::ids::SpaceId;
use hermod_core::invite::InviteV1;

/// Events in the large space of the timing test.
const BIG_SPACE_EVENTS: u64 = 20_000;
/// Events in the equivalence test (kept small so it runs in every build).
const SMALL_SPACE_EVENTS: u64 = 300;

fn core() -> (tempfile::TempDir, Core) {
    let d = tempfile::tempdir().unwrap();
    let c = Core::open(d.path()).unwrap();
    (d, c)
}

/// Fills `s` with `n` posts by a member who holds the key, ingested as backfill.
fn fill(c: &Core, s: SpaceId, n: u64) {
    let inv = InviteV1::parse(&c.invite_create(&s, None, vec![]).unwrap().code).unwrap();
    let who = Identity::generate();
    let join = EventBody::MemberJoin {
        via_invite_from: None,
        invite: Some(inv.id.clone()),
        pow: None,
    };
    let mk = |seq: u64, body: &EventBody| {
        SignedEvent::create(&who, &inv.space_key, 0, s, seq, inv.lc + seq, 1, body).unwrap()
    };
    c.ingest_sync(mk(1, &join)).unwrap();
    for seq in 2..=n {
        let body = post_msg("general", &format!("m{seq}"), "hello");
        c.ingest_sync(mk(seq, &body)).unwrap();
    }
}

#[test]
#[ignore]
fn one_action_on_a_20k_event_space() {
    let (_d, a) = core();
    let s = a.space_create("Big", "", "Team").unwrap().id;
    fill(&a, s, BIG_SPACE_EVENTS);
    // Warm once, then time: a cached build pays the decrypt and fold only on the first call.
    a.append(&s, post_msg("general", "w", "warm")).unwrap();
    let t = Instant::now();
    for i in 0..5 {
        a.append(&s, post_msg("general", &format!("t{i}"), "timed"))
            .unwrap();
    }
    let append = t.elapsed() / 5;
    let t = Instant::now();
    for _ in 0..5 {
        a.space_report(&s).unwrap();
    }
    let report = t.elapsed() / 5;
    // A real action: permission check (report), then append; repeated, so each one follows a write.
    let t = Instant::now();
    for _ in 0..5 {
        a.invite_create(&s, None, vec![]).unwrap();
    }
    let invite = t.elapsed() / 5;
    println!(
        "20k-event space: append {append:?}, space_report {report:?}, invite_create {invite:?}"
    );
}

/// Every view of the hot core equals the same view from a core that opens the same files cold.
fn assert_hot_equals_cold(hot: &Core, dir: &std::path::Path, s: &SpaceId) {
    let cold = Core::open(dir).unwrap();
    assert_eq!(
        serde_json::to_value(hot.space_report(s).unwrap()).unwrap(),
        serde_json::to_value(cold.space_report(s).unwrap()).unwrap()
    );
    assert_eq!(
        hot.snapshot_at(1_000).unwrap(),
        cold.snapshot_at(1_000).unwrap()
    );
}

#[test]
fn cached_views_equal_cold_views_through_every_kind_of_change() {
    let (d, a) = core();
    let (_d2, b) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    fill(&a, s, SMALL_SPACE_EVENTS);
    assert_hot_equals_cold(&a, d.path(), &s);
    // Local append, a peer's join, a rekey (new key epoch), a role change, a message after the rekey.
    a.append(&s, post_msg("general", "x", "one")).unwrap();
    assert_hot_equals_cold(&a, d.path(), &s);
    let inv = a
        .invite_create_with(
            &s,
            hermod_core::api::InviteOptions {
                role: Role::Admin,
                ..Default::default()
            },
        )
        .unwrap();
    b.invite_accept(&inv.code).unwrap();
    for ev in b.missing_since(&s, &a.vector(&s).unwrap()).unwrap() {
        a.ingest_sync(ev).unwrap();
    }
    assert_hot_equals_cold(&a, d.path(), &s);
    a.rekey(&s).unwrap();
    assert_hot_equals_cold(&a, d.path(), &s);
    a.append(&s, post_msg("general", "y", "after rekey"))
        .unwrap();
    a.member_set_role(&s, &b.user_id(), Role::Member).unwrap();
    assert_hot_equals_cold(&a, d.path(), &s);
}
