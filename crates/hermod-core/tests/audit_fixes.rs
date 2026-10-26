//! Regression tests for the hermod-core audit findings.
mod common;

use common::*;
use hermod_core::crypto::seal;
use hermod_core::event::{EventBody, Role, SignedEvent};
use hermod_core::identity::Identity;
use hermod_core::ids::{SpaceId, UserId};
use hermod_core::invite::InviteV1;
use hermod_core::projections::report;
use hermod_core::projections::shapes::Snapshot;
use hermod_core::store::IngestStatus;
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
    a.append(&s, post_msg("general", "m0", "epoch zero"))
        .unwrap();
    a.rekey(&s).unwrap();
    a.rekey(&s).unwrap();
    a.append(&s, post_msg("general", "m1", "epoch two"))
        .unwrap();
    let inv = a.invite_create(&s, None, vec![]).unwrap();
    assert!(!InviteV1::parse(&inv.code).unwrap().keys.is_empty());
    c.invite_accept(&inv.code).unwrap();
    sync(&a, &c, &s);
    assert_eq!(c.pending(&s).unwrap(), (0, 0));
    assert_eq!(texts(&c, &s), ["epoch zero", "epoch two"]);
    assert!(c.space_report(&s).unwrap().my_role.is_some());
    c.append(&s, post_msg("general", "c1", "hello from c"))
        .unwrap();
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
        pow: None,
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
    let rep = report(
        &ctx(owner),
        &l2.input(SpaceId::random(), "S", "Team", false),
    );
    assert!(
        rep.members
            .iter()
            .any(|m| m.user == admin.to_string() && m.role == Role::Member)
    );
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
fn junk_event(
    who: &Identity,
    key: &hermod_core::crypto::SpaceKey,
    s: SpaceId,
    seq: u64,
) -> SignedEvent {
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
    let next =
        SignedEvent::create(&who, &key, 0, s, 2, 2, 1, &post_msg("general", "x", "ok")).unwrap();
    assert_eq!(a.ingest_sync(next).unwrap().status, IngestStatus::Applied);
    assert_eq!(a.pending(&s).unwrap(), (0, 0));
    // The folded views still build.
    let _ = a.space_report(&s).unwrap();
}

#[test]
fn a_vector_value_above_i64_max_means_seen_everything_not_nothing() {
    let (_d, a) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    a.append(&s, post_msg("general", "m", "x")).unwrap();
    let mut v = a.vector(&s).unwrap();
    for n in v.values_mut() {
        *n = u64::MAX;
    }
    assert!(a.missing_since(&s, &v).unwrap().is_empty());
}

/// A stranger holding the key who joins through a fresh invite (seq 1), then signs two different
/// events for seq 2. Returns the join and the two forks.
fn member_fork(c: &Core, s: SpaceId) -> (SignedEvent, SignedEvent, SignedEvent) {
    let inv = InviteV1::parse(&c.invite_create(&s, None, vec![]).unwrap().code).unwrap();
    let who = Identity::generate();
    let lc = inv.lc;
    let mk = |seq, text: &str| {
        let body = if seq == 1 {
            join_via(&inv.id)
        } else {
            post_msg("general", "f", text)
        };
        SignedEvent::create(&who, &inv.space_key, 0, s, seq, lc + seq, 1, &body).unwrap()
    };
    (mk(1, ""), mk(2, "fork one"), mk(2, "fork two"))
}

/// Texts of the fork messages the fold shows (the winner only).
fn fork_texts(c: &Core, s: &SpaceId) -> Vec<String> {
    texts(c, s)
        .into_iter()
        .filter(|t| t.starts_with("fork"))
        .collect()
}

