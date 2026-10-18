//! Relative and clock time strings, computed from `ts` and a caller supplied `now` and timezone
//! offset so projections stay pure and deterministic.

const DAY_MS: i64 = 86_400_000;
const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

fn local(ms: i64, tz_secs: i32) -> i64 {
    ms.saturating_add(tz_secs as i64 * 1000)
}

fn day_of(ms: i64, tz_secs: i32) -> i64 {
    local(ms, tz_secs).div_euclid(DAY_MS)
}

/// Gregorian (year, month 1..=12, day 1..=31) from days since 1970-01-01.
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

fn weekday(days: i64) -> &'static str {
    WEEKDAYS[(days + 4).rem_euclid(7) as usize]
}

/// `HH:MM` in the local timezone.
pub fn clock(ts: i64, tz_secs: i32) -> String {
    let secs = local(ts, tz_secs).rem_euclid(DAY_MS) / 1000;
    format!("{:02}:{:02}", secs / 3600, secs % 3600 / 60)
}

fn older(ts: i64, now: i64, tz: i32) -> Option<String> {
    let (d, nd) = (day_of(ts, tz), day_of(now, tz));
    match nd - d {
        ..=0 => None,
        1 => Some("Yesterday".into()),
        2..=6 => Some(weekday(d).into()),
        _ => {
            let (_, m, day) = civil(d);
            Some(format!("{day} {}", MONTHS[m as usize - 1]))
        }
    }
}

/// Chat style: `10:02` today, `Yesterday`, weekday within a week, else `3 Oct`.
pub fn msg_time(ts: i64, now: i64, tz: i32) -> String {
    older(ts, now, tz).unwrap_or_else(|| clock(ts, tz))
}

/// Skein style: like [`msg_time`] but today reads `Today 10:01`.
pub fn snap_time(ts: i64, now: i64, tz: i32) -> String {
    older(ts, now, tz).unwrap_or_else(|| format!("Today {}", clock(ts, tz)))
}

/// `just now`, `2 min ago`, `3h ago`, `yesterday`, `4 days ago`, `1 week ago`, `2 months ago`.
pub fn ago_long(ts: i64, now: i64) -> String {
    let secs = (now - ts).max(0) / 1000;
    let (mins, hours, days) = (secs / 60, secs / 3600, secs / 86_400);
    let plural = |n: i64, unit: &str| format!("{n} {unit}{} ago", if n == 1 { "" } else { "s" });
    match () {
        _ if mins < 1 => "just now".into(),
        _ if mins < 60 => format!("{mins} min ago"),
        _ if hours < 24 => format!("{hours}h ago"),
        _ if days < 2 => "yesterday".into(),
        _ if days < 7 => format!("{days} days ago"),
        _ if days < 30 => plural(days / 7, "week"),
        _ if days < 365 => plural(days / 30, "month"),
        _ => plural(days / 365, "year"),
    }
}

/// Compact: `now`, `5m`, `2h`, `1d`.
pub fn ago_short(ts: i64, now: i64) -> String {
    let secs = (now - ts).max(0) / 1000;
    match secs {
        0..=59 => "now".into(),
        60..=3599 => format!("{}m", secs / 60),
        3600..=86_399 => format!("{}h", secs / 3600),
        _ => format!("{}d", secs / 86_400),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-10-15 12:30:00 UTC
    const NOW: i64 = 1_792_067_400_000;

    #[test]
    fn civil_dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(day_of(NOW, 0)), (2026, 10, 15));
        assert_eq!(civil(11_016), (2000, 2, 29));
        assert_eq!(weekday(0), "Thu");
        assert_eq!(weekday(day_of(NOW, 0)), "Thu");
    }

    #[test]
    fn chat_times() {
        assert_eq!(msg_time(NOW - 3_600_000, NOW, 0), "11:30");
        assert_eq!(msg_time(NOW - 3_600_000, NOW, 3600), "12:30");
        assert_eq!(msg_time(NOW - DAY_MS, NOW, 0), "Yesterday");
        assert_eq!(msg_time(NOW - 3 * DAY_MS, NOW, 0), "Mon");
        assert_eq!(msg_time(NOW - 20 * DAY_MS, NOW, 0), "25 Sep");
        assert_eq!(snap_time(NOW - 60_000, NOW, 0), "Today 12:29");
        assert_eq!(msg_time(NOW + 5000, NOW, 0), "12:30");
    }

    #[test]
    fn relative_times() {
        assert_eq!(ago_long(NOW, NOW), "just now");
        assert_eq!(ago_long(NOW - 120_000, NOW), "2 min ago");
        assert_eq!(ago_long(NOW - 3 * 3_600_000, NOW), "3h ago");
        assert_eq!(ago_long(NOW - DAY_MS - 1000, NOW), "yesterday");
        assert_eq!(ago_long(NOW - 9 * DAY_MS, NOW), "1 week ago");
        assert_eq!(ago_long(NOW - 70 * DAY_MS, NOW), "2 months ago");
        assert_eq!(ago_short(NOW - 5 * 3_600_000, NOW), "5h");
        assert_eq!(ago_short(NOW - 2 * DAY_MS, NOW), "2d");
        assert_eq!(ago_short(NOW - 10_000, NOW), "now");
    }
}
