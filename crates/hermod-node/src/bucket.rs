//! Async token bucket used by the resource governor.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Byte-rate limiter. `rate == 0` means unlimited.
pub struct TokenBucket {
    inner: Mutex<Inner>,
}

struct Inner {
    rate: u64,
    tokens: f64,
    last: Instant,
}

impl TokenBucket {
    pub fn new(rate_bps: u64) -> Self {
        Self {
            inner: Mutex::new(Inner {
                rate: rate_bps,
                tokens: rate_bps as f64,
                last: Instant::now(),
            }),
        }
    }

    pub fn set_rate(&self, rate_bps: u64) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.rate = rate_bps;
        g.tokens = g.tokens.min(rate_bps as f64);
    }

    /// Reserve `n` bytes and return how long the caller must wait before using them.
    pub fn reserve(&self, n: u64) -> Duration {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if g.rate == 0 {
            return Duration::ZERO;
        }
        let now = Instant::now();
        let rate = g.rate as f64;
        g.tokens = (g.tokens + now.duration_since(g.last).as_secs_f64() * rate).min(rate);
        g.last = now;
        g.tokens -= n as f64;
        if g.tokens >= 0.0 {
            Duration::ZERO
        } else {
            Duration::from_secs_f64(-g.tokens / rate)
        }
    }

    /// Like [`TokenBucket::reserve`], but refuses (`None`, nothing reserved) when the wait
    /// would exceed `max_wait`, so a backlog cannot queue unbounded sleepers.
    pub fn try_reserve(&self, n: u64, max_wait: Duration) -> Option<Duration> {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if g.rate == 0 {
            return Some(Duration::ZERO);
        }
        let now = Instant::now();
        let rate = g.rate as f64;
        let tokens = (g.tokens + now.duration_since(g.last).as_secs_f64() * rate).min(rate);
        let after = tokens - n as f64;
        let wait = if after >= 0.0 {
            Duration::ZERO
        } else {
            Duration::from_secs_f64(-after / rate)
        };
        if wait > max_wait {
            return None;
        }
        g.tokens = after;
        g.last = now;
        Some(wait)
    }

    /// Waits for `n` bytes of budget; false (nothing taken) when that would take over `max_wait`.
    pub async fn take_within(&self, n: u64, max_wait: Duration) -> bool {
        let Some(wait) = self.try_reserve(n, max_wait) else {
            return false;
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_then_delay() {
        let b = TokenBucket::new(1000);
        assert_eq!(b.reserve(1000), Duration::ZERO);
        let w = b.reserve(500);
        assert!(
            w >= Duration::from_millis(400) && w <= Duration::from_millis(520),
            "{w:?}"
        );
    }

    #[test]
    fn try_reserve_refuses_long_waits_without_reserving() {
        let b = TokenBucket::new(1000);
        assert_eq!(b.try_reserve(1000, Duration::ZERO), Some(Duration::ZERO));
        assert_eq!(
            b.try_reserve(5000, Duration::from_secs(1)),
            None,
            "5 s wait refused"
        );
        let w = b
            .try_reserve(500, Duration::from_secs(1))
            .expect("within budget");
        assert!(
            w <= Duration::from_millis(520),
            "refusal reserved nothing: {w:?}"
        );
    }

    #[tokio::test]
    async fn take_within_refuses_instead_of_sleeping_past_the_cap() {
        let b = TokenBucket::new(1000);
        assert!(b.take_within(1000, Duration::from_secs(1)).await);
        let t = Instant::now();
        assert!(!b.take_within(60_000, Duration::from_secs(1)).await);
        assert!(t.elapsed() < Duration::from_millis(200), "refused at once");
    }

    #[test]
    fn zero_is_unlimited() {
        assert_eq!(TokenBucket::new(0).reserve(u64::MAX / 2), Duration::ZERO);
    }
}
