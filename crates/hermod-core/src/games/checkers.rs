//! English draughts: 8x8, dark squares only, forced captures, complete multi-jumps, kings.
//!
//! Squares are `row * 8 + col`. Seat 0 starts on rows 0..=2 and moves toward row 7; seat 1
//! starts on rows 5..=7. Pieces: 1 man, 2 king, positive for seat 0, negative for seat 1.
//! Move `{"path": [from, land1, land2, ...]}`: one step, or every landing of a jump chain.
//! A chain must be played to its end; a man crowned mid-chain stops there.

use serde_json::{Value, json};

use super::{GameRules, Outcome};

/// Plies without a capture or man move after which the game is drawn.
const QUIET_PLY_LIMIT: u32 = 80;

#[derive(Debug, Clone)]
struct Checkers {
    board: [i8; 64],
    side: usize,
    quiet: u32,
    over: Option<Outcome>,
}

fn rc(sq: usize) -> (i32, i32) {
    ((sq / 8) as i32, (sq % 8) as i32)
}

fn at(r: i32, c: i32) -> Option<usize> {
    ((0..8).contains(&r) && (0..8).contains(&c)).then(|| (r * 8 + c) as usize)
}

fn sign(side: usize) -> i8 {
    if side == 0 { 1 } else { -1 }
}

impl Checkers {
    fn new() -> Self {
        let mut board = [0i8; 64];
        for r in 0..8 {
            for c in 0..8 {
                if (r + c) % 2 == 0 {
                    if r < 3 {
                        board[r * 8 + c] = 1;
                    } else if r > 4 {
                        board[r * 8 + c] = -1;
                    }
                }
            }
        }
        let mut g = Checkers {
            board,
            side: 0,
            quiet: 0,
            over: None,
        };
        g.settle();
        g
    }

    /// Row directions a piece may move or capture in.
    fn dirs(piece: i8) -> &'static [i32] {
        match (piece.abs(), piece > 0) {
            (2, _) => &[1, -1],
            (_, true) => &[1],
            _ => &[-1],
        }
    }

    fn crowning_row(side: usize) -> i32 {
        if side == 0 { 7 } else { 0 }
    }

    /// Every maximal jump chain starting at `from`.
    fn jumps_from(&self, from: usize, side: usize) -> Vec<Vec<usize>> {
        let mut out = Vec::new();
        let piece = self.board[from];
        let mut board = self.board;
        board[from] = 0;
        self.chain(&mut board, piece, from, side, vec![from], &mut out);
        out
    }

    fn chain(
        &self,
        board: &mut [i8; 64],
        piece: i8,
        cur: usize,
        side: usize,
        path: Vec<usize>,
        out: &mut Vec<Vec<usize>>,
    ) {
        let (r, c) = rc(cur);
        let mut extended = false;
        for &dr in Self::dirs(piece) {
            for dc in [-1, 1] {
                let (Some(over), Some(land)) = (at(r + dr, c + dc), at(r + 2 * dr, c + 2 * dc))
                else {
                    continue;
                };
                if board[over] * sign(side) >= 0 || board[land] != 0 {
                    continue;
                }
                extended = true;
                let taken = board[over];
                board[over] = 0; // a jumped piece cannot be jumped twice
                let mut next = path.clone();
                next.push(land);
                let crowns = piece.abs() == 1 && rc(land).0 == Self::crowning_row(side);
                if crowns {
                    out.push(next);
                } else {
                    self.chain(board, piece, land, side, next, out);
                }
                board[over] = taken;
            }
        }
        if !extended && path.len() > 1 {
            out.push(path);
        }
    }

    fn steps_from(&self, from: usize) -> Vec<Vec<usize>> {
        let (r, c) = rc(from);
        let mut out = Vec::new();
        for &dr in Self::dirs(self.board[from]) {
            for dc in [-1, 1] {
                if let Some(to) = at(r + dr, c + dc)
                    && self.board[to] == 0
                {
                    out.push(vec![from, to]);
                }
            }
        }
        out
    }

    fn legal_paths(&self) -> Vec<Vec<usize>> {
        let s = sign(self.side);
        let mine: Vec<usize> = (0..64).filter(|&i| self.board[i] * s > 0).collect();
        let jumps: Vec<Vec<usize>> = mine
            .iter()
            .flat_map(|&i| self.jumps_from(i, self.side))
            .collect();
        if !jumps.is_empty() {
            return jumps;
        }
        mine.iter().flat_map(|&i| self.steps_from(i)).collect()
    }

    fn settle(&mut self) {
        self.over = if self.legal_paths().is_empty() {
            Some(Outcome::win(1 - self.side, "no_moves"))
        } else if self.quiet >= QUIET_PLY_LIMIT {
            Some(Outcome::draw("no_progress"))
        } else {
            None
        };
    }

    fn parse(mv: &Value) -> Result<Vec<usize>, String> {
        let arr = mv
            .get("path")
            .and_then(Value::as_array)
            .ok_or("move needs a path")?;
        if arr.len() < 2 || arr.len() > 16 {
            return Err("bad path length".into());
        }
        arr.iter()
            .map(|v| {
                v.as_u64()
                    .filter(|&n| n < 64)
                    .map(|n| n as usize)
                    .ok_or_else(|| "bad square".to_string())
            })
            .collect()
    }
}

