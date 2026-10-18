//! Elo with integer ratings and an `exp` built from plain IEEE operations only, so every
//! platform folds to the same leaderboard (libm `powf` may differ in the last bit).

/// Rating change factor (contract section 11.2).
pub const K: i32 = 24;
/// Rating of a player with no finished games.
pub const INITIAL: i32 = 1200;

/// `e^x` for moderate `|x|`: Taylor series on `x / 64`, then six squarings.
fn exp(x: f64) -> f64 {
    let y = x / 64.0;
    let mut term = 1.0;
    let mut sum = 1.0;
    for i in 1..=14 {
        term *= y / f64::from(i);
        sum += term;
    }
    (0..6).fold(sum, |a, _| a * a)
}

/// Expected score of a player rated `ra` against `rb`.
pub fn expected(ra: i32, rb: i32) -> f64 {
    let d = f64::from((rb - ra).clamp(-800, 800));
    1.0 / (1.0 + exp(d * std::f64::consts::LN_10 / 400.0))
}

/// New ratings after a game; `score_a` is 1, 0.5 or 0 for player A.
pub fn update(ra: i32, rb: i32, score_a: f64) -> (i32, i32) {
    let delta = (f64::from(K) * (score_a - expected(ra, rb))).round() as i32;
    (ra + delta, rb - delta)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_players_move_twelve_points() {
        assert_eq!(update(1200, 1200, 1.0), (1212, 1188));
        assert_eq!(update(1200, 1200, 0.0), (1188, 1212));
        assert_eq!(update(1200, 1200, 0.5), (1200, 1200));
    }

    #[test]
    fn upset_pays_more_and_is_zero_sum() {
        let (a, b) = update(1000, 1400, 1.0);
        assert_eq!((a - 1000), 1400 - b);
        assert!(a - 1000 > 12 && a - 1000 <= K);
        let (fa, _) = update(1400, 1000, 1.0);
        assert!(fa - 1400 < 12);
    }

    #[test]
    fn exp_matches_std() {
        for x in [-4.6, -1.0, 0.0, 0.7, 3.3, 4.6] {
            assert!((exp(x) - f64::exp(x)).abs() / f64::exp(x) < 1e-9);
        }
    }

    #[test]
    fn expected_is_symmetric() {
        assert!((expected(1300, 1100) + expected(1100, 1300) - 1.0).abs() < 1e-12);
        assert!((expected(1200, 1200) - 0.5).abs() < 1e-12);
    }
}
