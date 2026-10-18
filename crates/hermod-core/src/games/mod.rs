//! Arcade game rules (contract section 11.2). Every turn-based kind is a deterministic state
//! machine behind [`GameRules`]; the projection fold owns seats, move numbers and Elo, the
//! rules own legality. Real-time kinds have no rules here: only the host's `game.result` counts.

use serde_json::Value;

pub mod battleship;
pub mod checkers;
pub mod chess;
pub mod connect4;
pub mod elo;
pub mod go9;
pub mod tictactoe;
pub mod wordle;

/// Final verdict of a game; seats are 0 based.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Win(usize),
    Draw,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub verdict: Verdict,
    /// Short machine reason: `checkmate`, `stalemate`, `fifty_moves`, `threefold`, `four_in_row`,
    /// `no_moves`, `captured_all`, `score`, `cheating`, ...
    pub reason: String,
}

impl Outcome {
    pub fn win(seat: usize, reason: &str) -> Self {
        Outcome {
            verdict: Verdict::Win(seat),
            reason: reason.into(),
        }
    }
    pub fn draw(reason: &str) -> Self {
        Outcome {
            verdict: Verdict::Draw,
            reason: reason.into(),
        }
    }
}

/// One game instance. Seat 0 moves first. Moves are JSON (kind specific); `validate` and
/// `apply` take the seat the author occupies and must reject anything illegal without
/// changing state. Generic resign and draw offers are handled by the fold, not here.
pub trait GameRules: Send {
    /// Number of seats.
    fn seats(&self) -> usize;
    /// Seat expected to move now. `None` when finished, or when any seat may act (reveal phase).
    fn turn(&self) -> Option<usize>;
    /// Checks a move without applying it.
    fn validate(&self, seat: usize, mv: &Value) -> Result<(), String>;
    /// Validates, then applies. On `Err` the state is unchanged.
    fn apply(&mut self, seat: usize, mv: &Value) -> Result<(), String>;
    /// `Some` once decided. Commit-reveal kinds may revise it after it is first set (cheating
    /// found at reveal), so callers re-read it after every accepted move.
    fn outcome(&self) -> Option<Outcome>;
    /// Public state for the UI. Perfect-information kinds include `legal`, the legal moves of
    /// the seat to move, so the UI never needs a second copy of the rules.
    fn view(&self) -> Value;
}

/// Turn-based kinds with rules in this module.
pub const TURN_KINDS: [&str; 7] = [
    "chess",
    "checkers",
    "connect4",
    "tictactoe",
    "go9",
    "wordle_duel",
    "battleship",
];
/// Real-time kinds: played over ephemeral gossip, only `game.result` from the host is logged.
pub const REALTIME_KINDS: [&str; 3] = ["pictionary", "reaction", "trivia_rush"];
/// Most seats a real-time game accepts.
pub const REALTIME_MAX_SEATS: usize = 12;

pub fn is_realtime(kind: &str) -> bool {
    REALTIME_KINDS.contains(&kind)
}

/// Creates a turn-based game. `game_id` seeds anything that must be deterministic.
pub fn init(kind: &str, game_id: &str, options: &Value) -> Result<Box<dyn GameRules>, String> {
    match kind {
        "chess" => chess::init(game_id, options),
        "checkers" => checkers::init(game_id, options),
        "connect4" => connect4::init(game_id, options),
        "tictactoe" => tictactoe::init(game_id, options),
        "go9" => go9::init(game_id, options),
        "wordle_duel" => wordle::init(game_id, options),
        "battleship" => battleship::init(game_id, options),
        _ => Err(format!("unknown game kind {kind}")),
    }
}

const COMMIT_DOMAIN: &[u8] = b"hermod/arcade/commit/v1";

/// Hex BLAKE3 commitment over length-prefixed parts. Used for hidden words, battleship boards
/// and quiz answers; the UI gets it through the `arcade_commit` command so both sides agree.
pub fn commit_hash(parts: &[&str]) -> String {
    let mut h = blake3::Hasher::new();
    h.update(COMMIT_DOMAIN);
    for p in parts {
        h.update(&(p.len() as u64).to_le_bytes());
        h.update(p.as_bytes());
    }
    crate::ids::hex_encode(h.finalize().as_bytes())
}

/// Commitment to one quiz answer: `answer` is the option index, `salt` hides it from guessing.
pub fn quiz_commitment(quiz_id: &str, question: usize, answer: u32, salt: &str) -> String {
    commit_hash(&[
        "quiz",
        quiz_id,
        &question.to_string(),
        &answer.to_string(),
        salt,
    ])
}

const MAX_COMMIT_PARTS: usize = 8;
const MAX_COMMIT_PART_BYTES: usize = 512;

