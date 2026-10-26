//! Per-author token buckets for live ingestion (E-010). Backfill and local appends bypass it.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::ids::{SpaceId, UserId};

/// Limits applied to events arriving over gossip.
#[derive(Debug, Clone, PartialEq)]
pub struct RateConfig {
    /// Sustained events per second per author and space.
    pub events_per_sec: f64,
    /// Bucket size: how many events an author may send at once.
    pub burst: u32,
    /// Largest accepted event body in bytes.
    pub max_event_bytes: usize,
}

impl Default for RateConfig {
    fn default() -> Self {
        RateConfig {
            events_per_sec: 30.0,
            burst: 60,
            max_event_bytes: crate::event::MAX_BODY_BYTES,
        }
    }
}

/// How often idle buckets are swept; a sweep is O(buckets), so it must not run per call.
const PRUNE_EVERY: Duration = Duration::from_secs(60);
/// A bucket idle this long is full again, so dropping it loses nothing.
const PRUNE_AFTER: Duration = Duration::from_secs(600);

/// Most buckets kept at once. Signature checks pass for any fresh keypair, so without a cap a
/// stranger minting identities grows the map without bound; past it the stalest bucket goes.
const MAX_BUCKETS: usize = 8192;

pub struct Limiter {
    cfg: RateConfig,
    buckets: HashMap<(SpaceId, UserId), (f64, Instant)>,
    last_prune: Option<Instant>,
}

impl Limiter {
    pub fn new(cfg: RateConfig) -> Self {
        Limiter {
            cfg,
            buckets: HashMap::new(),
            last_prune: None,
        }
    }

    pub fn config(&self) -> &RateConfig {
        &self.cfg
    }

    /// Takes one token for `(space, author)`. False means the event must be dropped.
    pub fn allow(&mut self, space: SpaceId, author: UserId, now: Instant) -> bool {
        let last = *self.last_prune.get_or_insert(now);
        if now.saturating_duration_since(last) >= PRUNE_EVERY {
            self.last_prune = Some(now);
            self.buckets
                .retain(|_, (_, at)| now.duration_since(*at) < PRUNE_AFTER);
        }
        let burst = f64::from(self.cfg.burst);
        if self.buckets.len() >= MAX_BUCKETS && !self.buckets.contains_key(&(space, author)) {
            let stalest = self
                .buckets
                .iter()
                .min_by_key(|(_, (_, at))| *at)
                .map(|(k, _)| *k);
            if let Some(k) = stalest {
                self.buckets.remove(&k);
            }
        }
        let (tokens, at) = self.buckets.entry((space, author)).or_insert((burst, now));
        let refill = now.saturating_duration_since(*at).as_secs_f64() * self.cfg.events_per_sec;
        *tokens = (*tokens + refill).min(burst);
        *at = now;
        if *tokens >= 1.0 {
            *tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_then_refill() {
        let mut l = Limiter::new(RateConfig {
            events_per_sec: 10.0,
            burst: 5,
            max_event_bytes: 1024,
        });
        let (s, a) = (SpaceId([1; 32]), UserId([2; 32]));
        let t0 = Instant::now();
        assert_eq!((0..8).filter(|_| l.allow(s, a, t0)).count(), 5);
        assert!(
            !l.allow(s, a, t0 + Duration::from_millis(50)),
            "half a token is not enough"
        );
        assert!(l.allow(s, a, t0 + Duration::from_millis(160)));
        assert!(
            l.allow(s, UserId([3; 32]), t0),
            "other authors have their own bucket"
        );
        assert!(l.allow(SpaceId([9; 32]), a, t0), "and other spaces");
        let later = t0 + Duration::from_secs(60);
        assert_eq!(
            (0..8).filter(|_| l.allow(s, a, later)).count(),
            5,
            "refill is capped at the burst"
        );
    }

    #[test]
    fn idle_buckets_are_pruned_on_an_interval() {
        let mut l = Limiter::new(RateConfig::default());
        let s = SpaceId([1; 32]);
        let t0 = Instant::now();
        for i in 0..100u8 {
            l.allow(s, UserId([i; 32]), t0);
        }
        assert_eq!(l.buckets.len(), 100);
        l.allow(s, UserId([200; 32]), t0 + PRUNE_AFTER + PRUNE_EVERY);
        assert_eq!(
            l.buckets.len(),
            1,
            "idle buckets are swept once the interval passes"
        );
    }

    #[test]
    fn bucket_map_is_bounded() {
        let mut l = Limiter::new(RateConfig::default());
        let t0 = Instant::now();
        for i in 0..(MAX_BUCKETS + 50) {
            let mut id = [0u8; 32];
            id[..8].copy_from_slice(&(i as u64).to_le_bytes());
            l.allow(
                SpaceId([1; 32]),
                UserId(id),
                t0 + Duration::from_micros(i as u64),
            );
        }
        assert_eq!(l.buckets.len(), MAX_BUCKETS);
    }
}
