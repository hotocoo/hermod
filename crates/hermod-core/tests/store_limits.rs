//! Bounds on what a peer can make the store hold or advance.

mod common;

use hermod_core::backup::{self, KdfParams, Payload, SpaceBackup};
use hermod_core::crypto::SpaceKey;
use hermod_core::event::SignedEvent;
use hermod_core::identity::Identity;
use hermod_core::ids::SpaceId;
use hermod_core::store::{
    MAX_CLOCK, MAX_EPOCH_AHEAD, MAX_LOCKED_PER_SPACE, Source, SpaceRow, Store,
};
use hermod_core::{Core, Error};

fn store_with_space() -> (Store, SpaceRow) {
    let store = Store::open_in_memory().unwrap();
    let row = SpaceRow {
        id: SpaceId::random(),
        key: SpaceKey::random(),
        epoch: 0,
        name: "Limits".into(),
        kind: "Team".into(),
        is_home: false,
        joined_at: 1,
        left: false,
    };
    store.add_space(&row).unwrap();
    (store, row)
}

fn forge(
    who: &Identity,
    row: &SpaceRow,
    key: &SpaceKey,
    epoch: u32,
    seq: u64,
    lamport: u64,
) -> SignedEvent {
    SignedEvent::create(
        who,
        key,
        epoch,
        row.id,
        seq,
        lamport,
        1,
        &common::post_msg("general", "m", "x"),
    )
    .unwrap()
}

#[test]
fn huge_lamports_are_rejected_and_buffered_ones_do_not_move_the_clock() {
    let (mut store, row) = store_with_space();
    let who = Identity::generate();
    for lamport in [i64::MAX as u64, MAX_CLOCK + 1] {
        let ev = forge(&who, &row, &row.key, 0, 1, lamport);
        assert!(store.ingest_from(&ev, Source::Sync).is_err());
    }
    // Seq 2 with a gap: buffered, not applied, so it must not count towards the next lamport.
    let gap = forge(&who, &row, &row.key, 0, 2, MAX_CLOCK);
    store.ingest_from(&gap, Source::Sync).unwrap();
    assert_eq!(store.max_lamport(&row.id).unwrap(), 0);
}

#[test]
fn keyless_events_are_capped_per_space_and_far_epochs_refused() {
    let (mut store, row) = store_with_space();
    let unknown = SpaceKey::random();
    let far = forge(
        &Identity::generate(),
        &row,
        &unknown,
        MAX_EPOCH_AHEAD + 1,
        1,
        1,
    );
    assert!(
        store.ingest_from(&far, Source::Sync).is_err(),
        "epoch far above the held one"
    );
    for _ in 0..MAX_LOCKED_PER_SPACE + 10 {
        let ev = forge(&Identity::generate(), &row, &unknown, 1, 1, 1);
        store.ingest_from(&ev, Source::Sync).unwrap();
    }
    assert_eq!(
        store.locked_count(&row.id).unwrap(),
        MAX_LOCKED_PER_SPACE as u64
    );
}

#[test]
fn failed_restore_leaves_the_data_dir_untouched() {
    let payload = Payload {
        v: 1,
        identity_seed: [7; 32],
        spaces: vec![SpaceBackup {
            id: SpaceId::random(),
            name: "No key".into(),
            kind: "Team".into(),
            is_home: false,
            joined_at: 1,
            left: false,
            keys: vec![],
            events: vec![],
        }],
        kv: Default::default(),
        read_markers: vec![],
        blocks: vec![],
        follows: vec![],
        blobs: vec![],
    };
    let kdf = KdfParams {
        m_cost_kib: 8,
        t_cost: 1,
        p_cost: 1,
    };
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("b.hbk");
    let sealed = backup::seal(&payload, "correct horse battery", kdf).unwrap();
    backup::write_file(&file, &sealed).unwrap();
    let data = dir.path().join("data");
    let err = Core::backup_import(&data, &file, "correct horse battery").unwrap_err();
    assert!(matches!(err, Error::Invalid { .. }), "{err:?}");
    assert_eq!(
        std::fs::read_dir(&data).unwrap().count(),
        0,
        "nothing left behind"
    );
}