impl GameRules for Checkers {
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
        let path = Self::parse(mv)?;
        if self.legal_paths().contains(&path) {
            Ok(())
        } else {
            Err("illegal move".into())
        }
    }

    fn apply(&mut self, seat: usize, mv: &Value) -> Result<(), String> {
        self.validate(seat, mv)?;
        let path = Self::parse(mv)?;
        let piece = self.board[path[0]];
        let capture = rc(path[1]).0.abs_diff(rc(path[0]).0) == 2;
        self.board[path[0]] = 0;
        for w in path.windows(2) {
            let ((r0, c0), (r1, c1)) = (rc(w[0]), rc(w[1]));
            if r0.abs_diff(r1) == 2 {
                self.board[((r0 + r1) / 2 * 8 + (c0 + c1) / 2) as usize] = 0;
            }
        }
        let last = *path.last().expect("path has two squares");
        let crowned = piece.abs() == 1 && rc(last).0 == Self::crowning_row(seat);
        self.board[last] = if crowned { 2 * sign(seat) } else { piece };
        self.quiet = if capture || piece.abs() == 1 {
            0
        } else {
            self.quiet + 1
        };
        self.side = 1 - seat;
        self.settle();
        Ok(())
    }

    fn outcome(&self) -> Option<Outcome> {
        self.over.clone()
    }

    fn view(&self) -> Value {
        let legal = if self.over.is_none() {
            self.legal_paths()
        } else {
            Vec::new()
        };
        json!({ "board": self.board.to_vec(), "legal": legal })
    }
}

pub fn init(_game_id: &str, _options: &Value) -> Result<Box<dyn GameRules>, String> {
    Ok(Box::new(Checkers::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty(side: usize) -> Checkers {
        Checkers {
            board: [0; 64],
            side,
            quiet: 0,
            over: None,
        }
    }

    fn mv(path: &[usize]) -> Value {
        json!({ "path": path })
    }

    #[test]
    fn opening_has_seven_moves() {
        let g = Checkers::new();
        assert_eq!(g.legal_paths().len(), 7);
        assert!(g.legal_paths().iter().all(|p| p.len() == 2));
    }

    #[test]
    fn capture_is_forced() {
        let mut g = empty(0);
        g.board[18] = 1; // c3
        g.board[27] = -1; // d4 can be jumped to e5 (36)
        g.board[2] = 1; // a free piece that could otherwise step
        g.board[63] = -1;
        assert!(
            g.apply(0, &mv(&[2, 11])).is_err(),
            "step refused while a jump exists"
        );
        g.apply(0, &mv(&[18, 36])).unwrap();
        assert_eq!(g.board[27], 0);
        assert_eq!(g.board[36], 1);
    }

    #[test]
    fn multi_jump_must_be_completed() {
        let mut g = empty(0);
        g.board[0] = 1;
        g.board[9] = -1;
        g.board[27] = -1;
        g.board[63] = -1;
        assert!(g.apply(0, &mv(&[0, 18])).is_err(), "partial chain refused");
        g.apply(0, &mv(&[0, 18, 36])).unwrap();
        assert_eq!((g.board[9], g.board[27], g.board[36]), (0, 0, 1));
    }

    #[test]
    fn man_crowned_mid_chain_stops_and_kings_move_back() {
        let mut g = empty(0);
        g.board[45] = 1; // row5 col5
        g.board[54] = -1; // row6 col6 -> land row7 col7 (63) crowns
        g.board[0] = -1;
        g.apply(0, &mv(&[45, 63])).unwrap();
        assert_eq!(g.board[63], 2, "crowned");
        // a king may now step backward
        g.side = 0;
        g.board[0] = -1;
        assert!(g.legal_paths().iter().any(|p| p[0] == 63 && rc(p[1]).0 < 7));
    }

    #[test]
    fn man_cannot_capture_backward_and_no_moves_loses() {
        let mut g = empty(0);
        g.board[27] = 1;
        g.board[18] = -1; // behind the man
        g.board[9] = -1; // landing square occupied would also block
        assert!(g.jumps_from(27, 0).is_empty());
        let mut g = empty(1);
        g.board[63] = -1;
        g.board[54] = 1;
        g.board[45] = 1;
        g.settle();
        assert_eq!(g.outcome(), Some(Outcome::win(0, "no_moves")));
    }

    #[test]
    fn out_of_turn_and_garbage_rejected() {
        let mut g = Checkers::new();
        assert!(g.apply(1, &mv(&[40, 33])).is_err());
        assert!(g.apply(0, &json!({})).is_err());
        assert!(g.apply(0, &mv(&[99, 1])).is_err());
    }
}
