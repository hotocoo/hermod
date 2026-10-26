//! D-001: a second device signs with its own key, is one user with the first, and can be revoked.

mod common;

use hermod_core::api::InviteOptions;
use hermod_core::device::DeviceLinkV1;
use hermod_core::event::EventBody;
use hermod_core::ids::{SpaceId, hex_decode_array};
use hermod_core::projections::shapes::Snapshot;
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

fn spaces_of(c: &Core) -> Vec<SpaceId> {
    c.spaces()
        .unwrap()
        .iter()
        .map(|s| s.space_id.parse().unwrap())
        .collect()
}

fn sync_all(from: &Core, to: &Core) {
    for s in spaces_of(from) {
        sync(from, to, &s);
    }
}

fn authors(c: &Core, s: &SpaceId) -> Vec<(String, String)> {
    snap(c).collections.messages[&format!("{s}/general")]
        .iter()
        .map(|m| (m.by.clone(), m.text.clone()))
        .collect()
}

/// `a` (first device) in a shared space with `b`, plus a linked device `d` of `a`, all synced.
fn linked() -> (Core, Core, Core, SpaceId, [u8; 32], Vec<tempfile::TempDir>) {
    let (da, a) = core();
    let (db, b) = core();
    let s = a.space_create("Team", "", "Team").unwrap().id;
    b.invite_accept(&a.invite_create(&s, None, vec![]).unwrap().code)
        .unwrap();
    sync(&a, &b, &s);
    sync(&b, &a, &s);
    let (code, events) = a.device_link_start(vec![]).unwrap();
    assert_eq!(events.len(), 2, "certified in home and in the shared space");
    let dd = tempfile::tempdir().unwrap();
    Core::device_link_accept(dd.path(), &code).unwrap();
    let d = Core::open(dd.path()).unwrap();
    sync_all(&a, &d);
    sync(&a, &b, &s);
    let dev = hex_decode_array::<32>(
        &d.device_list()
            .unwrap()
            .into_iter()
            .find(|r| r.this_device)
            .unwrap()
            .device_pub,
    )
    .unwrap();
    (a, b, d, s, dev, vec![da, db, dd])
}

#[test]
fn linked_device_is_one_user_with_the_first() {
    let (a, b, d, s, _dev, _keep) = linked();
    assert_eq!(d.user_id(), a.user_id(), "acts as the identity");
    let (me, other) = (a.user_id().to_string(), b.user_id().to_string());
    d.append(&s, common::post_msg("general", "m1", "from device"))
        .unwrap();
    a.append(&s, common::post_msg("general", "m2", "from first"))
        .unwrap();
    sync(&d, &a, &s);
    sync(&a, &d, &s);
    sync(&a, &b, &s);
    sync(&d, &b, &s);
    for c in [&a, &b, &d] {
        let got = authors(c, &s);
        assert_eq!(got.len(), 2, "{:?} {got:?}", c.user_id());
        assert!(got.iter().all(|(by, _)| *by == me), "one user: {got:?}");
        let people = snap(c).people;
        assert!(
            people.contains_key(&me) && people.len() == 3,
            "me, {other}, system"
        );
    }
    let rows = a.device_list().unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows[0].this_device && !rows[1].this_device && !rows[1].revoked);
    assert!(
        d.device_list()
            .unwrap()
            .iter()
            .any(|r| r.this_device && r.added_at > 0)
    );
}

#[test]
fn revoked_device_loses_authorship_and_future_keys() {
    let (a, b, d, s, dev, _keep) = linked();
    d.append(&s, common::post_msg("general", "before", "kept"))
        .unwrap();
    sync(&d, &a, &s);
    let events = a.device_revoke(&dev).unwrap();
    assert!(
        events.len() >= 3,
        "revoke in home and the space, plus a rekey"
    );
    sync(&a, &b, &s);
    sync_all(&a, &d);
    // Posted after the revoke, with a backdated-looking history: must not count anywhere.
    d.append(&s, common::post_msg("general", "after", "ghost"))
        .unwrap();
    sync(&d, &a, &s);
    sync(&d, &b, &s);
    for c in [&a, &b] {
        let texts: Vec<String> = authors(c, &s).into_iter().map(|(_, t)| t).collect();
        assert_eq!(texts, vec!["kept"], "only pre-revoke history survives");
    }
    assert!(a.device_list().unwrap().iter().any(|r| r.revoked));
    // The rekey wraps nothing for the revoked device: it cannot read what the owner says next.
    a.append(&s, common::post_msg("general", "secret", "later"))
        .unwrap();
    sync(&a, &d, &s);
    assert!(
        !authors(&d, &s).iter().any(|(_, t)| t == "later"),
        "revoked device cannot open the new epoch"
    );
    assert!(authors(&a, &s).iter().any(|(_, t)| t == "later"));
}

#[test]
fn linked_device_cannot_create_join_link_or_revoke() {
    let (a, _b, d, s, dev, _keep) = linked();
    assert!(matches!(
        d.space_create("Mine", "", "Team"),
        Err(Error::Forbidden(_))
    ));
    let code = a
        .invite_create_with(&s, InviteOptions::default())
        .unwrap()
        .code;
    assert!(matches!(d.invite_accept(&code), Err(Error::Forbidden(_))));
    assert!(matches!(
        d.device_link_start(vec![]),
        Err(Error::Forbidden(_))
    ));
    assert!(matches!(d.device_revoke(&dev), Err(Error::Forbidden(_))));
}

#[test]
fn link_code_is_short_lived_and_forgeries_are_rejected() {
    let (_da, a) = core();
    let (code, _) = a.device_link_start(vec![]).unwrap();
    let dir = tempfile::tempdir().unwrap();
    // Tampered code: one character off no longer decodes to a signed link.
    let mut bad = code.clone();
    bad.replace_range(5..6, if &code[5..6] == "1" { "2" } else { "1" });
    assert!(Core::device_link_accept(dir.path(), &bad).is_err());
    assert!(
        std::fs::read_dir(dir.path()).unwrap().next().is_none(),
        "a rejected code writes nothing"
    );
    // An expired code is refused before anything is written.
    let mut l = DeviceLinkV1::decode(&code).unwrap();
    l.exp = 1;
    assert!(Core::device_link_accept(dir.path(), &l.encode().unwrap()).is_err());
    assert!(std::fs::read_dir(dir.path()).unwrap().next().is_none());
}

#[test]
fn a_device_event_alone_cannot_link_or_revoke() {
    // A forged `device.link` for somebody else's key (no proof of possession) never takes effect.
    let (_da, a) = core();
    let home = a.resolve_space("home").unwrap();
    let victim = hermod_core::identity::Identity::generate();
    a.append(
        &home,
        EventBody::DeviceLink {
            device_pub: hermod_core::ids::hex_encode(&victim.user_id().0),
            cert: hermod_core::device::make_cert(
                &hermod_core::identity::Identity::generate(),
                &victim.user_id().0,
            ),
            proof: String::new(),
        },
    )
    .unwrap();
    assert_eq!(a.device_list().unwrap().len(), 1, "forged link is ignored");
}