/// Helpers the UI needs but must not reimplement: commitments, the honest answer for a hidden
/// word or board (only its owner can compute it), and layout checks. One implementation, shared
/// with the fold that later verifies the reveal.
pub fn tool(op: &str, args: &Value) -> Result<Value, String> {
    let text = |k: &str| str_field(args, k).ok_or_else(|| format!("missing {k}"));
    match op {
        "commit" => {
            let parts: Vec<&str> = args
                .get("parts")
                .and_then(Value::as_array)
                .ok_or("missing parts")?
                .iter()
                .map(|v| v.as_str().ok_or("parts must be text"))
                .collect::<Result<_, _>>()?;
            if parts.is_empty()
                || parts.len() > MAX_COMMIT_PARTS
                || parts.iter().any(|p| p.len() > MAX_COMMIT_PART_BYTES)
            {
                return Err("that commitment is too large".into());
            }
            Ok(Value::String(commit_hash(&parts)))
        }
        "quiz_commit" => {
            let (id, salt) = (text("quiz_id")?, text("salt")?);
            let q = args
                .get("question")
                .and_then(Value::as_u64)
                .ok_or("missing question")?;
            let a = args
                .get("answer")
                .and_then(Value::as_u64)
                .ok_or("missing answer")?;
            Ok(Value::String(quiz_commitment(
                id, q as usize, a as u32, salt,
            )))
        }
        "feedback" => {
            let (word, guess) = (text("word")?, text("guess")?);
            let ok =
                |w: &str| w.len() == wordle::WORD_LEN && w.bytes().all(|b| b.is_ascii_lowercase());
            if !ok(word) || !ok(guess) {
                return Err("words are five letters a to z".into());
            }
            Ok(Value::String(wordle::feedback(word, guess)))
        }
        "layout" => Ok(Value::Bool(battleship::valid_layout(text("board")?))),
        "shot" => {
            let board = text("board")?;
            if !battleship::valid_layout(board) {
                return Err("that fleet layout is not legal".into());
            }
            let fired: Vec<usize> = args
                .get("shots")
                .and_then(Value::as_array)
                .ok_or("missing shots")?
                .iter()
                .map(|v| {
                    v.as_u64()
                        .filter(|&c| c < 100)
                        .map(|c| c as usize)
                        .ok_or("bad shot")
                })
                .collect::<Result<_, _>>()?;
            Ok(Value::String(
                battleship::honest_answer(board.as_bytes(), &fired).into(),
            ))
        }
        _ => Err(format!("unknown arcade helper {op}")),
    }
}

/// Replays `moves` (`{seat, move}`, as in the arcade view) on a fresh game and returns the legal
/// moves of the seat to move; empty when the game is over or the kind lists none.
pub fn legal_moves(
    kind: &str,
    game_id: &str,
    options: &Value,
    moves: &Value,
) -> Result<Value, String> {
    let mut game = init(kind, game_id, options)?;
    for m in moves.as_array().map_or(&[][..], Vec::as_slice) {
        let seat = m
            .get("seat")
            .and_then(Value::as_u64)
            .ok_or("bad move seat")? as usize;
        game.apply(seat, m.get("move").ok_or("bad move")?)?;
    }
    Ok(game
        .view()
        .get("legal")
        .cloned()
        .unwrap_or_else(|| Value::Array(vec![])))
}

/// Reads a string field of a JSON move.
pub fn str_field<'a>(mv: &'a Value, key: &str) -> Option<&'a str> {
    mv.get(key).and_then(Value::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn commit_is_length_prefixed() {
        assert_ne!(commit_hash(&["ab", "c"]), commit_hash(&["a", "bc"]));
        assert_eq!(commit_hash(&["x"]).len(), 64);
    }

    #[test]
    fn tools_answer_for_the_owner_only() {
        assert_eq!(
            tool("feedback", &json!({"word": "crane", "guess": "crane"})).unwrap(),
            "22222"
        );
        assert!(tool("feedback", &json!({"word": "cran", "guess": "crane"})).is_err());
        let mut b = vec![b'.'; 100];
        for (row, (id, size)) in [(b'a', 5usize), (b'b', 4), (b'c', 3), (b'd', 3), (b'e', 2)]
            .into_iter()
            .enumerate()
        {
            for c in 0..size {
                b[row * 10 + c] = id;
            }
        }
        let board = String::from_utf8(b).unwrap();
        assert_eq!(tool("layout", &json!({"board": board})).unwrap(), true);
        assert_eq!(
            tool("shot", &json!({"board": board, "shots": [99]})).unwrap(),
            "miss"
        );
        assert_eq!(
            tool("shot", &json!({"board": board, "shots": [40]})).unwrap(),
            "hit"
        );
        assert_eq!(
            tool("shot", &json!({"board": board, "shots": [40, 41]})).unwrap(),
            "sunk"
        );
        assert!(tool("shot", &json!({"board": "x", "shots": [1]})).is_err());
        assert!(tool("commit", &json!({"parts": []})).is_err());
        assert_eq!(
            tool("commit", &json!({"parts": ["a"]})).unwrap(),
            commit_hash(&["a"])
        );
        assert!(tool("nope", &json!({})).is_err());
    }

    #[test]
    fn unknown_kind_is_rejected() {
        assert!(init("nope", "g", &Value::Null).is_err());
    }
}

#[cfg(test)]
mod legal_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legal_moves_replays() {
        let start = legal_moves("chess", "g", &json!({}), &json!([])).unwrap();
        assert_eq!(start.as_array().unwrap().len(), 20);
        let after = legal_moves(
            "chess",
            "g",
            &json!({}),
            &json!([{"seat":0,"move":{"from":"e2","to":"e4"}}]),
        )
        .unwrap();
        assert_eq!(after.as_array().unwrap().len(), 20);
        assert!(
            legal_moves(
                "chess",
                "g",
                &json!({}),
                &json!([{"seat":1,"move":{"from":"e2","to":"e4"}}])
            )
            .is_err()
        );
    }
}
