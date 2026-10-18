//! Battleship with commit-reveal boards. Each player commits to a hash of their 10x10 layout
//! (plus a salt), then they alternate shots. The board's owner answers every shot
//! (`miss`, `hit` or `sunk`); nobody can check that until the owner reveals layout and salt.
//! At reveal the fold checks the layout is a legal fleet, then replays every shot against it:
//! a layout that breaks the fleet rules or one false answer forfeits the game.
//!
//! Layout string: 100 chars, row-major; `.` water and `a`..`e` ship cells (sizes 5,4,3,3,2).
//! Moves: `{"commit": hex}`, `{"shot": 0..99}`, `{"res": "miss|hit|sunk"}`,
//! `{"reveal": {"board": "...", "salt": "..."}}`.

use serde_json::{Value, json};

use super::{GameRules, Outcome, commit_hash, str_field};

const SIDE: usize = 10;
const CELLS: usize = SIDE * SIDE;
const FLEET: [(u8, usize); 5] = [(b'a', 5), (b'b', 4), (b'c', 3), (b'd', 3), (b'e', 2)];
const FLEET_CELLS: usize = 17;
const MAX_SALT: usize = 64;
const DOMAIN: &str = "battleship";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Commit,
    Play,
    Reveal,
    Done,
}

#[derive(Debug, Clone)]
struct Shot {
    cell: usize,
    /// Owner's answer: `miss`, `hit`, `sunk`.
    res: Option<String>,
}

#[derive(Debug, Clone)]
struct Battleship {
    phase: Phase,
    commits: [Option<String>; 2],
    /// `shots[s]` are shots fired by seat `s` at the opponent's board.
    shots: [Vec<Shot>; 2],
    revealed: [Option<String>; 2],
    over: Option<Outcome>,
}

pub fn commitment(board: &str, salt: &str) -> String {
    commit_hash(&[DOMAIN, board, salt])
}

/// True when `board` is a legal fleet: every ship straight, contiguous, right size, no extras.
pub fn valid_layout(board: &str) -> bool {
    let b = board.as_bytes();
    if b.len() != CELLS {
        return false;
    }
    FLEET.iter().all(|&(id, size)| {
        let cells: Vec<usize> = (0..CELLS).filter(|&i| b[i] == id).collect();
        if cells.len() != size {
            return false;
        }
        let horizontal =
            cells.windows(2).all(|w| w[1] == w[0] + 1) && cells[0] / SIDE == cells[size - 1] / SIDE;
        let vertical = cells.windows(2).all(|w| w[1] == w[0] + SIDE);
        horizontal || vertical
    }) && b
        .iter()
        .all(|&c| c == b'.' || FLEET.iter().any(|&(id, _)| id == c))
}

/// The answer an honest owner gives to the last of `fired` (cells in order) against `board`.
pub fn honest_answer(board: &[u8], fired: &[usize]) -> &'static str {
    let Some(&last) = fired.last() else {
        return "miss";
    };
    let ship = board[last];
    if ship == b'.' {
        return "miss";
    }
    let all_hit = (0..CELLS)
        .filter(|&i| board[i] == ship)
        .all(|i| fired.contains(&i));
    if all_hit { "sunk" } else { "hit" }
}

fn honest(board: &[u8], shots: &[Shot], k: usize) -> &'static str {
    let fired: Vec<usize> = shots[..=k].iter().map(|s| s.cell).collect();
    honest_answer(board, &fired)
}

impl Battleship {
    fn answered(&self, s: usize) -> usize {
        self.shots[s].iter().filter(|x| x.res.is_some()).count()
    }

    fn claimed_hits(&self, s: usize) -> usize {
        self.shots[s]
            .iter()
            .filter(|x| matches!(x.res.as_deref(), Some("hit" | "sunk")))
            .count()
    }

    fn actor(&self) -> usize {
        let seat = if self.shots[0].len() == self.shots[1].len() {
            0
        } else {
            1
        };
        if self.shots[seat].last().is_some_and(|x| x.res.is_none()) {
            1 - seat
        } else {
            seat
        }
    }

