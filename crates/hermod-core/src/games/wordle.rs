//! Wordle duel with commit-reveal. Each player commits to a secret five letter word by hash,
//! then they alternate guessing the opponent's word. The word's owner answers every guess
//! with feedback (`0` absent, `1` elsewhere, `2` in place); nobody else can check it until the
//! owner reveals word and salt at the end. The fold recomputes every feedback from the
//! revealed word: a wrong one, or a word that does not match the commitment's layout, loses
//! the game by forfeit.
//!
//! Moves: `{"commit": hex}`, `{"guess": "crane"}`, `{"fb": "01201"}`,
//! `{"reveal": {"word": "...", "salt": "..."}}`.

use serde_json::{Value, json};

use super::{GameRules, Outcome, commit_hash, str_field};

pub const WORD_LEN: usize = 5;
const MAX_GUESSES: usize = 6;
const MAX_SALT: usize = 64;
const DOMAIN: &str = "wordle";
const SOLVED: &str = "22222";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Commit,
    Play,
    Reveal,
    Done,
}

#[derive(Debug, Clone, Default)]
struct Round {
    word: String,
    /// Feedback the target's owner claimed; `None` while unanswered.
    fb: Option<String>,
}

#[derive(Debug, Clone)]
struct Wordle {
    phase: Phase,
    commits: [Option<String>; 2],
    /// `guesses[s]` are the guesses seat `s` made at the opponent's word.
    guesses: [Vec<Round>; 2],
    revealed: [Option<String>; 2],
    over: Option<Outcome>,
}

/// Standard wordle feedback, duplicate letters handled left to right.
pub fn feedback(secret: &str, guess: &str) -> String {
    let (s, g): (Vec<u8>, Vec<u8>) = (secret.bytes().collect(), guess.bytes().collect());
    let mut out = vec![b'0'; g.len()];
    let mut left = [0u8; 26];
    for i in 0..g.len() {
        if s[i] == g[i] {
            out[i] = b'2';
        } else {
            left[(s[i] - b'a') as usize] += 1;
        }
    }
    for i in 0..g.len() {
        if out[i] == b'0' && left[(g[i] - b'a') as usize] > 0 {
            left[(g[i] - b'a') as usize] -= 1;
            out[i] = b'1';
        }
    }
    String::from_utf8(out).expect("ascii")
}

fn valid_word(w: &str) -> bool {
    w.len() == WORD_LEN && w.bytes().all(|b| b.is_ascii_lowercase())
}

