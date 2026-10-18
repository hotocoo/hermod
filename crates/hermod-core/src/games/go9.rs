//! Go on 9x9: captures, suicide forbidden, positional superko, two passes end the game,
//! area scoring with komi. Seat 0 is black and moves first.
//! Move `{"at": 0..80}` (row * 9 + col) or `{"pass": true}`; options `{"komi": 7.5}`.

use std::collections::BTreeSet;

use serde_json::{Value, json};

use super::{GameRules, Outcome};

const N: usize = 9;
const DEFAULT_KOMI: f64 = 7.5;
const MAX_KOMI: f64 = 20.0;

#[derive(Debug, Clone)]
struct Go {
    /// 0 empty, 1 black, 2 white.
    board: [u8; N * N],
    side: usize,
    passes: u8,
    komi: f64,
    seen: BTreeSet<Vec<u8>>,
    captures: [u32; 2],
    last: Option<usize>,
    over: Option<Outcome>,
}

fn neighbours(i: usize) -> impl Iterator<Item = usize> {
    let (r, c) = (i / N, i % N);
    [
        (r > 0).then(|| i - N),
        (r + 1 < N).then(|| i + N),
        (c > 0).then(|| i - 1),
        (c + 1 < N).then(|| i + 1),
    ]
    .into_iter()
    .flatten()
}

/// Connected stones of the same colour as `start`, and whether the group has a liberty.
fn group(board: &[u8; N * N], start: usize) -> (Vec<usize>, bool) {
    let color = board[start];
    let mut seen = vec![start];
    let mut free = false;
    let mut i = 0;
    while i < seen.len() {
        for n in neighbours(seen[i]) {
            if board[n] == 0 {
                free = true;
            } else if board[n] == color && !seen.contains(&n) {
                seen.push(n);
            }
        }
        i += 1;
    }
    (seen, free)
}

enum Act {
    Pass,
    At(usize),
}

fn parse(mv: &Value) -> Result<Act, String> {
    if mv.get("pass").and_then(Value::as_bool) == Some(true) {
        return Ok(Act::Pass);
    }
    let at = mv
        .get("at")
        .and_then(Value::as_u64)
        .ok_or("move needs at or pass")?;
    (at < (N * N) as u64)
        .then_some(Act::At(at as usize))
        .ok_or_else(|| "point out of range".into())
}

impl Go {
    /// Board after playing `at` for `side`, or why it is illegal.
    fn try_place(&self, side: usize, at: usize) -> Result<([u8; N * N], u32), String> {
        if self.board[at] != 0 {
            return Err("point taken".into());
        }
        let me = side as u8 + 1;
        let mut b = self.board;
        b[at] = me;
        let mut taken = 0;
        for n in neighbours(at) {
            if b[n] == 3 - me {
                let (g, free) = group(&b, n);
                if !free {
                    for s in g {
                        b[s] = 0;
                        taken += 1;
                    }
                }
            }
        }
        if !group(&b, at).1 {
            return Err("suicide".into());
        }
        if self.seen.contains(b.as_slice()) {
            return Err("ko".into());
        }
        Ok((b, taken))
    }

    fn score(&self) -> [f64; 2] {
        let mut pts = [0.0, self.komi];
        let mut seen = [false; N * N];
        for i in 0..N * N {
            match self.board[i] {
                1 => pts[0] += 1.0,
                2 => pts[1] += 1.0,
                _ if !seen[i] => {
                    let mut region = vec![i];
                    seen[i] = true;
                    let mut touches = [false; 2];
                    let mut k = 0;
                    while k < region.len() {
                        for n in neighbours(region[k]) {
                            match self.board[n] {
                                0 if !seen[n] => {
                                    seen[n] = true;
                                    region.push(n);
                                }
                                1 => touches[0] = true,
                                2 => touches[1] = true,
                                _ => {}
                            }
                        }
                        k += 1;
                    }
                    if touches[0] != touches[1] {
                        pts[usize::from(touches[1])] += region.len() as f64;
                    }
                }
                _ => {}
            }
        }
        pts
    }

    fn legal_points(&self) -> Vec<usize> {
        (0..N * N)
            .filter(|&i| self.try_place(self.side, i).is_ok())
            .collect()
    }
}

impl GameRules for Go {
    fn seats(&self) -> usize {
        2
    }

    fn turn(&self) -> Option<usize> {
        self.over.is_none().then_some(self.side)
    }

    fn validate(&self, seat: usize, mv: &Value) -> Result<(), String> {
        if self.over.is_some() {
            return Err("game over".into());
        }
        if seat != self.side {
            return Err("not your turn".into());
        }
        match parse(mv)? {
            Act::Pass => Ok(()),
            Act::At(i) => self.try_place(seat, i).map(|_| ()),
        }
    }

    fn apply(&mut self, seat: usize, mv: &Value) -> Result<(), String> {
        self.validate(seat, mv)?;
        match parse(mv)? {
            Act::Pass => {
                self.passes += 1;
                self.last = None;
                if self.passes >= 2 {
                    let [b, w] = self.score();
                    self.over = Some(if b > w {
                        Outcome::win(0, "score")
                    } else if w > b {
                        Outcome::win(1, "score")
                    } else {
                        Outcome::draw("score")
                    });
                }
            }
            Act::At(i) => {
                let (b, taken) = self.try_place(seat, i)?;
                self.board = b;
                self.captures[seat] += taken;
                self.passes = 0;
                self.last = Some(i);
                self.seen.insert(b.to_vec());
            }
        }
        self.side = 1 - seat;
        Ok(())
    }

    fn outcome(&self) -> Option<Outcome> {
        self.over.clone()
    }