    fn play_over(&self) -> bool {
        let (h0, h1) = (
            self.claimed_hits(0) >= FLEET_CELLS,
            self.claimed_hits(1) >= FLEET_CELLS,
        );
        h1 || (h0 && self.answered(1) >= self.answered(0))
    }

    fn verdict(&self) -> Outcome {
        let (h0, h1) = (
            self.claimed_hits(0) >= FLEET_CELLS,
            self.claimed_hits(1) >= FLEET_CELLS,
        );
        match (h0, h1) {
            (true, false) => Outcome::win(0, "fleet_sunk"),
            (false, true) => Outcome::win(1, "fleet_sunk"),
            _ => Outcome::draw("fleet_sunk"),
        }
    }

    /// Reveal by `seat` is honest when its layout is legal and every answer it gave matches.
    fn honest_reveal(&self, seat: usize, board: &str) -> bool {
        if !valid_layout(board) {
            return false;
        }
        let shots = &self.shots[1 - seat];
        shots
            .iter()
            .enumerate()
            .all(|(k, s)| s.res.as_deref() == Some(honest(board.as_bytes(), shots, k)))
    }
}

impl GameRules for Battleship {
    fn seats(&self) -> usize {
        2
    }

    fn turn(&self) -> Option<usize> {
        (self.phase == Phase::Play).then(|| self.actor())
    }

    fn validate(&self, seat: usize, mv: &Value) -> Result<(), String> {
        match self.phase {
            Phase::Done => Err("game over".into()),
            Phase::Commit => {
                let h = str_field(mv, "commit").ok_or("commit your fleet first")?;
                if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("bad commitment".into());
                }
                if self.commits[seat].is_some() {
                    return Err("already committed".into());
                }
                Ok(())
            }
            Phase::Play => {
                if seat != self.actor() {
                    return Err("not your turn".into());
                }
                if self.shots[1 - seat].last().is_some_and(|x| x.res.is_none()) {
                    let r = str_field(mv, "res").ok_or("answer the shot")?;
                    return matches!(r, "miss" | "hit" | "sunk")
                        .then_some(())
                        .ok_or_else(|| "bad answer".into());
                }
                let cell = mv
                    .get("shot")
                    .and_then(Value::as_u64)
                    .ok_or("fire a shot")?;
                if cell >= CELLS as u64 {
                    return Err("shot off the board".into());
                }
                if self.shots[seat].iter().any(|x| x.cell == cell as usize) {
                    return Err("already fired there".into());
                }
                Ok(())
            }
            Phase::Reveal => {
                if self.revealed[seat].is_some() {
                    return Err("already revealed".into());
                }
                let r = mv.get("reveal").ok_or("reveal your fleet")?;
                let (b, salt) = (
                    str_field(r, "board").unwrap_or(""),
                    str_field(r, "salt").unwrap_or(""),
                );
                if b.len() != CELLS || salt.len() > MAX_SALT {
                    return Err("bad reveal".into());
                }
                if self.commits[seat].as_deref() != Some(commitment(b, salt).as_str()) {
                    return Err("reveal does not match the commitment".into());
                }
                Ok(())
            }
        }
    }

    fn apply(&mut self, seat: usize, mv: &Value) -> Result<(), String> {
        self.validate(seat, mv)?;
        match self.phase {
            Phase::Commit => {
                self.commits[seat] = str_field(mv, "commit").map(str::to_string);
                if self.commits.iter().all(Option::is_some) {
                    self.phase = Phase::Play;
                }
            }
            Phase::Play => {
                if let Some(cell) = mv.get("shot").and_then(Value::as_u64) {
                    self.shots[seat].push(Shot {
                        cell: cell as usize,
                        res: None,
                    });
                } else if let (Some(r), Some(s)) =
                    (str_field(mv, "res"), self.shots[1 - seat].last_mut())
                {
                    s.res = Some(r.into());
                }
                if self.play_over() {
                    self.phase = Phase::Reveal;
                }
            }
            Phase::Reveal => {
                let board = str_field(&mv["reveal"], "board").unwrap_or("").to_string();
                if !self.honest_reveal(seat, &board) {
                    self.over = Some(Outcome::win(1 - seat, "cheating"));
                    self.phase = Phase::Done;
                    return Ok(());
                }
                self.revealed[seat] = Some(board);
                if self.revealed.iter().all(Option::is_some) {
                    self.over = Some(self.verdict());
                    self.phase = Phase::Done;
                }
            }
            Phase::Done => {}
        }
        Ok(())
    }

    fn outcome(&self) -> Option<Outcome> {
        self.over.clone()
    }

    fn view(&self) -> Value {
        let rows = |s: usize| -> Vec<Value> {
            self.shots[s]
                .iter()
                .map(|x| json!({ "cell": x.cell, "res": x.res }))
                .collect()
        };
        json!({
            "phase": match self.phase { Phase::Commit => "commit", Phase::Play => "play", Phase::Reveal => "reveal", Phase::Done => "done" },
            "committed": [self.commits[0].is_some(), self.commits[1].is_some()],
            "shots": [rows(0), rows(1)],
            "revealed": self.revealed,
            "side": SIDE,
            "actor": self.turn(),
        })
    }
}