fn valid_hex(h: &str) -> bool {
    h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Commitment the UI computes through the `arcade_commit` command.
pub fn commitment(word: &str, salt: &str) -> String {
    commit_hash(&[DOMAIN, word, salt])
}

impl Wordle {
    fn answered(&self, s: usize) -> usize {
        self.guesses[s].iter().filter(|r| r.fb.is_some()).count()
    }

    fn solved(&self, s: usize) -> bool {
        self.guesses[s]
            .iter()
            .any(|r| r.fb.as_deref() == Some(SOLVED))
    }

    /// Seat expected to act in the play phase: the guesser, or the owner answering.
    fn actor(&self) -> usize {
        let (a0, a1) = (self.guesses[0].len(), self.guesses[1].len());
        let seat = if a0 == a1 { 0 } else { 1 };
        if self.guesses[seat].last().is_some_and(|r| r.fb.is_none()) {
            1 - seat
        } else {
            seat
        }
    }

    fn play_over(&self) -> bool {
        let (n0, n1) = (self.answered(0), self.answered(1));
        self.solved(1) || (self.solved(0) && n1 >= n0) || (n0 >= MAX_GUESSES && n1 >= MAX_GUESSES)
    }

    /// Winner once both reveals passed.
    fn verdict(&self) -> Outcome {
        match (self.solved(0), self.solved(1)) {
            (true, false) => Outcome::win(0, "solved"),
            (false, true) => Outcome::win(1, "solved"),
            (true, true) => Outcome::draw("both_solved"),
            _ => Outcome::draw("unsolved"),
        }
    }

    fn check_reveal(&self, seat: usize, word: &str) -> bool {
        self.guesses[1 - seat]
            .iter()
            .all(|r| r.fb.as_deref() == Some(feedback(word, &r.word).as_str()))
    }
}

impl GameRules for Wordle {
    fn seats(&self) -> usize {
        2
    }

    fn turn(&self) -> Option<usize> {
        match self.phase {
            Phase::Play => Some(self.actor()),
            _ => None,
        }
    }

    fn validate(&self, seat: usize, mv: &Value) -> Result<(), String> {
        match self.phase {
            Phase::Done => Err("game over".into()),
            Phase::Commit => {
                let h = str_field(mv, "commit").ok_or("commit your word first")?;
                if !valid_hex(h) {
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
                let pending = self.guesses[1 - seat]
                    .last()
                    .is_some_and(|r| r.fb.is_none());
                if pending {
                    let fb = str_field(mv, "fb").ok_or("answer the guess")?;
                    let ok = fb.len() == WORD_LEN && fb.bytes().all(|b| (b'0'..=b'2').contains(&b));
                    return ok.then_some(()).ok_or_else(|| "bad feedback".into());
                }
                let w = str_field(mv, "guess").ok_or("make a guess")?;
                if !valid_word(w) {
                    return Err("guess must be five letters a to z".into());
                }
                if self.guesses[seat].len() >= MAX_GUESSES {
                    return Err("no guesses left".into());
                }
                Ok(())
            }
            Phase::Reveal => {
                if self.revealed[seat].is_some() {
                    return Err("already revealed".into());
                }
                let r = mv.get("reveal").ok_or("reveal your word")?;
                let (w, salt) = (
                    str_field(r, "word").unwrap_or(""),
                    str_field(r, "salt").unwrap_or(""),
                );
                if !valid_word(w) || salt.len() > MAX_SALT {
                    return Err("bad reveal".into());
                }
                if self.commits[seat].as_deref() != Some(commitment(w, salt).as_str()) {
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
                if let Some(w) = str_field(mv, "guess") {
                    self.guesses[seat].push(Round {
                        word: w.into(),
                        fb: None,
                    });
                } else if let (Some(fb), Some(r)) =
                    (str_field(mv, "fb"), self.guesses[1 - seat].last_mut())
                {
                    r.fb = Some(fb.into());
                }
                if self.play_over() {
                    self.phase = Phase::Reveal;
                }
            }
            Phase::Reveal => {
                let word = str_field(&mv["reveal"], "word").unwrap_or("").to_string();
                if !self.check_reveal(seat, &word) {
                    self.over = Some(Outcome::win(1 - seat, "cheating"));
                    self.phase = Phase::Done;
                    return Ok(());
                }
                self.revealed[seat] = Some(word);
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
            self.guesses[s]
                .iter()
                .map(|r| json!({ "word": r.word, "fb": r.fb }))
                .collect()
        };
        json!({
            "phase": match self.phase { Phase::Commit => "commit", Phase::Play => "play", Phase::Reveal => "reveal", Phase::Done => "done" },
            "committed": [self.commits[0].is_some(), self.commits[1].is_some()],
            "guesses": [rows(0), rows(1)],
            "revealed": self.revealed,
            "maxGuesses": MAX_GUESSES,
            "wordLen": WORD_LEN,
            "actor": self.turn(),
        })
    }
}

pub fn init(_game_id: &str, _options: &Value) -> Result<Box<dyn GameRules>, String> {
    Ok(Box::new(Wordle {
        phase: Phase::Commit,
        commits: [None, None],
        guesses: [Vec::new(), Vec::new()],
        revealed: [None, None],
        over: None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Table {
        g: Wordle,
        words: [&'static str; 2],
        salts: [&'static str; 2],
    }

    fn table() -> Table {
        Table {
            g: Wordle {
                phase: Phase::Commit,
                commits: [None, None],
                guesses: [Vec::new(), Vec::new()],
                revealed: [None, None],
                over: None,
            },
            words: ["crane", "slate"],
            salts: ["s0", "s1"],
        }
    }

    fn start(t: &mut Table) {
        for s in 0..2 {
            let h = commitment(t.words[s], t.salts[s]);
            t.g.apply(s, &json!({ "commit": h })).unwrap();
        }
        assert_eq!(t.g.phase, Phase::Play);
    }

    /// Seat `s` guesses and the owner answers honestly (or with `lie`).
    fn round(t: &mut Table, s: usize, guess: &str, lie: Option<&str>) {
        t.g.apply(s, &json!({ "guess": guess })).unwrap();
        let fb = lie.map_or_else(|| feedback(t.words[1 - s], guess), str::to_string);
        t.g.apply(1 - s, &json!({ "fb": fb })).unwrap();
    }

    fn reveal(t: &mut Table, s: usize) -> Result<(), String> {
        t.g.apply(
            s,
            &json!({ "reveal": { "word": t.words[s], "salt": t.salts[s] } }),
        )
    }

    #[test]
    fn feedback_handles_duplicates() {
        assert_eq!(feedback("crane", "crane"), "22222");
        assert_eq!(feedback("crane", "slate"), "00202");
        assert_eq!(feedback("abbey", "babes"), "11220");
        assert_eq!(feedback("speed", "erase"), "10011");
        assert_eq!(feedback("llama", "hello"), "00110");
    }

    #[test]
    fn honest_game_solved_by_first_guesser() {
        let mut t = table();
        start(&mut t);
        round(&mut t, 0, "slate", None); // seat 0 guesses seat 1's word: solved
        assert_eq!(t.g.phase, Phase::Play, "seat 1 still owed its guess");
        round(&mut t, 1, "stone", None);
        assert_eq!(t.g.phase, Phase::Reveal);
        reveal(&mut t, 0).unwrap();
        assert!(t.g.outcome().is_none());
        reveal(&mut t, 1).unwrap();
        assert_eq!(t.g.outcome(), Some(Outcome::win(0, "solved")));
    }

    #[test]
    fn lying_about_feedback_forfeits_at_reveal() {
        let mut t = table();
        start(&mut t);
        round(&mut t, 0, "stone", None);
        round(&mut t, 1, "crane", Some("00000")); // seat 0 lies: crane is seat 0's own word
        for _ in 0..5 {
            round(&mut t, 0, "audio", None);
            round(&mut t, 1, "audio", None);
        }
        assert_eq!(t.g.phase, Phase::Reveal);
        reveal(&mut t, 1).unwrap();
        reveal(&mut t, 0).unwrap();
        assert_eq!(t.g.outcome(), Some(Outcome::win(1, "cheating")));
    }

    #[test]
    fn wrong_reveal_is_ignored_and_turns_are_enforced() {
        let mut t = table();
        assert!(
            t.g.apply(0, &json!({ "guess": "crane" })).is_err(),
            "commit first"
        );
        start(&mut t);
        assert!(
            t.g.apply(1, &json!({ "guess": "crane" })).is_err(),
            "seat 0 moves first"
        );
        assert!(t.g.apply(0, &json!({ "guess": "CRANE" })).is_err());
        assert!(t.g.apply(0, &json!({ "guess": "cran" })).is_err());
        t.g.apply(0, &json!({ "guess": "stone" })).unwrap();
        assert!(
            t.g.apply(0, &json!({ "guess": "stone" })).is_err(),
            "owner must answer first"
        );
        assert!(t.g.apply(1, &json!({ "fb": "xxxxx" })).is_err());
        t.g.phase = Phase::Reveal;
        assert!(
            t.g.apply(0, &json!({ "reveal": { "word": "crate", "salt": "s0" } }))
                .is_err()
        );
        assert!(t.g.revealed[0].is_none());
    }

    #[test]
    fn unsolved_after_six_each_is_a_draw() {
        let mut t = table();
        start(&mut t);
        for _ in 0..MAX_GUESSES {
            round(&mut t, 0, "audio", None);
            round(&mut t, 1, "audio", None);
        }
        reveal(&mut t, 0).unwrap();
        reveal(&mut t, 1).unwrap();
        assert_eq!(t.g.outcome(), Some(Outcome::draw("unsolved")));
    }
}
