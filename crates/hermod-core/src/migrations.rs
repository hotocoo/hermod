//! Schema versioning: ordered migrations keyed on `PRAGMA user_version`, plus an integrity check.

use rusqlite::{Connection, ErrorCode};

use crate::error::{Error, Result};

/// Ordered, append-only. Index `i` upgrades a database from version `i` to `i + 1`.
const MIGRATIONS: &[&str] = &[
    // 1: core tables
    "CREATE TABLE spaces(
       space_id BLOB PRIMARY KEY, space_key BLOB NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
       is_home INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL, left INTEGER NOT NULL DEFAULT 0);
     CREATE TABLE events(
       id TEXT PRIMARY KEY, space_id BLOB NOT NULL, author BLOB NOT NULL, seq INTEGER NOT NULL,
       lamport INTEGER NOT NULL, ts INTEGER NOT NULL, nonce BLOB NOT NULL, body BLOB NOT NULL,
       sig BLOB NOT NULL, pending INTEGER NOT NULL DEFAULT 0,
       UNIQUE(space_id, author, seq));
     CREATE INDEX events_order ON events(space_id, pending, lamport, author, seq);
     CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);
     CREATE TABLE read_markers(
       space_id BLOB NOT NULL, channel_id TEXT NOT NULL, lamport INTEGER NOT NULL,
       PRIMARY KEY(space_id, channel_id));",
    // 2: key epochs. events.pending is 0 applied, 1 waiting for an earlier seq, 2 waiting for a key.
    "ALTER TABLE events ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;
     CREATE TABLE space_keys(
       space_id BLOB NOT NULL, epoch INTEGER NOT NULL, key_id TEXT NOT NULL, key BLOB NOT NULL,
       PRIMARY KEY(space_id, epoch, key_id));
     INSERT INTO space_keys(space_id, epoch, key_id, key)
       SELECT space_id, 0, 'genesis', space_key FROM spaces;",
    // 3: device-local state and the search index
    "CREATE TABLE blocks(user TEXT PRIMARY KEY, ts INTEGER NOT NULL);
     CREATE TABLE follows(kind TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(kind, target));
     CREATE VIRTUAL TABLE search USING fts5(
       text, kind UNINDEXED, space_id UNINDEXED, ref UNINDEXED, author UNINDEXED, ts UNINDEXED,
       channel UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
     CREATE TABLE search_state(space_id BLOB PRIMARY KEY, stamp INTEGER NOT NULL);",
    // 4: name and content type of every blob seen, so a restart keeps serving the right type
    "CREATE TABLE blob_meta(hash TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL);",
    // 5: local arrival order. A peer's concurrent message can carry a lamport below a read marker and reach
    // this device afterwards; the lamport alone then calls it read. `arrival` is a device-local counter
    // stamped when an event becomes applied (0 while pending), and a marker also remembers the arrival it covers.
    "ALTER TABLE events ADD COLUMN arrival INTEGER NOT NULL DEFAULT 0;
     UPDATE events SET arrival = rowid WHERE pending = 0;
     CREATE INDEX events_arrival ON events(arrival);
     ALTER TABLE read_markers ADD COLUMN arrival INTEGER NOT NULL DEFAULT 0;
     UPDATE read_markers SET arrival = COALESCE((SELECT MAX(e.arrival) FROM events e
       WHERE e.space_id = read_markers.space_id AND e.lamport <= read_markers.lamport), 0);
     CREATE TRIGGER events_arrival_insert AFTER INSERT ON events WHEN NEW.pending = 0 BEGIN
       UPDATE events SET arrival = (SELECT COALESCE(MAX(arrival), 0) + 1 FROM events) WHERE id = NEW.id;
     END;
     CREATE TRIGGER events_arrival_apply AFTER UPDATE OF pending ON events WHEN NEW.pending = 0 AND OLD.pending <> 0 BEGIN
       UPDATE events SET arrival = (SELECT COALESCE(MAX(arrival), 0) + 1 FROM events) WHERE id = NEW.id;
     END;",
    // 6: the pending-state lookups (gap buffer size, promote, applied max) filter on author and pending
    "CREATE INDEX events_pending ON events(space_id, author, pending, seq);",
];

/// Schema version this build produces.
pub const LATEST: u32 = MIGRATIONS.len() as u32;

pub fn version(conn: &Connection) -> Result<u32> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

/// Applies every pending migration, each in its own transaction.
pub fn migrate(conn: &mut Connection) -> Result<()> {
    migrate_to(conn, LATEST)
}

/// Applies migrations up to `target` (used to exercise upgrades from older versions).
pub fn migrate_to(conn: &mut Connection, target: u32) -> Result<()> {
    let current = version(conn)?;
    if current > LATEST {
        return Err(Error::invalid(
            "database",
            format!("written by a newer version (schema {current}, this build {LATEST})"),
        ));
    }
    for (i, sql) in MIGRATIONS
        .iter()
        .enumerate()
        .take(target as usize)
        .skip(current as usize)
    {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", i as u32 + 1)?;
        tx.commit()?;
    }
    Ok(())
}

/// Runs SQLite's integrity check; anything but `ok` is reported as [`Error::Corrupt`].
pub fn integrity_check(conn: &Connection) -> Result<()> {
    let mut st = conn.prepare("PRAGMA integrity_check")?;
    let rows: Vec<String> = st
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    if rows.len() == 1 && rows[0] == "ok" {
        Ok(())
    } else {
        Err(Error::Corrupt(rows.join("; ")))
    }
}

/// Maps "not a database" and "malformed" failures to [`Error::Corrupt`].
pub fn classify(e: rusqlite::Error) -> Error {
    match e.sqlite_error_code() {
        Some(ErrorCode::NotADatabase | ErrorCode::DatabaseCorrupt) => Error::Corrupt(e.to_string()),
        _ => Error::Sqlite(e),
    }
}