pub fn init(_game_id: &str, _options: &Value) -> Result<Box<dyn GameRules>, String> {
    Ok(Box::new(Battleship {
        phase: Phase::Commit,
        commits: [None, None],
        shots: [Vec::new(), Vec::new()],
        revealed: [None, None],
        over: None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ships stacked in the first five rows: a row 0, b row 1, c row 2, d row 3, e row 4.
    fn fleet() -> String {
        let mut b = vec![b'.'; CELLS];
        for (row, &(id, size)) in FLEET.iter().enumerate() {
            for c in 0..size {
                b[row * SIDE + c] = id;
            }
        }
        String::from_utf8(b).unwrap()
    }

    /// A second fleet: the same ships, one column over, so cells differ at the edges.
    fn fleet2() -> String {
        let mut b = vec![b'.'; CELLS];
        for (row, &(id, size)) in FLEET.iter().enumerate() {
            for c in 0..size {
                b[(row + 5) * SIDE + 5 + c] = id;
            }
        }
        String::from_utf8(b).unwrap()
    }

    struct Table {
        g: Battleship,
        boards: [String; 2],
    }

    fn table() -> Table {
        let mut t = Table {
            g: Battleship {
                phase: Phase::Commit,
                commits: [None, None],
                shots: [Vec::new(), Vec::new()],
                revealed: [None, None],
                over: None,
            },
            boards: [fleet(), fleet2()],
        };
        for s in 0..2 {
            let h = commitment(&t.boards[s], "salt");
            t.g.apply(s, &json!({ "commit": h })).unwrap();
        }
        t
    }

    fn answer(t: &Table, owner: usize, k: usize) -> &'static str {
        honest(t.boards[owner].as_bytes(), &t.g.shots[1 - owner], k)
    }

    fn fire(t: &mut Table, s: usize, cell: usize, lie: Option<&str>) {
        t.g.apply(s, &json!({ "shot": cell })).unwrap();
        let k = t.g.shots[s].len() - 1;
        let res = lie.unwrap_or_else(|| answer(t, 1 - s, k));
        t.g.apply(1 - s, &json!({ "res": res })).unwrap();
    }

    fn reveal(t: &mut Table, s: usize) {
        let mv = json!({ "reveal": { "board": t.boards[s], "salt": "salt" } });
        t.g.apply(s, &mv).unwrap();
    }

    #[test]
    fn layouts_are_validated() {
        assert!(valid_layout(&fleet()));
        let mut bad = fleet().into_bytes();
        bad[0] = b'.'; // ship a loses a cell
        assert!(!valid_layout(std::str::from_utf8(&bad).unwrap()));
        let mut bent = vec![b'.'; CELLS];
        for (id, cells) in [(b'a', [0, 1, 2, 3, 14]), (b'b', [10, 11, 12, 13, 99])] {
            for c in cells {
                bent[c] = id;
            }
        }
        assert!(!valid_layout(std::str::from_utf8(&bent).unwrap()));
        assert!(!valid_layout("short"));
    }

    #[test]
    fn full_honest_game_sinks_a_fleet() {
        let mut t = table();
        // seat 0 sinks seat 1's fleet (rows 5..9, cols 5..), seat 1 shoots water
        let targets: Vec<usize> = (0..CELLS)
            .filter(|&i| t.boards[1].as_bytes()[i] != b'.')
            .collect();
        assert_eq!(targets.len(), FLEET_CELLS);
        for (k, &cell) in targets.iter().enumerate() {
            fire(&mut t, 0, cell, None);
            if k + 1 < targets.len() {
                fire(&mut t, 1, 99 - k, None);
            }
        }
        assert_eq!(t.g.phase, Phase::Play, "seat 1 gets its last shot");
        fire(&mut t, 1, 50 - 1, None);
        assert_eq!(t.g.phase, Phase::Reveal);
        reveal(&mut t, 1);
        reveal(&mut t, 0);
        assert_eq!(t.g.outcome(), Some(Outcome::win(0, "fleet_sunk")));
    }

    #[test]
    fn a_false_answer_forfeits_at_reveal() {
        let mut t = table();
        let hit = (0..CELLS)
            .find(|&i| t.boards[1].as_bytes()[i] != b'.')
            .unwrap();
        fire(&mut t, 0, hit, Some("miss")); // seat 1 lies about a hit
        t.g.phase = Phase::Reveal;
        reveal(&mut t, 0);
        let mv = json!({ "reveal": { "board": t.boards[1], "salt": "salt" } });
        t.g.apply(1, &mv).unwrap();
        assert_eq!(t.g.outcome(), Some(Outcome::win(0, "cheating")));
    }

    #[test]
    fn illegal_fleet_committed_forfeits_when_revealed() {
        let mut g = Battleship {
            phase: Phase::Commit,
            commits: [None, None],
            shots: [Vec::new(), Vec::new()],
            revealed: [None, None],
            over: None,
        };
        let cheat = ".".repeat(CELLS); // an empty sea: no ships at all
        g.apply(0, &json!({ "commit": commitment(&cheat, "x") }))
            .unwrap();
        g.apply(1, &json!({ "commit": commitment(&fleet(), "x") }))
            .unwrap();
        g.phase = Phase::Reveal;
        g.apply(0, &json!({ "reveal": { "board": cheat, "salt": "x" } }))
            .unwrap();
        assert_eq!(g.outcome(), Some(Outcome::win(1, "cheating")));
    }

    #[test]
    fn mismatched_reveal_and_bad_moves_are_rejected() {
        let mut t = table();
        assert!(t.g.apply(1, &json!({ "shot": 3 })).is_err(), "seat 0 first");
        assert!(t.g.apply(0, &json!({ "shot": 100 })).is_err());
        t.g.apply(0, &json!({ "shot": 3 })).unwrap();
        assert!(
            t.g.apply(0, &json!({ "shot": 4 })).is_err(),
            "must wait for the answer"
        );
        assert!(t.g.apply(1, &json!({ "res": "boom" })).is_err());
        t.g.phase = Phase::Reveal;
        let other = fleet2();
        assert!(
            t.g.apply(0, &json!({ "reveal": { "board": other, "salt": "salt" } }))
                .is_err()
        );
        assert!(
            t.g.apply(
                0,
                &json!({ "reveal": { "board": fleet(), "salt": "pepper" } })
            )
            .is_err()
        );
        assert!(t.g.revealed[0].is_none());
    }
}
