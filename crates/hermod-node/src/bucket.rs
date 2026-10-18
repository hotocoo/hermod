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

    pub async fn take(&self, n: u64) {
        let wait = self.reserve(n);
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
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
    fn zero_is_unlimited() {
        assert_eq!(TokenBucket::new(0).reserve(u64::MAX / 2), Duration::ZERO);
    }
}
