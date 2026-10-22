//! SQLite persistence: spaces and key epochs, the event log, local settings and read markers.
//!
//! Only ciphertext is stored for events. `ingest` is the single gate: it verifies the signature,
//! proves the body decrypts under a key held for the event's epoch, enforces gap-free per-author
//! `seq`, applies live-gossip rate caps, and is idempotent. Events that arrive ahead of a gap
//! (`pending = 1`) or ahead of their epoch key (`pending = 2`) are kept and promoted once the gap
//! fills or `unlock` installs the key; projections only ever see applied events (`pending = 0`).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::time::Instant;

use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::crypto::{SpaceKey, blake3_hash};
use crate::error::{Error, Result};
use crate::event::{EventBody, MAX_BODY_BYTES, SignedEvent};
use crate::ids::{SpaceId, UserId, hex_encode};
use crate::migrations;
use crate::ratelimit::{Limiter, RateConfig};
use crate::search::{self, SearchHit, SearchItem};

/// Upper bound of buffered out-of-order or key-less events per author and space.
pub const MAX_PENDING_PER_AUTHOR: i64 = 4096;

/// Largest `seq`/`lamport` accepted from anyone (2^53 - 1: exact in JS numbers). A peer-chosen
/// `i64::MAX` would otherwise make every later local append overflow.
pub const MAX_CLOCK: u64 = (1 << 53) - 1;

/// Largest key epoch accepted in an event or invite. Epochs rise one per rekey.
pub const MAX_EPOCH: u32 = 1 << 20;

/// A key-less event may name at most this many epochs above the highest one held, so a
/// forged far-future epoch cannot park rows that no real key will ever unlock.
pub const MAX_EPOCH_AHEAD: u32 = 16;

/// Key-less (`WAIT_KEY`) rows kept per space; the oldest are evicted past it.
pub const MAX_LOCKED_PER_SPACE: i64 = 4096;

/// Body bytes of key-less rows kept per space; the oldest are evicted past it.
pub const MAX_LOCKED_BYTES_PER_SPACE: i64 = 32 << 20;

const APPLIED: i64 = 0;
const WAIT_SEQ: i64 = 1;
const WAIT_KEY: i64 = 2;

#[derive(Debug, Clone)]
pub struct SpaceRow {
    pub id: SpaceId,
    /// Key held when the space was added, valid for `epoch`.
    pub key: SpaceKey,
    pub epoch: u32,
    /// Name known locally (from the invite or creation) until `space.create` is in the log.
    pub name: String,
    pub kind: String,
    pub is_home: bool,
    pub joined_at: i64,
    pub left: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestStatus {
    /// Stored and visible to projections.
    Applied,
    /// Stored, waiting for earlier `seq` values from the same author or for its epoch key.
    Pending,
    /// Already known; nothing changed.
    Duplicate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ingested {
    pub id: String,
    pub status: IngestStatus,
    /// Ids that became applied by this call (itself plus any promoted pending events).
    pub applied: Vec<String>,
}

/// Where an event came from; decides whether rate caps apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Live gossip: per-author rate caps apply.
    Gossip,
    /// Backfill from a peer: no rate cap (a late joiner legitimately receives thousands).
    Sync,
    /// Authored on this device.
    Local,
}

/// A decrypted, applied event ready for folding.
#[derive(Debug, Clone, PartialEq)]
pub struct Opened {
    pub id: String,
    pub author: UserId,
    pub seq: u64,
    pub lamport: u64,
    pub ts: i64,
    /// Device-local order in which the event became applied; see migration 5.
    pub arrival: u64,
    pub body: EventBody,
}

pub struct Store {
    conn: Connection,
    limiter: Limiter,
}

fn blob_arr<const N: usize>(row: &Row, idx: usize) -> Result<[u8; N]> {
    let v: Vec<u8> = row.get(idx)?;
    v.try_into()
        .map_err(|_| Error::invalid("stored value", "unexpected blob length"))
}

const EVENT_COLS: &str = "space_id, author, seq, lamport, ts, epoch, nonce, body, sig";

fn event_from_row(row: &Row) -> Result<SignedEvent> {
    Ok(SignedEvent {
        space_id: SpaceId(blob_arr(row, 0)?),
        author: UserId(blob_arr(row, 1)?),
        seq: row.get::<_, i64>(2)? as u64,
        lamport: row.get::<_, i64>(3)? as u64,
        ts: row.get(4)?,
        epoch: row.get::<_, i64>(5)? as u32,
        nonce: blob_arr(row, 6)?,
        body: row.get(7)?,
        sig: blob_arr(row, 8)?,
    })
}

const SPACE_COLS: &str = "s.space_id, s.space_key, s.name, s.kind, s.is_home, s.joined_at, s.left";

fn space_from_row(row: &Row) -> Result<SpaceRow> {
    Ok(SpaceRow {
        id: SpaceId(blob_arr(row, 0)?),
        key: SpaceKey(blob_arr(row, 1)?),
        epoch: 0,
        name: row.get(2)?,
        kind: row.get(3)?,
        is_home: row.get::<_, i64>(4)? != 0,
        joined_at: row.get(5)?,
        left: row.get::<_, i64>(6)? != 0,
    })
}

fn key_id(key: &SpaceKey) -> String {
    hex_encode(&blake3_hash(&key.0)[..8])
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        Self::open_with(path, RateConfig::default())
    }