#[test]
fn equivocation_resolves_to_the_lowest_id_on_every_peer_and_is_surfaced() {
    let (_d1, a) = core();
    let (_d2, b) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    b.invite_accept(&a.invite_create(&s, None, vec![]).unwrap().code)
        .unwrap();
    let (j, x, y) = member_fork(&a, s);
    a.ingest_sync(j.clone()).unwrap();
    b.ingest_sync(j).unwrap();
    sync(&a, &b, &s);
    let x_author = x.author.to_string();
    let winner = if x.id() < y.id() {
        "fork one"
    } else {
        "fork two"
    };
    a.ingest_sync(x.clone()).unwrap();
    let _ = a.ingest_sync(y.clone());
    b.ingest_sync(y).unwrap();
    let _ = b.ingest_sync(x);
    assert_eq!(fork_texts(&a, &s), [winner]);
    assert_eq!(fork_texts(&b, &s), [winner]);
    assert_eq!(a.space_report(&s).unwrap().equivocating, [x_author]);
}

#[test]
fn sync_hands_out_both_forks_so_a_peer_holding_one_converges() {
    let (_d1, a) = core();
    let (_d2, b) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    b.invite_accept(&a.invite_create(&s, None, vec![]).unwrap().code)
        .unwrap();
    let (j, x, y) = member_fork(&a, s);
    a.ingest_sync(j.clone()).unwrap();
    b.ingest_sync(j).unwrap();
    sync(&a, &b, &s);
    a.ingest_sync(x).unwrap();
    let _ = a.ingest_sync(y.clone());
    b.ingest_sync(y).unwrap();
    // b already has seq 1 of `who` in its vector, yet a's page still carries the other fork.
    for ev in a.missing_since(&s, &b.vector(&s).unwrap()).unwrap() {
        let _ = b.ingest_sync(ev);
    }
    assert_eq!(fork_texts(&a, &s), fork_texts(&b, &s));
    assert_eq!(fork_texts(&a, &s).len(), 1);
}

#[test]
fn restored_device_cannot_post_until_a_sync_round_released_the_hold() {
    let (_d1, a) = core();
    let (_d2, b) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    b.invite_accept(&a.invite_create(&s, None, vec![]).unwrap().code)
        .unwrap();
    sync(&b, &a, &s);
    sync(&a, &b, &s);
    let out = tempfile::tempdir().unwrap();
    let file = out.path().join("b.bak");
    b.backup_export(&file, "correct horse battery", false)
        .unwrap();
    let fresh = tempfile::tempdir().unwrap();
    Core::backup_import(fresh.path(), &file, "correct horse battery").unwrap();
    let restored = Core::open(fresh.path()).unwrap();
    assert!(
        restored
            .append(&s, post_msg("general", "r", "too early"))
            .is_err()
    );
    restored.release_own_seq_hold(&s).unwrap();
    restored
        .append(&s, post_msg("general", "r", "now fine"))
        .unwrap();
}

#[test]
fn restored_solo_space_is_not_held() {
    let (_d1, a) = core();
    let s = a.space_create("Solo", "", "Team").unwrap().id;
    let out = tempfile::tempdir().unwrap();
    let file = out.path().join("a.bak");
    a.backup_export(&file, "correct horse battery", false)
        .unwrap();
    let fresh = tempfile::tempdir().unwrap();
    Core::backup_import(fresh.path(), &file, "correct horse battery").unwrap();
    let restored = Core::open(fresh.path()).unwrap();
    restored.append(&s, post_msg("general", "r", "ok")).unwrap();
}

#[test]
fn backup_with_too_many_attachment_bytes_is_refused_with_a_clear_error() {
    let d = tempfile::tempdir().unwrap();
    let cfg = hermod_core::CoreConfig {
        backup_blob_cap: Some(10),
        ..Default::default()
    };
    let a = Core::open_with(d.path(), cfg).unwrap();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    let blob = a.blob_put_bytes("a.bin", &[7u8; 100]).unwrap();
    let body = EventBody::MessagePost {
        channel_id: "general".into(),
        msg_id: "m".into(),
        text: "file".into(),
        reply_to: None,
        attachments: vec![blob],
        snap: None,
        mentions: vec![],
        preview: None,
        target: None,
        ext: None,
    };
    a.append(&s, body).unwrap();
    let out = tempfile::tempdir().unwrap();
    let file = out.path().join("a.bak");
    let err = a
        .backup_export(&file, "correct horse battery", true)
        .unwrap_err();
    assert!(
        err.to_string().contains("export without attachments"),
        "{err}"
    );
    assert!(!file.exists());
    a.backup_export(&file, "correct horse battery", false)
        .unwrap();
    assert!(file.exists());
}

