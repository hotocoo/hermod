//! Per-space data retention (D-004): keep forever, or hide and free content older than N days.
//!
//! Safety design. The signed event log is NEVER edited or deleted: sync (vector clocks, backfill),
//! signature verification and fold determinism all depend on it, and a peer would re-send any
//! event we dropped. So retention works on two derived layers only:
//! 1. Projections: messages older than the cutoff are hidden from every view, count and search
//!    hit on this device (`ProjectionCtx::retention_cutoffs`). Setting "forever" brings them back.
//! 2. Blobs: only blobs referenced by past-retention messages and by no other live event, no
//!    other space and no scheduled message are removed. Chunks shared with a surviving blob stay.
//!    Blobs are content-addressed, so a freed blob is refetchable from peers that still hold it.
//!
//! The cutoff is local and never synced; other devices and members keep their own policy.

use std::collections::{BTreeMap, HashSet};
use std::time::Duration;

use crate::api::{CACHE_GRACE, Core, SETTING_PREFIX, now_ms};
use crate::error::{Error, Result};
use crate::event::EventBody;
use crate::ids::SpaceId;
use crate::search::SearchHit;
use crate::store::Store;

/// Longest retention window accepted (100 years).
pub const MAX_RETENTION_DAYS: u32 = 36_500;
const KEY_PREFIX: &str = "retention.";
const MS_PER_DAY: i64 = 86_400_000;
const KIND_MESSAGE: &str = "message";

/// Full store key. Written straight to the kv store: `Core::setting_set` caps keys at 64 chars
/// and a hex space id alone is longer.
fn key(space: &SpaceId) -> String {
    format!("{SETTING_PREFIX}{KEY_PREFIX}{space}")
}

fn valid_days(d: u32) -> bool {
    (1..=MAX_RETENTION_DAYS).contains(&d)
}

/// Cutoff timestamp (unix ms) per space that has a retention window set.
pub(crate) fn cutoffs(store: &Store, now: i64) -> Result<BTreeMap<SpaceId, i64>> {
    let prefix = format!("{SETTING_PREFIX}{KEY_PREFIX}");
    Ok(store
        .kv_prefix(&prefix)?
        .into_iter()
        .filter_map(|(k, v)| {
            let id = k[prefix.len()..].parse::<SpaceId>().ok()?;
            let days = v.parse::<u32>().ok().filter(|d| valid_days(*d))?;
            Some((id, now.saturating_sub(i64::from(days) * MS_PER_DAY)))
        })
        .collect())
}

/// Drops message hits that fall before their space's cutoff.
pub(crate) fn visible_hits(hits: Vec<SearchHit>, cuts: &BTreeMap<SpaceId, i64>) -> Vec<SearchHit> {
    hits.into_iter()
        .filter(|h| {
            h.kind != KIND_MESSAGE
                || h.space
                    .parse::<SpaceId>()
                    .ok()
                    .and_then(|id| cuts.get(&id))
                    .is_none_or(|cut| h.ts >= *cut)
        })
        .collect()
}

impl Core {
    /// Retention window of a space in days; `None` keeps everything.
    pub fn retention_get(&self, space: &SpaceId) -> Result<Option<u32>> {
        let raw = self.lock().store.kv_get(&key(space))?.unwrap_or_default();
        if raw.is_empty() {
            return Ok(None);
        }
        raw.parse::<u32>()
            .ok()
            .filter(|d| valid_days(*d))
            .map(Some)
            .ok_or_else(|| Error::invalid("retention", "stored value is not a day count"))
    }

    /// Sets the window (`None` = keep forever) and prunes right away. Returns bytes freed.
    pub fn retention_set(&self, space: &SpaceId, days: Option<u32>) -> Result<u64> {
        if days.is_some_and(|d| !valid_days(d)) {
            return Err(Error::invalid(
                "retention",
                "days must be between 1 and 36500",
            ));
        }
        let value = days.map(|d| d.to_string()).unwrap_or_default();
        {
            let inner = self.lock();
            inner.row(space)?;
            inner.store.kv_set(&key(space), &value)?;
        }
        self.retention_prune()
    }

    /// Applies every space's window now. Returns bytes freed.
    pub fn retention_prune(&self) -> Result<u64> {
        self.retention_prune_at(now_ms())
    }

    /// [`Core::retention_prune`] with an explicit clock.
    pub fn retention_prune_at(&self, now: i64) -> Result<u64> {
        self.retention_prune_with(now, CACHE_GRACE)
    }

    /// Like [`Core::retention_prune_at`] with an explicit age floor for freed blobs (the floor
    /// protects blobs just added or still downloading).
    pub fn retention_prune_with(&self, now: i64, grace: Duration) -> Result<u64> {
        let (doomed, live) = {
            let inner = self.lock();
            let cuts = cutoffs(&inner.store, now)?;
            if cuts.is_empty() {
                return Ok(0);
            }
            let mut doomed: HashSet<String> = HashSet::new();
            let mut live: HashSet<String> = HashSet::new();
            for row in inner.store.spaces()?.into_iter().filter(|s| !s.left) {
                let cut = cuts.get(&row.id).copied();
                for ev in inner.store.load_opened(&row)?.iter() {
                    let past = cut.is_some_and(|c| ev.ts < c)
                        && matches!(ev.body, EventBody::MessagePost { .. });
                    let hashes = ev.body.blob_refs().into_iter().map(|b| b.hash.clone());
                    if past {
                        doomed.extend(hashes);
                    } else {
                        live.extend(hashes);
                    }
                }
            }
            for s in Core::sched_load(&inner.store)? {
                live.extend(s.body.blob_refs().into_iter().map(|b| b.hash.clone()));
            }
            (doomed, live)
        };
        let victims: HashSet<String> = doomed.difference(&live).cloned().collect();
        if victims.is_empty() {
            return Ok(0);
        }
        let keep: HashSet<String> = self
            .blobs()
            .list()?
            .into_iter()
            .filter(|h| !victims.contains(h))
            .collect();
        self.blobs().gc(&keep, grace)
    }
}
