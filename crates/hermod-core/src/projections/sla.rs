//! SLA clocks for the Help Desk: pure functions over millisecond timestamps.
//!
//! Business hours are a fixed UTC offset, a set of weekdays and a daily window. Without hours (or
//! with an unusable window) time is wall-clock, 24x7. A clock that pauses is described by its
//! running intervals; the due time is where the running business minutes reach the target.

use chrono::{LocalResult, Offset, TimeZone};
use chrono_tz::Tz;

use crate::event::BusinessHoursIn;

const MIN_MS: i64 = 60_000;
const DAY_MS: i64 = 86_400_000;
/// Days walked at most when searching for a due time or measuring an interval.
const MAX_DAYS: i64 = 3660;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Zone {
    Fixed(i32),
    Named(Tz),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hours {
    zone: Zone,
    /// `days[0]` is Sunday.
    pub days: [bool; 7],
    pub start: i64,
    pub end: i64,
}

/// Parses `UTC`, `Z`, `+08:00`, `-0530`, `+8`. Returns minutes east of UTC.
pub fn parse_offset(tz: &str) -> Option<i32> {
    let t = tz.trim();
    if t.eq_ignore_ascii_case("utc") || t.eq_ignore_ascii_case("z") || t.eq_ignore_ascii_case("gmt")
    {
        return Some(0);
    }
    let (sign, rest) = match t.as_bytes().first()? {
        b'+' => (1, &t[1..]),
        b'-' => (-1, &t[1..]),
        _ => return None,
    };
    let digits: String = rest.chars().filter(|c| *c != ':').collect();
    if digits.is_empty() || digits.len() > 4 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let (h, m) = if rest.contains(':') {
        let (h, m) = rest.split_once(':')?;
        (h.parse::<i32>().ok()?, m.parse::<i32>().ok()?)
    } else if digits.len() <= 2 {
        (digits.parse::<i32>().ok()?, 0)
    } else {
        let split = digits.len() - 2;
        (
            digits[..split].parse::<i32>().ok()?,
            digits[split..].parse::<i32>().ok()?,
        )
    };
    (h <= 14 && m < 60).then_some(sign * (h * 60 + m))
}

/// A fixed offset (`+08:00`) or an IANA zone name (`Asia/Kuala_Lumpur`, `America/New_York`).
fn parse_zone(tz: &str) -> Option<Zone> {
    parse_offset(tz)
        .map(Zone::Fixed)
        .or_else(|| tz.trim().parse::<Tz>().ok().map(Zone::Named))
}

/// True when `tz` names a usable zone (used to validate config).
pub fn valid_zone(tz: &str) -> bool {
    parse_zone(tz).is_some()
}

impl Zone {
    /// UTC offset in ms in force at the UTC instant `ms`.
    fn offset_at(&self, ms: i64) -> i64 {
        match self {
            Zone::Fixed(m) => i64::from(*m) * MIN_MS,
            Zone::Named(tz) => chrono::DateTime::from_timestamp_millis(ms)
                .map(|d| {
                    i64::from(
                        tz.offset_from_utc_datetime(&d.naive_utc())
                            .fix()
                            .local_minus_utc(),
                    ) * 1000
                })
                .unwrap_or(0),
        }
    }

    /// UTC instant of local wall time `local_ms` (ms since the epoch read as local). In a DST gap the
    /// time after the jump is used; in an overlap the earlier instant.
    fn local_to_utc(&self, local_ms: i64) -> i64 {
        match self {
            Zone::Fixed(m) => local_ms - i64::from(*m) * MIN_MS,
            Zone::Named(tz) => {
                let Some(naive) =
                    chrono::DateTime::from_timestamp_millis(local_ms).map(|d| d.naive_utc())
                else {
                    return local_ms;
                };
                match tz.from_local_datetime(&naive) {
                    LocalResult::Single(d) => d.timestamp_millis(),
                    LocalResult::Ambiguous(a, _) => a.timestamp_millis(),
                    LocalResult::None => tz
                        .from_local_datetime(&(naive + chrono::Duration::hours(1)))
                        .earliest()
                        .map_or(local_ms, |d| d.timestamp_millis()),
                }
            }
        }
    }
}

impl Hours {
    /// `None` when the zone or window is unusable, which means "always open".
    pub fn from_event(b: &BusinessHoursIn) -> Option<Hours> {
        let zone = parse_zone(&b.tz)?;
        let mut days = [false; 7];
        for d in &b.days {
            if *d < 7 {
                days[*d as usize] = true;
            }
        }
        (days.iter().any(|d| *d) && b.start < b.end && b.end <= 1440).then_some(Hours {
            zone,
            days,
            start: i64::from(b.start) * MIN_MS,
            end: i64::from(b.end) * MIN_MS,
        })
    }

    /// Open window of the local day with index `day` (days since 1970-01-01 local), in UTC ms.
    fn window(&self, day: i64) -> Option<(i64, i64)> {
        // 1970-01-01 was a Thursday (index 4 with Sunday = 0).
        let dow = (day + 4).rem_euclid(7) as usize;
        self.days[dow].then(|| {
            let midnight = day * DAY_MS;
            (
                self.zone.local_to_utc(midnight + self.start),
                self.zone.local_to_utc(midnight + self.end),
            )
        })
    }

    fn day_of(&self, ms: i64) -> i64 {
        (ms + self.zone.offset_at(ms)).div_euclid(DAY_MS)
    }
}

/// Business milliseconds inside `[a, b)`.
pub fn open_ms(hours: Option<&Hours>, a: i64, b: i64) -> i64 {
    if b <= a {
        return 0;
    }
    let Some(h) = hours else { return b - a };
    let first = h.day_of(a);
    let last = h.day_of(b - 1).min(first + MAX_DAYS);
    (first..=last)
        .filter_map(|d| h.window(d))
        .map(|(s, e)| (e.min(b) - s.max(a)).max(0))
        .sum()
}

/// The instant at which `ms` business milliseconds have elapsed since `from`.
pub fn add_open_ms(hours: Option<&Hours>, from: i64, ms: i64) -> i64 {
    let Some(h) = hours else { return from + ms };
    let mut left = ms.max(0);
    let first = h.day_of(from);
    for d in first..=first + MAX_DAYS {
        let Some((s, e)) = h.window(d) else { continue };
        let s = s.max(from);
        if e <= s {
            continue;
        }
        if left <= e - s {
            return s + left;
        }
        left -= e - s;
    }
    // shortcut: a clock longer than MAX_DAYS of working days is capped; upgrade if such SLAs appear.
    from + MAX_DAYS * DAY_MS
}

/// A clock that runs from `from` and may pause: `(start, end)` intervals where `end` of the last
/// one is `None` while it is running.
pub type Intervals = [(i64, Option<i64>)];

/// Due time of a target of `target_ms` business milliseconds over the running `intervals`.
/// `None` while the clock is paused and the target is not yet used up.
pub fn due_over(hours: Option<&Hours>, intervals: &Intervals, target_ms: i64) -> Option<i64> {
    let mut left = target_ms.max(0);
    for (a, b) in intervals {
        match b {
            Some(end) => {
                let avail = open_ms(hours, *a, *end);
                if left <= avail {
                    return Some(add_open_ms(hours, *a, left));
                }
                left -= avail;
            }
            None => return Some(add_open_ms(hours, *a, left)),
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: i64 = 3_600_000;

    /// Monday to Friday 09:00-17:00 at +08:00.
    fn kl() -> Hours {
        Hours::from_event(&BusinessHoursIn {
            tz: "+08:00".into(),
            days: vec![1, 2, 3, 4, 5],
            start: 540,
            end: 1020,
        })
        .unwrap()
    }

    /// 2024-01-01 was a Monday. UTC ms of a local time at +08:00.
    fn kl_ms(day_of_jan: i64, hour: i64, min: i64) -> i64 {
        // 2024-01-01T00:00:00Z
        let jan1 = 1_704_067_200_000i64;
        jan1 + (day_of_jan - 1) * DAY_MS + hour * H + min * MIN_MS - 8 * H
    }

    #[test]
    fn offsets_parse() {
        assert_eq!(parse_offset("UTC"), Some(0));
        assert_eq!(parse_offset("+08:00"), Some(480));
        assert_eq!(parse_offset("-0530"), Some(-330));
        assert_eq!(parse_offset("+8"), Some(480));
        assert_eq!(parse_offset("Asia/Kuala_Lumpur"), None);
        assert!(
            valid_zone("Asia/Kuala_Lumpur")
                && valid_zone("America/New_York")
                && !valid_zone("Mars/Base")
        );
        assert_eq!(parse_offset("+99:00"), None);
        assert_eq!(parse_offset(""), None);
    }

    #[test]
    fn unusable_hours_mean_always_open() {
        let bad = BusinessHoursIn {
            tz: "UTC".into(),
            days: vec![],
            start: 0,
            end: 60,
        };
        assert!(Hours::from_event(&bad).is_none());
        assert_eq!(open_ms(None, 10, 110), 100);
        assert_eq!(add_open_ms(None, 10, 100), 110);
    }

    #[test]
    fn counts_only_open_windows() {
        let h = kl();
        // Monday 08:00 to 10:00 local: one open hour.
        assert_eq!(open_ms(Some(&h), kl_ms(1, 8, 0), kl_ms(1, 10, 0)), H);
        // Friday 16:00 to Monday 10:00: 1h Friday + 1h Monday.
        assert_eq!(open_ms(Some(&h), kl_ms(5, 16, 0), kl_ms(8, 10, 0)), 2 * H);
        // Saturday is closed.
        assert_eq!(open_ms(Some(&h), kl_ms(6, 0, 0), kl_ms(7, 23, 0)), 0);
    }

    #[test]
    fn due_rolls_over_nights_and_weekends() {
        let h = kl();
        // Created Friday 16:00 local, 4 business hours: 1h Friday, 3h Monday -> Monday 12:00.
        assert_eq!(
            add_open_ms(Some(&h), kl_ms(5, 16, 0), 4 * H),
            kl_ms(8, 12, 0)
        );
        // Created Saturday 03:00: the clock starts Monday 09:00.
        assert_eq!(add_open_ms(Some(&h), kl_ms(6, 3, 0), H), kl_ms(8, 10, 0));
        // Exactly filling a day ends at closing time.
        assert_eq!(
            add_open_ms(Some(&h), kl_ms(1, 9, 0), 8 * H),
            kl_ms(1, 17, 0)
        );
    }

    #[test]
    fn offset_changes_which_hours_are_open() {
        let utc = Hours::from_event(&BusinessHoursIn {
            tz: "UTC".into(),
            days: vec![1, 2, 3, 4, 5],
            start: 540,
            end: 1020,
        })
        .unwrap();
        // Monday 01:00-09:00 UTC is 09:00-17:00 at +08:00 but closed at UTC.
        let (a, b) = (kl_ms(1, 9, 0), kl_ms(1, 17, 0));
        assert_eq!(open_ms(Some(&kl()), a, b), 8 * H);
        assert_eq!(open_ms(Some(&utc), a, b), 0);
    }

    #[test]
    fn paused_clock_does_not_consume_time() {
        let h = kl();
        let t0 = kl_ms(1, 9, 0);
        // Running 1h, paused 09:00+1h .. Tuesday 09:00, then running again: 2h target.
        let iv = [(t0, Some(t0 + H)), (kl_ms(2, 9, 0), None)];
        assert_eq!(due_over(Some(&h), &iv, 2 * H), Some(kl_ms(2, 10, 0)));
        // Still paused with time left: no due time.
        let paused = [(t0, Some(t0 + H))];
        assert_eq!(due_over(Some(&h), &paused, 2 * H), None);
        // Target already used inside the closed interval: due is in the past.
        assert_eq!(due_over(Some(&h), &paused, H / 2), Some(t0 + H / 2));
    }

    #[test]
    fn named_zone_follows_daylight_saving() {
        let ny = Hours::from_event(&BusinessHoursIn {
            tz: "America/New_York".into(),
            days: vec![1, 2, 3, 4, 5],
            start: 540,
            end: 1020,
        })
        .unwrap();
        // 2024-03-10 DST starts (Sunday). Monday 2024-03-04 09:00 EST = 14:00Z; Monday 03-11 09:00 EDT = 13:00Z.
        let utc = |d: i64, h: i64| 1_709_251_200_000i64 + (d - 1) * DAY_MS + h * H; // 2024-03-01T00:00Z
        assert_eq!(add_open_ms(Some(&ny), utc(4, 0), H), utc(4, 15));
        assert_eq!(add_open_ms(Some(&ny), utc(11, 0), H), utc(11, 14));
        // Full working day length stays 8h across the change.
        assert_eq!(open_ms(Some(&ny), utc(11, 0), utc(12, 0)), 8 * H);
    }

    #[test]
    fn dst_fall_back_and_gap_are_deterministic() {
        let hours = |days: Vec<u8>, start, end| {
            Hours::from_event(&BusinessHoursIn {
                tz: "America/New_York".into(),
                days,
                start,
                end,
            })
            .unwrap()
        };
        let utc = |d: i64, h: i64| 1_709_251_200_000i64 + (d - 1) * DAY_MS + h * H; // 2024-03-01T00:00Z
        // Fall back 2024-11-03 (Sunday, 25h day): Monday 11-04 09:00 EST = 14:00Z (Mon 10-28 09:00 EDT = 13:00Z).
        let ny = hours(vec![1, 2, 3, 4, 5], 540, 1020);
        let nov1 = utc(1, 0) + 245 * DAY_MS; // 2024-11-01T00:00Z
        assert_eq!(
            add_open_ms(Some(&ny), nov1 + 3 * DAY_MS, H),
            nov1 + 3 * DAY_MS + 15 * H
        );
        assert_eq!(
            add_open_ms(Some(&ny), nov1 - 4 * DAY_MS, H),
            nov1 - 4 * DAY_MS + 14 * H
        );
        assert_eq!(
            open_ms(Some(&ny), nov1 + 3 * DAY_MS, nov1 + 4 * DAY_MS),
            8 * H
        );
        // Sunday window 00:30-04:00 spans the real 25h day: 1:30 repeats, so 4h30 of wall clock is 3h30 + 1h open.
        let sun = hours(vec![0], 30, 240);
        let (a, b) = (nov1 + 2 * DAY_MS, nov1 + 3 * DAY_MS); // Sat 20:00 EDT .. Sun 20:00 EST
        assert_eq!(open_ms(Some(&sun), a, b), 4 * H + H / 2);
        // Spring forward 2024-03-10: window 01:30-03:30 loses the skipped hour, leaving one real hour.
        let gap = hours(vec![0], 90, 210);
        assert_eq!(open_ms(Some(&gap), utc(9, 0), utc(11, 0)), H);
        // Same call twice gives the same answer.
        assert_eq!(
            add_open_ms(Some(&gap), utc(10, 0), H),
            add_open_ms(Some(&gap), utc(10, 0), H)
        );
    }
}