#[test]
fn truncated_or_damaged_backups_are_refused_and_leave_the_data_dir_empty() {
    let (_d, a) = core();
    a.space_create("Team", "", "Team").unwrap();
    let out = tempfile::tempdir().unwrap();
    let file = out.path().join("a.bak");
    a.backup_export(&file, "correct horse battery", false)
        .unwrap();
    let whole = std::fs::read(&file).unwrap();
    let cut = out.path().join("cut.bak");
    for len in [0, 7, 40, whole.len() / 2, whole.len() - 1] {
        std::fs::write(&cut, &whole[..len]).unwrap();
        let fresh = tempfile::tempdir().unwrap();
        assert!(Core::backup_import(fresh.path(), &cut, "correct horse battery").is_err());
        assert!(!fresh.path().join("identity.key").exists());
        assert!(!fresh.path().join("hermod.db").exists());
    }
    // A leftover temp file from a crashed export never replaces the real one.
    std::fs::write(out.path().join("a.tmp"), b"half written").unwrap();
    a.backup_export(&file, "correct horse battery", false)
        .unwrap();
    let fresh = tempfile::tempdir().unwrap();
    Core::backup_import(fresh.path(), &file, "correct horse battery").unwrap();
}

#[test]
fn replace_data_swaps_in_a_restore_and_open_sees_it() {
    let (_d1, a) = core();
    let s = a.space_create("Kept", "", "Team").unwrap().id;
    let out = tempfile::tempdir().unwrap();
    let file = out.path().join("a.bak");
    a.backup_export(&file, "correct horse battery", false)
        .unwrap();
    let live = tempfile::tempdir().unwrap();
    drop(Core::open(live.path()).unwrap());
    let staged = tempfile::tempdir().unwrap();
    Core::backup_import(staged.path(), &file, "correct horse battery").unwrap();
    Core::replace_data(live.path(), staged.path()).unwrap();
    let c = Core::open(live.path()).unwrap();
    assert_eq!(c.user_id(), a.user_id());
    assert!(c.space_report(&s).is_ok());
}

#[test]
fn open_refuses_a_database_whose_key_file_vanished() {
    let d = tempfile::tempdir().unwrap();
    let a = Core::open(d.path()).unwrap();
    let id = a.user_id();
    drop(a);
    std::fs::remove_file(d.path().join("identity.key")).unwrap();
    assert!(Core::open(d.path()).is_err());
    assert!(
        !d.path().join("identity.key").exists(),
        "no fresh identity was minted"
    );
    let _ = id;
}

#[test]
fn concurrent_rekeys_to_the_same_epoch_converge_and_both_sides_keep_reading() {
    let (_d1, a) = core();
    let (_d2, b) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
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
    sync(&a, &b, &s);
    sync(&b, &a, &s);
    // Both rekey offline from epoch 0: two different epoch-1 keys exist.
    a.rekey(&s).unwrap();
    b.rekey(&s).unwrap();
    sync(&a, &b, &s);
    sync(&b, &a, &s);
    sync(&a, &b, &s);
    a.append(&s, post_msg("general", "ma", "from a")).unwrap();
    b.append(&s, post_msg("general", "mb", "from b")).unwrap();
    sync(&a, &b, &s);
    sync(&b, &a, &s);
    sync(&a, &b, &s);
    for c in [&a, &b] {
        assert_eq!(c.pending(&s).unwrap(), (0, 0));
        let t = texts(c, &s);
        assert!(
            t.contains(&"from a".to_string()) && t.contains(&"from b".to_string()),
            "{t:?}"
        );
    }
}
