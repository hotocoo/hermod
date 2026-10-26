//! Bounds on what a peer can make the store hold or advance.

mod common;

use hermod_core::backup::{self, KdfParams, Payload, SpaceBackup};
use hermod_core::crypto::SpaceKey;
use hermod_core::event::{MAX_BODY_BYTES, SignedEvent};
use hermod_core::identity::Identity;
use hermod_core::ids::SpaceId;
use hermod_core::store::{
    CLOCK_HEADROOM, MAX_CLOCK, MAX_EPOCH_AHEAD, MAX_LOCKED_BYTES_PER_SPACE, MAX_LOCKED_PER_SPACE,
    Source, SpaceRow, Store,
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
    for lamport in [i64::MAX as u64, MAX_CLOCK + 1, MAX_CLOCK] {
        let ev = forge(&who, &row, &row.key, 0, 1, lamport);
        assert!(store.ingest_from(&ev, Source::Sync).is_err());
    }
    // Seq 2 with a gap: buffered, not applied, so it must not count towards the next lamport.
    let gap = forge(&who, &row, &row.key, 0, 2, MAX_CLOCK - CLOCK_HEADROOM);
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
    // Authors the space has applied events from: only these may park key-less rows.
    let authors: Vec<Identity> = (0..8).map(|_| Identity::generate()).collect();
    for who in &authors {
        let ev = forge(who, &row, &row.key, 0, 1, 1);
        store.ingest_from(&ev, Source::Sync).unwrap();
    }
    let per_author = MAX_LOCKED_PER_SPACE as u64 / authors.len() as u64 + 10;
    for seq in 2..2 + per_author {
        for who in &authors {
            let ev = forge(who, &row, &unknown, 1, seq, seq);
            store.ingest_from(&ev, Source::Sync).unwrap();
        }
    }
    assert_eq!(
        store.locked_count(&row.id).unwrap(),
        MAX_LOCKED_PER_SPACE as u64
    );
}

#[test]
fn strangers_cannot_park_or_evict_keyless_events() {
    let (mut store, row) = store_with_space();
    let unknown = SpaceKey::random();
    let member = Identity::generate();
    store
        .ingest_from(&forge(&member, &row, &row.key, 0, 1, 1), Source::Sync)
        .unwrap();
    let real = forge(&member, &row, &unknown, 1, 2, 2);
    store.ingest_from(&real, Source::Sync).unwrap();
    for _ in 0..MAX_LOCKED_PER_SPACE + 10 {
        let ev = forge(&Identity::generate(), &row, &unknown, 1, 1, 1);
        assert!(store.ingest_from(&ev, Source::Sync).is_err());
    }
    assert_eq!(store.locked_count(&row.id).unwrap(), 1);
}

#[test]
fn keyless_bytes_are_capped_per_space_oldest_first() {
    let (mut store, row) = store_with_space();
    let unknown = SpaceKey::random();
    let who = Identity::generate();
    store
        .ingest_from(&forge(&who, &row, &row.key, 0, 1, 1), Source::Sync)
        .unwrap();
    let big = "x".repeat(MAX_BODY_BYTES - 4096);
    let sent = MAX_LOCKED_BYTES_PER_SPACE as u64 / big.len() as u64 + 4;
    let mut ids = Vec::new();
    for seq in 2..2 + sent {
        let ev = SignedEvent::create(
            &who,
            &unknown,
            1,
            row.id,
            seq,
            seq,
            1,
            &common::post_msg("general", "m", &big),
        )
        .unwrap();
        ids.push(ev.id());
        store.ingest_from(&ev, Source::Sync).unwrap();
    }
    let kept = store.locked_count(&row.id).unwrap();
    assert!(kept < sent, "oldest rows were evicted");
    let (_, bytes) = store.space_usage(&row.id).unwrap();
    assert!(bytes as i64 <= MAX_LOCKED_BYTES_PER_SPACE + 4096);
    assert!(
        store.event_by_id(ids.last().unwrap()).unwrap().is_some(),
        "newest row survives"
    );
    assert!(
        store.event_by_id(&ids[0]).unwrap().is_none(),
        "oldest row is gone"
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
