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

const PRUNE_ABOVE: usize = 10_000;
const PRUNE_AFTER: Duration = Duration::from_secs(600);

pub struct Limiter {
    cfg: RateConfig,
    buckets: HashMap<(SpaceId, UserId), (f64, Instant)>,
}

impl Limiter {
    pub fn new(cfg: RateConfig) -> Self {
        Limiter {
            cfg,
            buckets: HashMap::new(),
        }
    }

    pub fn config(&self) -> &RateConfig {
        &self.cfg
    }

    /// Takes one token for `(space, author)`. False means the event must be dropped.
    pub fn allow(&mut self, space: SpaceId, author: UserId, now: Instant) -> bool {
        if self.buckets.len() > PRUNE_ABOVE {
            self.buckets
                .retain(|_, (_, at)| now.duration_since(*at) < PRUNE_AFTER);
        }
        let burst = f64::from(self.cfg.burst);
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
}