    fn view(&self) -> Value {
        let legal = if self.over.is_none() {
            self.legal_points()
        } else {
            Vec::new()
        };
        let [b, w] = self.score();
        json!({
            "board": self.board.to_vec(),
            "legal": legal,
            "passes": self.passes,
            "captures": self.captures,
            "last": self.last,
            "score": [b, w],
            "komi": self.komi,
        })
    }
}

pub fn init(_game_id: &str, options: &Value) -> Result<Box<dyn GameRules>, String> {
    let komi = match options.get("komi") {
        None | Some(Value::Null) => DEFAULT_KOMI,
        Some(v) => v
            .as_f64()
            .filter(|k| (0.0..=MAX_KOMI).contains(k))
            .ok_or("komi out of range")?,
    };
    let board = [0u8; N * N];
    Ok(Box::new(Go {
        board,
        side: 0,
        passes: 0,
        komi,
        seen: BTreeSet::from([board.to_vec()]),
        captures: [0; 2],
        last: None,
        over: None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game() -> Go {
        Go {
            board: [0; N * N],
            side: 0,
            passes: 0,
            komi: DEFAULT_KOMI,
            seen: BTreeSet::new(),
            captures: [0; 2],
            last: None,
            over: None,
        }
    }

    fn put(g: &mut Go, seat: usize, r: usize, c: usize) -> Result<(), String> {
        g.apply(seat, &json!({ "at": r * N + c }))
    }

    #[test]
    fn capture_removes_stones_and_frees_points() {
        let mut g = game();
        // white (0,1) is surrounded by black (0,2) and (1,1); black (0,0) captures it
        put(&mut g, 0, 0, 2).unwrap();
        put(&mut g, 1, 0, 1).unwrap();
        put(&mut g, 0, 1, 1).unwrap();
        put(&mut g, 1, 8, 8).unwrap();
        put(&mut g, 0, 0, 0).unwrap();
        assert_eq!(g.board[1], 0, "white stone captured");
        assert_eq!(g.captures[0], 1);
    }

    #[test]
    fn suicide_is_illegal_unless_it_captures() {
        let mut g = game();
        for (s, r, c) in [(0, 0, 1), (1, 8, 8), (0, 1, 0)] {
            put(&mut g, s, r, c).unwrap();
        }
        assert_eq!(put(&mut g, 1, 0, 0), Err("suicide".into()));
        // capturing move into a spot with no liberties is allowed
        let mut g = game();
        g.board[1] = 1;
        g.board[9] = 1;
        g.board[2] = 2;
        g.board[11] = 2;
        g.board[18] = 2;
        g.board[0] = 0;
        g.side = 1;
        assert_eq!(g.try_place(1, 0), Err("suicide".into()));
        g.board[10] = 1;
        g.board[19] = 2;
        g.board[3] = 2;
        g.board[12] = 2;
        // black group {1, 9, 10} now has the single liberty 0: white playing there captures it
        g.board[0] = 0;
        let (b, taken) = g.try_place(1, 0).unwrap();
        assert_eq!(taken, 3);
        assert_eq!(b[0], 2);
    }

    #[test]
    fn ko_blocks_immediate_recapture() {
        let mut g = game();
        g.seen.insert(g.board.to_vec());
        // classic ko shape around points (1,1) and (1,2)
        let blacks = [(0, 1), (1, 0), (2, 1)];
        let whites = [(0, 2), (1, 3), (2, 2)];
        for &(r, c) in &blacks {
            g.board[r * N + c] = 1;
        }
        for &(r, c) in &whites {
            g.board[r * N + c] = 2;
        }
        g.board[N + 2] = 1; // black stone in the ko point (1,2), white to capture at (1,1)
        g.seen.insert(g.board.to_vec());
        g.side = 1;
        put(&mut g, 1, 1, 1).unwrap();
        assert_eq!(g.board[N + 2], 0);
        g.side = 0;
        assert_eq!(put(&mut g, 0, 1, 2), Err("ko".into()));
        // after a tenuki exchange the whole board differs, so the recapture is legal again
        put(&mut g, 0, 8, 8).unwrap();
        put(&mut g, 1, 8, 0).unwrap();
        assert!(put(&mut g, 0, 1, 2).is_ok());
    }

    #[test]
    fn two_passes_score_area_with_komi() {
        let mut g = game();
        // black wall on column 4 with the left side as black territory
        for r in 0..N {
            g.board[r * N + 4] = 1;
        }
        g.apply(0, &json!({ "pass": true })).unwrap();
        assert!(g.outcome().is_none());
        g.apply(1, &json!({ "pass": true })).unwrap();
        // black: 9 stones + 36 territory (right side touches only black as well) = 81 vs komi 7.5
        assert_eq!(g.outcome(), Some(Outcome::win(0, "score")));
        assert_eq!(g.score(), [81.0, 7.5]);
        let mut g = game();
        g.board[40] = 2;
        g.apply(0, &json!({ "pass": true })).unwrap();
        g.apply(1, &json!({ "pass": true })).unwrap();
        assert_eq!(g.outcome(), Some(Outcome::win(1, "score")));
    }

    #[test]
    fn neutral_regions_score_for_nobody() {
        let mut g = game();
        g.board[0] = 1;
        g.board[80] = 2;
        assert_eq!(g.score(), [1.0, 1.0 + DEFAULT_KOMI]);
    }

    #[test]
    fn bad_moves_rejected() {
        let mut g = game();
        assert!(g.apply(1, &json!({ "at": 3 })).is_err());
        assert!(g.apply(0, &json!({ "at": 81 })).is_err());
        assert!(g.apply(0, &json!({})).is_err());
        put(&mut g, 0, 4, 4).unwrap();
        assert_eq!(put(&mut g, 1, 4, 4), Err("point taken".into()));
        assert!(init("g", &json!({ "komi": 99 })).is_err());
    }
}