    pub fn open_with(path: &Path, rate: RateConfig) -> Result<Self> {
        Self::init(Connection::open(path).map_err(migrations::classify)?, rate)
    }

    /// Swaps the live-gossip rate and size caps; existing buckets start over.
    pub fn set_rate(&mut self, rate: RateConfig) {
        self.limiter = Limiter::new(rate);
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?, RateConfig::default())
    }

    fn init(mut conn: Connection, rate: RateConfig) -> Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;",
        )
        .map_err(migrations::classify)?;
        migrations::integrity_check(&conn).map_err(|e| match e {
            Error::Sqlite(s) => migrations::classify(s),
            other => other,
        })?;
        migrations::migrate(&mut conn)?;
        Ok(Store {
            conn,
            limiter: Limiter::new(rate),
        })
    }

    /// Schema version of the open database.
    pub fn schema_version(&self) -> Result<u32> {
        migrations::version(&self.conn)
    }

    /// Full SQLite integrity check.
    pub fn integrity_check(&self) -> Result<()> {
        migrations::integrity_check(&self.conn)
    }

    // ---- spaces and keys ----

    /// Inserts a space and its first key. Returns false if the space already existed.
    pub fn add_space(&self, row: &SpaceRow) -> Result<bool> {
        let tx = self.conn.unchecked_transaction()?;
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO spaces(space_id, space_key, name, kind, is_home, joined_at, left)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            params![&row.id.0[..], &row.key.0[..], row.name, row.kind, row.is_home as i64, row.joined_at],
        )?;
        self.add_key(&row.id, row.epoch, &row.key)?;
        tx.commit()?;
        Ok(n > 0)
    }

    pub fn space(&self, id: &SpaceId) -> Result<Option<SpaceRow>> {
        let mut row = self
            .conn
            .query_row(
                &format!("SELECT {SPACE_COLS} FROM spaces s WHERE s.space_id = ?1"),
                [&id.0[..]],
                |r| Ok(space_from_row(r)),
            )
            .optional()?
            .transpose()?;
        if let (Some(r), Some((epoch, key))) = (row.as_mut(), self.current_key(id)?) {
            r.epoch = epoch;
            r.key = key;
        }
        Ok(row)
    }

    /// All spaces, home first, then by join time.
    pub fn spaces(&self) -> Result<Vec<SpaceRow>> {
        let ids: Vec<SpaceId> = {
            let mut st = self.conn.prepare(
                "SELECT space_id FROM spaces s ORDER BY is_home DESC, joined_at, space_id",
            )?;
            st.query_map([], |r| Ok(blob_arr::<32>(r, 0)))?
                .map(|r| r?.map(SpaceId))
                .collect::<Result<_>>()?
        };
        ids.iter()
            .map(|id| self.space(id).map(|s| s.expect("listed space exists")))
            .collect()
    }

    pub fn home(&self) -> Result<Option<SpaceRow>> {
        Ok(self.spaces()?.into_iter().find(|s| s.is_home))
    }

    pub fn mark_left(&self, id: &SpaceId) -> Result<()> {
        self.conn.execute(
            "UPDATE spaces SET left = 1 WHERE space_id = ?1 AND is_home = 0",
            [&id.0[..]],
        )?;
        Ok(())
    }

    /// Removes a space and everything stored for it. Only for rolling back a join that failed.
    pub fn forget_space(&self, id: &SpaceId) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for table in ["events", "space_keys", "spaces"] {
            self.conn.execute(
                &format!("DELETE FROM {table} WHERE space_id = ?1"),
                [&id.0[..]],
            )?;
        }
        self.kv_delete(&format!("lamport_floor.{id}"))?;
        tx.commit()?;
        Ok(())
    }

    /// Clears the `left` flag so a previously left space is tracked again.
    pub fn reopen_space(&self, id: &SpaceId) -> Result<()> {
        self.conn.execute(
            "UPDATE spaces SET left = 0 WHERE space_id = ?1",
            [&id.0[..]],
        )?;
        Ok(())
    }

    /// Records a key for an epoch. Several keys per epoch may exist (concurrent rekeys); decryption
    /// tries them all. Returns true if the key was new.
    pub fn add_key(&self, space: &SpaceId, epoch: u32, key: &SpaceKey) -> Result<bool> {
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO space_keys(space_id, epoch, key_id, key) VALUES (?1, ?2, ?3, ?4)",
            params![&space.0[..], epoch as i64, key_id(key), &key.0[..]],
        )?;
        Ok(n > 0)
    }

    /// Keys held for one epoch.
    pub fn keys_for(&self, space: &SpaceId, epoch: u32) -> Result<Vec<SpaceKey>> {
        let mut st = self.conn.prepare(
            "SELECT key FROM space_keys WHERE space_id = ?1 AND epoch = ?2 ORDER BY rowid",
        )?;
        st.query_map(params![&space.0[..], epoch as i64], |r| {
            Ok(blob_arr::<32>(r, 0))
        })?
        .map(|r| r?.map(SpaceKey))
        .collect()
    }

    /// Every held key by epoch.
    pub fn all_keys(&self, space: &SpaceId) -> Result<BTreeMap<u32, Vec<SpaceKey>>> {
        let mut st = self
            .conn
            .prepare("SELECT epoch, key FROM space_keys WHERE space_id = ?1 ORDER BY rowid")?;
        let rows = st.query_map([&space.0[..]], |r| {
            Ok((r.get::<_, i64>(0)?, blob_arr::<32>(r, 1)))
        })?;
        let mut out: BTreeMap<u32, Vec<SpaceKey>> = BTreeMap::new();
        for r in rows {
            let (epoch, key) = r?;
            out.entry(epoch as u32).or_default().push(SpaceKey(key?));
        }
        Ok(out)
    }

    /// The newest epoch we hold a key for, and that key.
    pub fn current_key(&self, space: &SpaceId) -> Result<Option<(u32, SpaceKey)>> {
        let row = self
            .conn
            .query_row(
                "SELECT epoch, key FROM space_keys WHERE space_id = ?1 ORDER BY epoch DESC, rowid LIMIT 1",
                [&space.0[..]],
                |r| Ok((r.get::<_, i64>(0)?, blob_arr::<32>(r, 1))),
            )
            .optional()?;
        row.map(|(e, k)| Ok((e as u32, SpaceKey(k?)))).transpose()
    }

    // ---- events ----

    /// Stores an event from live gossip (rate capped).
    pub fn ingest(&mut self, ev: &SignedEvent) -> Result<Ingested> {
        self.ingest_from(ev, Source::Gossip)
    }

    /// Validates and stores an event. See the module docs for the rules.
    pub fn ingest_from(&mut self, ev: &SignedEvent, source: Source) -> Result<Ingested> {
        if ev.seq == 0
            || ev.seq > MAX_CLOCK
            || ev.lamport == 0
            || ev.lamport > MAX_CLOCK
            || ev.epoch > MAX_EPOCH
        {
            return Err(Error::invalid(
                "event",
                "seq and lamport must be in 1..=2^53-1 and epoch within bounds",
            ));
        }
        if ev.body.len() > MAX_BODY_BYTES.min(self.limiter.config().max_event_bytes) {
            return Err(Error::invalid("event", "body too large"));
        }
        let id = ev.id();
        let known: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE id = ?1)",
            [&id],
            |r| r.get(0),
        )?;
        if known {
            return Ok(Ingested {
                id,
                status: IngestStatus::Duplicate,
                applied: vec![],
            });
        }
        let space = self
            .space(&ev.space_id)?
            .filter(|s| !s.left)
            .ok_or_else(|| Error::UnknownSpace(ev.space_id.to_string()))?;
        ev.verify()?;
        if source == Source::Gossip && !self.limiter.allow(ev.space_id, ev.author, Instant::now()) {
            return Err(Error::RateLimited(ev.author.short()));
        }
        let keys = self.keys_for(&space.id, ev.epoch)?;
        let locked = keys.is_empty();
        if locked {
            if ev.epoch > space.epoch.saturating_add(MAX_EPOCH_AHEAD) {
                return Err(Error::invalid("event", "epoch too far ahead"));
            }
        } else {
            ev.open_any(&keys)?;
        }

        let tx = self.conn.transaction()?;
        let author = &ev.author.0[..];
        let space_id = &ev.space_id.0[..];
        let same_slot: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE space_id = ?1 AND author = ?2 AND seq = ?3)",
            params![space_id, author, ev.seq as i64],
            |r| r.get(0),
        )?;
        if same_slot {
            return Err(Error::Equivocation);
        }
        let applied_max = applied_max(&tx, space_id, author)?;
        let in_order = !locked && ev.seq as i64 == applied_max + 1;
        if !in_order {
            let buffered: i64 = tx.query_row(
                "SELECT COUNT(*) FROM events WHERE space_id = ?1 AND author = ?2 AND pending > 0",
                params![space_id, author],
                |r| r.get(0),
            )?;
            if buffered >= MAX_PENDING_PER_AUTHOR {
                return Err(Error::invalid(
                    "event",
                    "too many buffered events from this author",
                ));
            }
        }
        if locked {
            evict_locked(&tx, space_id, ev.body.len() as i64)?;
        }
        let pending = if locked {
            WAIT_KEY
        } else if in_order {
            APPLIED
        } else {
            WAIT_SEQ
        };
        tx.execute(
            "INSERT INTO events(id, space_id, author, seq, lamport, ts, epoch, nonce, body, sig, pending)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![id, space_id, author, ev.seq as i64, ev.lamport as i64, ev.ts, ev.epoch as i64, &ev.nonce[..], ev.body, &ev.sig[..], pending],
        )?;
        let mut applied = Vec::new();
        if in_order {
            applied.push(id.clone());
            applied.extend(promote(&tx, space_id, author)?);
        }
        tx.commit()?;
        let status = if in_order {
            IngestStatus::Applied
        } else {
            IngestStatus::Pending
        };
        Ok(Ingested {
            id,
            status,
            applied,
        })
    }

    /// Re-tries every key-less event of a space after new keys arrived. Returns ids now applied.
    pub fn unlock(&mut self, space: &SpaceId) -> Result<Vec<String>> {
        let keys = self.all_keys(space)?;
        let locked: Vec<(String, SignedEvent)> = {
            let mut st = self.conn.prepare(&format!(
                "SELECT id, {EVENT_COLS} FROM events WHERE space_id = ?1 AND pending = {WAIT_KEY}"
            ))?;
            st.query_map([&space.0[..]], |r| {
                let id: String = r.get(0)?;
                Ok(event_from_row_at(r, 1).map(|e| (id, e)))
            })?
            .map(|r| r?)
            .collect::<Result<_>>()?
        };
        let tx = self.conn.transaction()?;
        let mut authors = BTreeSet::new();
        for (id, ev) in &locked {
            if keys
                .get(&ev.epoch)
                .is_some_and(|ks| ev.open_any(ks).is_ok())
            {
                tx.execute(
                    "UPDATE events SET pending = ?2 WHERE id = ?1",
                    params![id, WAIT_SEQ],
                )?;
                authors.insert(ev.author);
            }
        }
        let mut applied = Vec::new();
        for a in authors {
            applied.extend(promote(&tx, &space.0[..], &a.0[..])?);
        }
        tx.commit()?;
        Ok(applied)
    }

    pub fn event_by_id(&self, id: &str) -> Result<Option<SignedEvent>> {
        self.conn
            .query_row(
                &format!("SELECT {EVENT_COLS} FROM events WHERE id = ?1"),
                [id],
                |r| Ok(event_from_row(r)),
            )
            .optional()?
            .transpose()
    }

    /// Applied events of a space in fold order `(lamport, author, seq)`.
    pub fn events(&self, space: &SpaceId) -> Result<Vec<SignedEvent>> {
        self.query_events(space, "pending = 0 ORDER BY lamport, author, seq")
    }

    /// Every stored event of a space in any state, for backup.
    pub fn all_events(&self, space: &SpaceId) -> Result<Vec<SignedEvent>> {
        self.query_events(space, "1 = 1 ORDER BY lamport, author, seq")
    }

    fn query_events(&self, space: &SpaceId, tail: &str) -> Result<Vec<SignedEvent>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {EVENT_COLS} FROM events WHERE space_id = ?1 AND {tail}"
        ))?;
        st.query_map([&space.0[..]], |r| Ok(event_from_row(r)))?
            .map(|r| r?)
            .collect()
    }

    /// Applied events newer than `vector` (per author max seq seen by the requester), in
    /// `(author, seq)` order, at most `limit`. Filtered in SQL per author so a page never loads
    /// the whole space.
    pub fn events_since(
        &self,
        space: &SpaceId,
        vector: &BTreeMap<UserId, u64>,
        limit: usize,
    ) -> Result<Vec<SignedEvent>> {
        let mut authors = self.conn.prepare(
            "SELECT DISTINCT author FROM events WHERE space_id = ?1 AND pending = 0 ORDER BY author",
        )?;
        let authors: Vec<UserId> = authors
            .query_map([&space.0[..]], |r| Ok(blob_arr::<32>(r, 0)))?
            .map(|r| Ok(UserId(r??)))
            .collect::<Result<_>>()?;
        let mut st = self.conn.prepare(&format!(
            "SELECT {EVENT_COLS} FROM events WHERE space_id = ?1 AND author = ?2 AND pending = 0 \
             AND seq > ?3 ORDER BY seq LIMIT ?4"
        ))?;
        let mut out = Vec::new();
        for a in authors {
            let room = limit.saturating_sub(out.len());
            if room == 0 {
                break;
            }
            let seen = vector.get(&a).copied().unwrap_or(0) as i64;
            let rows = st.query_map(
                params![
                    &space.0[..],
                    &a.0[..],
                    seen,
                    room.min(i64::MAX as usize) as i64
                ],
                |r| Ok(event_from_row(r)),
            )?;
            for r in rows {
                out.push(r??);
            }
        }
        Ok(out)
    }

    /// Highest applied `seq` per author.
    pub fn vector(&self, space: &SpaceId) -> Result<BTreeMap<UserId, u64>> {
        let mut st = self.conn.prepare("SELECT author, MAX(seq) FROM events WHERE space_id = ?1 AND pending = 0 GROUP BY author")?;
        let rows = st.query_map([&space.0[..]], |r| {
            Ok((blob_arr::<32>(r, 0), r.get::<_, i64>(1)?))
        })?;
        let mut out = BTreeMap::new();
        for r in rows {
            let (a, m) = r?;
            out.insert(UserId(a?), m as u64);
        }
        Ok(out)
    }

    /// Events stored but not yet applied (waiting for a gap or a key).
    pub fn pending_count(&self, space: &SpaceId) -> Result<u64> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM events WHERE space_id = ?1 AND pending > 0",
            [&space.0[..]],
            |r| r.get::<_, i64>(0),
        )? as u64)
    }

    /// Events waiting specifically for an epoch key.
    pub fn locked_count(&self, space: &SpaceId) -> Result<u64> {
        Ok(self.conn.query_row(
            &format!("SELECT COUNT(*) FROM events WHERE space_id = ?1 AND pending = {WAIT_KEY}"),
            [&space.0[..]],
            |r| r.get::<_, i64>(0),
        )? as u64)
    }

    pub fn applied_count(&self, space: &SpaceId) -> Result<u64> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM events WHERE space_id = ?1 AND pending = 0",
            [&space.0[..]],
            |r| r.get::<_, i64>(0),
        )? as u64)
    }

    /// Highest lamport among applied events. Buffered events do not count, nor does any row
    /// above [`MAX_CLOCK`] that an older version accepted.
    pub fn max_lamport(&self, space: &SpaceId) -> Result<u64> {
        Ok(self.conn.query_row(
            "SELECT COALESCE(MAX(lamport), 0) FROM events WHERE space_id = ?1 AND pending = 0 AND lamport <= ?2",
            params![&space.0[..], MAX_CLOCK as i64],
            |r| r.get::<_, i64>(0),
        )? as u64)
    }

    /// Minimum lamport the next local event must exceed (set from an invite's clock hint).
    pub fn lamport_floor(&self, space: &SpaceId) -> Result<u64> {
        Ok(self
            .kv_get(&format!("lamport_floor.{space}"))?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    }

    pub fn raise_lamport_floor(&self, space: &SpaceId, lamport: u64) -> Result<()> {
        if lamport > self.lamport_floor(space)? {
            self.kv_set(&format!("lamport_floor.{space}"), &lamport.to_string())?;
        }
        Ok(())
    }

    /// Arrival stamp of every applied event of a space, by event id.
    fn arrivals(&self, space: &SpaceId) -> Result<BTreeMap<String, u64>> {
        let mut st = self
            .conn
            .prepare("SELECT id, arrival FROM events WHERE space_id = ?1 AND pending = 0")?;
        let rows = st.query_map([&space.0[..]], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64))
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Applied events decrypted and decoded, in fold order. Rows that no longer decode are skipped.
    pub fn load_opened(&self, space: &SpaceRow) -> Result<Vec<Opened>> {
        let keys = self.all_keys(&space.id)?;
        let arrivals = self.arrivals(&space.id)?;
        Ok(self
            .events(&space.id)?
            .into_iter()
            .filter_map(|ev| {
                let d = ev.open_any(keys.get(&ev.epoch)?).ok()?;
                let id = ev.id();
                Some(Opened {
                    arrival: arrivals.get(&id).copied().unwrap_or(0),
                    id,
                    author: ev.author,
                    seq: ev.seq,
                    lamport: ev.lamport,
                    ts: ev.ts,
                    body: d.body,
                })
            })
            .collect())
    }

    /// `(event count, ciphertext bytes)` stored for a space, any state.
    pub fn space_usage(&self, space: &SpaceId) -> Result<(u64, u64)> {
        let (n, b): (i64, i64) = self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(body)), 0) FROM events WHERE space_id = ?1",
            [&space.0[..]],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok((n as u64, b as u64))
    }

    // ---- local key/value ----

    pub fn kv_get(&self, k: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT v FROM kv WHERE k = ?1", [k], |r| r.get(0))
            .optional()?)
    }

    pub fn kv_set(&self, k: &str, v: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO kv(k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            [k, v],
        )?;
        Ok(())
    }

    pub fn kv_delete(&self, k: &str) -> Result<()> {
        self.conn.execute("DELETE FROM kv WHERE k = ?1", [k])?;
        Ok(())
    }

    /// All entries whose key starts with `prefix`.
    pub fn kv_prefix(&self, prefix: &str) -> Result<BTreeMap<String, String>> {
        let mut st = self
            .conn
            .prepare("SELECT k, v FROM kv WHERE substr(k, 1, ?2) = ?1 ORDER BY k")?;
        let rows = st.query_map(params![prefix, prefix.chars().count() as i64], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    // ---- read markers, blocks, follows (device-local, never in the log) ----

    /// Records that everything up to `lamport` in a channel has been seen (never moves backwards).
    pub fn set_read_marker(&self, space: &SpaceId, channel: &str, lamport: u64) -> Result<()> {
        // The arrival it covers: the newest applied event at or below `lamport`. A concurrent event that
        // arrives later gets a higher arrival, so it stays unread even when its lamport is below the marker.
        self.conn.execute(
            "INSERT INTO read_markers(space_id, channel_id, lamport, arrival) VALUES (?1, ?2, ?3,
               COALESCE((SELECT MAX(arrival) FROM events WHERE space_id = ?1 AND lamport <= ?3), 0))
             ON CONFLICT(space_id, channel_id) DO UPDATE SET
               lamport = MAX(lamport, excluded.lamport), arrival = MAX(arrival, excluded.arrival)",
            params![&space.0[..], channel, lamport as i64],
        )?;
        Ok(())
    }

    /// Arrival each read marker covers; this, not the lamport, decides what is unread.
    pub fn read_arrivals(&self) -> Result<BTreeMap<(SpaceId, String), u64>> {
        let mut st = self
            .conn
            .prepare("SELECT space_id, channel_id, arrival FROM read_markers")?;
        let rows = st.query_map([], |r| {
            Ok((
                blob_arr::<32>(r, 0),
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?;
        let mut out = BTreeMap::new();
        for r in rows {
            let (s, c, a) = r?;
            out.insert((SpaceId(s?), c), a as u64);
        }
        Ok(out)
    }

    pub fn read_markers(&self) -> Result<BTreeMap<(SpaceId, String), u64>> {
        let mut st = self
            .conn
            .prepare("SELECT space_id, channel_id, lamport FROM read_markers")?;
        let rows = st.query_map([], |r| {
            Ok((
                blob_arr::<32>(r, 0),
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?;
        let mut out = BTreeMap::new();
        for r in rows {
            let (s, c, l) = r?;
            out.insert((SpaceId(s?), c), l as u64);
        }
        Ok(out)
    }

    pub fn block_user(&self, user: &str, ts: i64) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO blocks(user, ts) VALUES (?1, ?2)",
            params![user, ts],
        )?;
        Ok(())
    }

    pub fn unblock_user(&self, user: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM blocks WHERE user = ?1", [user])?;
        Ok(())
    }

    /// Blocked users with the time (ms) they were blocked.
    pub fn blocked_since(&self) -> Result<Vec<(String, i64)>> {
        let mut st = self
            .conn
            .prepare("SELECT user, ts FROM blocks ORDER BY ts")?;
        Ok(st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?)
    }

    pub fn blob_meta_put(&self, hash: &str, name: &str, mime: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO blob_meta(hash, name, mime) VALUES (?1, ?2, ?3)
             ON CONFLICT(hash) DO UPDATE SET name = excluded.name, mime = excluded.mime",
            params![hash, name, mime],
        )?;
        Ok(())
    }

    pub fn blob_mime(&self, hash: &str) -> Result<Option<String>> {
        match self
            .conn
            .query_row("SELECT mime FROM blob_meta WHERE hash = ?1", [hash], |r| {
                r.get(0)
            }) {
            Ok(m) => Ok(Some(m)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn blocked(&self) -> Result<BTreeSet<String>> {
        let mut st = self.conn.prepare("SELECT user FROM blocks")?;
        Ok(st
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?)
    }

    pub fn follow(&self, kind: &str, target: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO follows(kind, target) VALUES (?1, ?2)",
            [kind, target],
        )?;
        Ok(())
    }

    pub fn unfollow(&self, kind: &str, target: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM follows WHERE kind = ?1 AND target = ?2",
            [kind, target],
        )?;
        Ok(())
    }

    /// `(kind, target)` pairs, kind being `user` or `space`.
    pub fn follows(&self) -> Result<BTreeSet<(String, String)>> {
        let mut st = self.conn.prepare("SELECT kind, target FROM follows")?;
        Ok(st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?)
    }

    // ---- search ----

    /// True when the space's index does not reflect its applied events.
    pub fn search_stale(&self, space: &SpaceId) -> Result<bool> {
        search::is_stale(&self.conn, space, self.applied_count(space)?)
    }

    pub fn search_reindex(&mut self, space: &SpaceId, items: &[SearchItem]) -> Result<()> {
        let stamp = self.applied_count(space)?;
        search::reindex(&mut self.conn, space, items, stamp)
    }

    pub fn search_query(
        &self,
        q: &str,
        spaces: &[SpaceId],
        kinds: &[String],
        limit: usize,
    ) -> Result<Vec<SearchHit>> {
        search::query(&self.conn, q, spaces, kinds, &self.blocked()?, limit)
    }
}

fn event_from_row_at(row: &Row, offset: usize) -> Result<SignedEvent> {
    Ok(SignedEvent {
        space_id: SpaceId(blob_arr(row, offset)?),
        author: UserId(blob_arr(row, offset + 1)?),
        seq: row.get::<_, i64>(offset + 2)? as u64,
        lamport: row.get::<_, i64>(offset + 3)? as u64,
        ts: row.get(offset + 4)?,
        epoch: row.get::<_, i64>(offset + 5)? as u32,
        nonce: blob_arr(row, offset + 6)?,
        body: row.get(offset + 7)?,
        sig: blob_arr(row, offset + 8)?,
    })
}

fn applied_max(tx: &rusqlite::Transaction, space: &[u8], author: &[u8]) -> Result<i64> {
    Ok(tx.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM events WHERE space_id = ?1 AND author = ?2 AND pending = 0",
        params![space, author],
        |r| r.get(0),
    )?)
}

/// Makes room for one more key-less row of `incoming` body bytes by evicting the oldest
/// ones past [`MAX_LOCKED_PER_SPACE`] rows or [`MAX_LOCKED_BYTES_PER_SPACE`] bytes.
fn evict_locked(tx: &rusqlite::Transaction, space: &[u8], incoming: i64) -> Result<()> {
    tx.execute(
        &format!(
            "DELETE FROM events WHERE id IN (
               SELECT id FROM (
                 SELECT id,
                        ROW_NUMBER() OVER (ORDER BY rowid DESC) AS n,
                        SUM(LENGTH(body)) OVER (ORDER BY rowid DESC) AS bytes
                 FROM events WHERE space_id = ?1 AND pending = {WAIT_KEY})
               WHERE n > ?2 OR bytes > ?3)"
        ),
        params![
            space,
            MAX_LOCKED_PER_SPACE - 1,
            MAX_LOCKED_BYTES_PER_SPACE - incoming
        ],
    )?;
    Ok(())
}

/// Applies buffered events that are now next in line for `author`. Returns their ids.
fn promote(tx: &rusqlite::Transaction, space: &[u8], author: &[u8]) -> Result<Vec<String>> {
    let mut applied = Vec::new();
    loop {
        let next = applied_max(tx, space, author)? + 1;
        let id: Option<String> = tx
            .query_row(
                &format!("SELECT id FROM events WHERE space_id = ?1 AND author = ?2 AND seq = ?3 AND pending = {WAIT_SEQ}"),
                params![space, author, next],
                |r| r.get(0),
            )
            .optional()?;
        let Some(id) = id else { return Ok(applied) };
        tx.execute("UPDATE events SET pending = 0 WHERE id = ?1", [&id])?;
        applied.push(id);
    }
}
