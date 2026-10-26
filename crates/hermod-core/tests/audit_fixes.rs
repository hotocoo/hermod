//! Regression tests for the hermod-core audit findings.
mod common;

use common::*;
use hermod_core::crypto::seal;
use hermod_core::event::{EventBody, Role, SignedEvent};
use hermod_core::store::IngestStatus;
use hermod_core::identity::Identity;
use hermod_core::ids::{SpaceId, UserId};
use hermod_core::invite::InviteV1;
use hermod_core::projections::report;
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

fn invite_body(id: &str, role: Role) -> EventBody {
    EventBody::InviteCreate {
        id: id.into(),
        exp: None,
        max_uses: None,
        role,
    }
}

fn join_via(id: &str) -> EventBody {
    EventBody::MemberJoin {
        via_invite_from: None,
        invite: Some(id.into()),
    }
}

/// owner, admin (joined, seq 1) and member (joined); the owner then demotes the admin at lamport 10
/// having seen only seq 1 of theirs.
fn demoted_admin_log() -> (Log, UserId, UserId, UserId) {
    let (_, owner) = user();
    let (_, admin) = user();
    let (_, member) = user();
    let mut l = Log::new();
    l.push(&owner, NOW, space_create("S", &["chat"]));
    l.push(&owner, NOW, invite_body("ia", Role::Admin));
    l.push(&owner, NOW, invite_body("im", Role::Member));
    l.push(&admin, NOW, join_via("ia"));
    l.push(&member, NOW, join_via("im"));
    let demote = EventBody::MemberRole {
        user: admin.to_string(),
        role: Role::Member,
        last_seq: Some(1),
    };
    l.push_at(&owner, 10, NOW, demote);
    (l, owner, admin, member)
}

#[test]
fn demoted_admin_cannot_backdate_member_remove() {
    let (mut l, owner, admin, member) = demoted_admin_log();
    let rm = EventBody::MemberRemove {
        user: member.to_string(),
        last_seq: None,
    };
    l.push_at(&admin, 4, NOW, rm);
    let rep = report(&ctx(owner), &l.input(SpaceId::random(), "S", "Team", false));
    assert!(rep.members.iter().any(|m| m.user == member.to_string()));
}

#[test]
fn demoted_admin_cannot_backdate_invite_create() {
    let (mut l, owner, admin, _) = demoted_admin_log();
    l.push_at(&admin, 4, NOW, invite_body("backdoor", Role::Member));
    let rep = report(&ctx(owner), &l.input(SpaceId::random(), "S", "Team", false));
    assert!(rep.invites.iter().all(|i| i.id != "backdoor"));
}

#[test]
fn demoted_admin_cannot_backdate_a_rekey_but_keeps_member_rights() {
    let (mut l, owner, admin, _) = demoted_admin_log();
    let rekey = EventBody::SpaceRekey {
        epoch: 1,
        wraps: vec![],
    };
    let rk = l.push_at(&admin, 4, NOW, rekey);
    let inp = l.input(SpaceId::random(), "S", "Team", false);
    let rep = report(&ctx(owner), &inp);
    assert!(rep.audit.iter().all(|a| a.event_id != rk));
    // Their member-level events after the demotion still count.
    let mut l2 = l;
    l2.push_at(&admin, 20, NOW, post_msg("chat", "m", "still a member"));
    let rep = report(&ctx(owner), &l2.input(SpaceId::random(), "S", "Team", false));
    assert!(rep.members.iter().any(|m| m.user == admin.to_string() && m.role == Role::Member));
}

#[test]
fn invite_of_a_demoted_creator_cannot_admit_joins_folded_after_the_demotion() {
    let (_, owner) = user();
    let (_, admin) = user();
    let (_, late) = user();
    let mut l = Log::new();
    l.push(&owner, NOW, space_create("S", &["chat"]));
    l.push(&owner, NOW, invite_body("ia", Role::Admin));
    l.push(&admin, NOW, join_via("ia"));
    l.push(&admin, NOW, invite_body("mine", Role::Member));
    let demote = EventBody::MemberRole {
        user: admin.to_string(),
        role: Role::Member,
        last_seq: Some(2),
    };
    l.push(&owner, NOW, demote);
    l.push(&late, NOW, join_via("mine"));
    let rep = report(&ctx(owner), &l.input(SpaceId::random(), "S", "Team", false));
    assert!(rep.members.iter().all(|m| m.user != late.to_string()));
}

#[test]
fn invite_expiry_is_judged_by_the_join_ts_which_the_joiner_signs() {
    let (_, owner) = user();
    let (_, honest) = user();
    let (_, backdater) = user();
    let mut l = Log::new();
    l.push(&owner, NOW, space_create("S", &["chat"]));
    let exp_secs = (NOW / 1000) as u64 + 60;
    l.push(
        &owner,
        NOW,
        EventBody::InviteCreate {
            id: "i".into(),
            exp: Some(exp_secs),
            max_uses: None,
            role: Role::Member,
        },
    );
    l.push(&honest, NOW + 2 * MIN, join_via("i"));
    l.push(&backdater, NOW, join_via("i"));
    let rep = report(&ctx(owner), &l.input(SpaceId::random(), "S", "Team", false));
    let has = |u: &UserId| rep.members.iter().any(|m| m.user == u.to_string());
    assert!(!has(&honest), "a join stamped after expiry is ignored");
    // Documented limit (docs/ARCHITECTURE.md): expiry is advisory, revoke is the enforcement.
    assert!(has(&backdater));
}

/// Signed event whose plaintext is not a decodable body.
fn junk_event(who: &Identity, key: &hermod_core::crypto::SpaceKey, s: SpaceId, seq: u64) -> SignedEvent {
    let (nonce, body) = seal(key, b"\xffnot cbor at all").unwrap();
    let mut ev = SignedEvent {
        space_id: s,
        author: who.user_id(),
        seq,
        lamport: seq,
        ts: 1,
        epoch: 0,
        nonce,
        body,
        sig: [0; 64],
    };
    ev.sig = who.sign(&ev.digest());
    ev
}

#[test]
fn undecodable_signed_body_leaves_no_seq_hole() {
    let (_d, a) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    let key = InviteV1::parse(&a.invite_create(&s, None, vec![]).unwrap().code)
        .unwrap()
        .space_key;
    let who = Identity::generate();
    let first = a.ingest_sync(junk_event(&who, &key, s, 1)).unwrap();
    assert_eq!(first.status, IngestStatus::Applied);
    let next = SignedEvent::create(&who, &key, 0, s, 2, 2, 1, &post_msg("general", "x", "ok")).unwrap();
    assert_eq!(a.ingest_sync(next).unwrap().status, IngestStatus::Applied);
    assert_eq!(a.pending(&s).unwrap(), (0, 0));
    // The folded views still build.
    let _ = a.space_report(&s).unwrap();
}
