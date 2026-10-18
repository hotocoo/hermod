//! Arcade fold (contract section 11.2): games, polls, quizzes, kudos, standups, Elo.
//!
//! Runs inside the space fold in `(lamport, author, seq)` order, so seats, move numbers and
//! ratings come out identical on every peer. Illegal, out of turn or duplicate moves are
//! ignored, never errors. Turn-based kinds delegate legality to [`crate::games`]; real-time
//! kinds only take the host's `game.result`.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::ProjectionConfig;
use crate::crypto::blake3_hash;
use crate::event::{EventBody, Role};
use crate::games::{self, GameRules, Outcome, Verdict, elo};

const MAX_ID: usize = 128;
const MAX_TITLE: usize = 80;
const MAX_MOVE_JSON: usize = 4096;
const MAX_MOVES: usize = 2000;
const MAX_GAMES: usize = 500;
const MAX_OPEN_PER_HOST: usize = 10;
const MAX_POLLS: usize = 200;
const MAX_QUIZZES: usize = 100;
const MAX_QUESTION: usize = 200;
const MAX_OPTION: usize = 80;
const MIN_POLL_OPTIONS: usize = 2;
const MAX_POLL_OPTIONS: usize = 12;
const MAX_QUIZ_QUESTIONS: usize = 20;
const MAX_QUIZ_OPTIONS: usize = 6;
const MAX_REASON: usize = 200;
const MAX_EMOJI: usize = 8;
const MAX_STANDUP_FIELD: usize = 1000;
const REALTIME_DEFAULT_SEATS: usize = 4;
const MAX_SCORE: i64 = 1_000_000_000;

fn clip(s: &str, max: usize) -> String {
    s.trim().chars().take(max).collect()
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_ID && !s.chars().any(char::is_control)
}

fn valid_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Status {
    Waiting,
    Active,
    Done,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Status::Waiting => "waiting",
            Status::Active => "active",
            Status::Done => "done",
        }
    }
}

struct MoveRec {
    seat: usize,
    mv: Value,
    ts: i64,
}

struct Finished {
    verdict: &'static str,
    winner: Option<String>,
    reason: String,
    scores: BTreeMap<String, i64>,
}

struct GameSt {
    id: String,
    kind: String,
    title: String,
    host: String,
    seats: Vec<Option<String>>,
    options: Value,
    rules: Option<Box<dyn GameRules>>,
    moves: Vec<MoveRec>,
    status: Status,
    result: Option<Finished>,
    draw_offer: Option<usize>,
    ts: i64,
}

impl GameSt {
    fn seat_of(&self, user: &str) -> Option<usize> {
        self.seats.iter().position(|s| s.as_deref() == Some(user))
    }

    fn seated(&self) -> usize {
        self.seats.iter().flatten().count()
    }

    fn realtime(&self) -> bool {
        self.rules.is_none()
    }

    /// Turn-based tables start when full; real-time ones with two players.
    fn refresh_status(&mut self) {
        if self.status == Status::Done {
            return;
        }
        let ready = if self.realtime() {
            self.seated() >= 2
        } else {
            self.seated() == self.seats.len()
        };
        self.status = if ready {
            Status::Active
        } else {
            Status::Waiting
        };
    }

    fn open_seats(&self) -> bool {
        self.seats.iter().any(Option::is_none)
    }
}

struct PollSt {
    id: String,
    by: String,
    question: String,
    options: Vec<String>,
    multi: bool,
    anonymous: bool,
    closed: bool,
    votes: BTreeMap<String, Vec<u32>>,
    ts: i64,
}

struct QuizQ {
    q: String,
    options: Vec<String>,
    hash: String,
}

struct QuizSt {
    id: String,
    by: String,
    title: String,
    questions: Vec<QuizQ>,
    answers: BTreeMap<String, Vec<u32>>,
    correct: Option<Vec<u32>>,
    ts: i64,
}

struct KudosSt {
    by: String,
    to: String,
    reason: String,
    emoji: String,
    ts: i64,
}

#[derive(Clone, Copy)]
struct Rating {
    wins: u32,
    draws: u32,
    losses: u32,
    elo: i32,
}

impl Default for Rating {
    fn default() -> Self {
        Rating {
            wins: 0,
            draws: 0,
            losses: 0,
            elo: elo::INITIAL,
        }
    }
}

#[derive(Default)]
pub struct ArcadeState {
    games: Vec<GameSt>,
    polls: Vec<PollSt>,
    quizzes: Vec<QuizSt>,
    kudos: Vec<KudosSt>,
    /// `(day, user)`: a later post replaces the earlier one.
    standups: BTreeMap<(String, String), (String, String, String, i64)>,
    ratings: BTreeMap<(String, String), Rating>,
}

/// Seat 0 or 1 from the game id, so "random" sides are identical on every peer.
fn random_seat(game_id: &str) -> usize {
    usize::from(blake3_hash(game_id.as_bytes())[0] & 1)
}

impl ArcadeState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open games with a free seat (drives the lit sign on the island).
    pub fn waiting(&self) -> u32 {
        self.games
            .iter()
            .filter(|g| g.status == Status::Waiting && g.open_seats())
            .count() as u32
    }

    /// Content counted toward the building level.
    pub fn content(&self) -> u32 {
        (self.games.len()
            + self.polls.len()
            + self.quizzes.len()
            + self.kudos.len()
            + self.standups.len()) as u32
    }

    fn game_mut(&mut self, id: &str) -> Option<&mut GameSt> {
        self.games.iter_mut().find(|g| g.id == id)
    }

    pub fn apply(&mut self, ts: i64, by: &str, roles: &BTreeMap<String, Role>, body: &EventBody) {
        match body {
            EventBody::GameCreate {
                game_id,
                kind,
                title,
                players,
                seats,
                options,
            } => {
                self.create_game(
                    ts, by, roles, game_id, kind, title, players, *seats, options,
                );
            }
            EventBody::GameJoin { game_id, seat } => {
                if let Some(g) = self.game_mut(game_id)
                    && g.status != Status::Done
                    && g.seat_of(by).is_none()
                    && (g.realtime() || g.open_seats())
                {
                    let free = match seat {
                        Some(s) => (usize::from(*s) < g.seats.len()
                            && g.seats[usize::from(*s)].is_none())
                        .then_some(usize::from(*s)),
                        None => g.seats.iter().position(Option::is_none),
                    };
                    if let Some(i) = free {
                        g.seats[i] = Some(by.to_string());
                        g.refresh_status();
                    }
                }
            }
            EventBody::GameLeave { game_id } => self.leave(ts, by, game_id),
            EventBody::GameMove { game_id, mv, n } => self.play(ts, by, game_id, mv, *n),
            EventBody::GameResign { game_id } => {
                let Some(g) = self.game_mut(game_id) else {
                    return;
                };
                if let (Some(seat), Status::Active, false) = (g.seat_of(by), g.status, g.realtime())
                {
                    let out = Outcome::win(1 - seat, "resign");
                    self.finish(game_id, out);
                }
            }
            EventBody::GameDraw { game_id, action } => self.draw(by, game_id, action),
            EventBody::GameResult {
                game_id,
                outcome,
                scores,
            } => self.realtime_result(by, game_id, outcome, scores),
            EventBody::PollCreate {
                poll_id,
                question,
                options,
                multi,
                anonymous,
            } => {
                let opts: Vec<String> = options.iter().map(|o| clip(o, MAX_OPTION)).collect();
                let q = clip(question, MAX_QUESTION);
                if valid_id(poll_id)
                    && !q.is_empty()
                    && (MIN_POLL_OPTIONS..=MAX_POLL_OPTIONS).contains(&opts.len())
                    && opts.iter().all(|o| !o.is_empty())
                    && self.polls.len() < MAX_POLLS
                    && !self.polls.iter().any(|p| &p.id == poll_id)
                {
                    self.polls.push(PollSt {
                        id: poll_id.clone(),
                        by: by.to_string(),
                        question: q,
                        options: opts,
                        multi: *multi,
                        anonymous: *anonymous,
                        closed: false,
                        votes: BTreeMap::new(),
                        ts,
                    });
                }
            }
            EventBody::PollVote { poll_id, choices } => {
                if let Some(p) = self
                    .polls
                    .iter_mut()
                    .find(|p| &p.id == poll_id && !p.closed)
                {
                    let set: BTreeSet<u32> = choices.iter().copied().collect();
                    let in_range = set.iter().all(|&c| (c as usize) < p.options.len());
                    let count_ok = set.is_empty() || p.multi || set.len() == 1;
                    if in_range && count_ok {
                        if set.is_empty() {
                            p.votes.remove(by);
                        } else {
                            p.votes.insert(by.to_string(), set.into_iter().collect());
                        }
                    }
                }
            }
            EventBody::PollClose { poll_id } => {
                let admin = roles.get(by).is_some_and(|r| *r >= Role::Admin);
                if let Some(p) = self.polls.iter_mut().find(|p| &p.id == poll_id)
                    && (p.by == by || admin)
                {
                    p.closed = true;
                }
            }
            EventBody::QuizCreate {
                quiz_id,
                title,
                questions,
            } => self.quiz_create(ts, by, quiz_id, title, questions),
            EventBody::QuizAnswer { quiz_id, answers } => {
                if let Some(q) = self.quizzes.iter_mut().find(|q| &q.id == quiz_id)
                    && q.correct.is_none()
                    && q.by != by
                    && !q.answers.contains_key(by)
                    && answers.len() == q.questions.len()
                    && answers
                        .iter()
                        .zip(&q.questions)
                        .all(|(a, qq)| (*a as usize) < qq.options.len())
                {
                    q.answers.insert(by.to_string(), answers.clone());
                }
            }
            EventBody::QuizReveal { quiz_id, answers } => {
                if let Some(q) = self.quizzes.iter_mut().find(|q| &q.id == quiz_id)
                    && q.by == by
                    && q.correct.is_none()
                    && answers.len() == q.questions.len()
                    && answers.iter().enumerate().all(|(i, o)| {
                        (o.answer as usize) < q.questions[i].options.len()
                            && games::quiz_commitment(&q.id, i, o.answer, &o.salt)
                                == q.questions[i].hash
                    })
                {
                    q.correct = Some(answers.iter().map(|o| o.answer).collect());
                }
            }
            EventBody::KudosGive { to, reason, emoji } => {
                let reason = clip(reason, MAX_REASON);
                if to != by && roles.contains_key(to) && !reason.is_empty() {
                    self.kudos.push(KudosSt {
                        by: by.to_string(),
                        to: to.clone(),
                        reason,
                        emoji: clip(emoji, MAX_EMOJI),
                        ts,
                    });
                }
            }
            EventBody::StandupPost {
                day,
                yesterday,
                today,
                blockers,
            } if valid_day(day) => {
                self.standups.insert(
                    (day.clone(), by.to_string()),
                    (
                        clip(yesterday, MAX_STANDUP_FIELD),
                        clip(today, MAX_STANDUP_FIELD),
                        clip(blockers, MAX_STANDUP_FIELD),
                        ts,
                    ),
                );
            }
            _ => {}
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn create_game(
        &mut self,
        ts: i64,
        by: &str,
        roles: &BTreeMap<String, Role>,
        id: &str,
        kind: &str,
        title: &str,
        players: &[String],
        seats: Option<u8>,
        options: &Value,
    ) {
        let open_by_host = self
            .games
            .iter()
            .filter(|g| g.host == by && g.status != Status::Done)
            .count();
        if !valid_id(id)
            || self.games.len() >= MAX_GAMES
            || open_by_host >= MAX_OPEN_PER_HOST
            || self.games.iter().any(|g| g.id == id)
            || options.to_string().len() > MAX_MOVE_JSON
        {
            return;
        }
        let rules = if games::is_realtime(kind) {
            None
        } else {
            match games::init(kind, id, options) {
                Ok(r) => Some(r),
                Err(_) => return,
            }
        };
        let n = match &rules {
            Some(r) => {
                if seats.is_some_and(|s| usize::from(s) != r.seats()) {
                    return;
                }
                r.seats()
            }
            None => usize::from(seats.unwrap_or(REALTIME_DEFAULT_SEATS as u8)),
        };
        if rules.is_none() && !(2..=games::REALTIME_MAX_SEATS).contains(&n) {
            return;
        }
        let distinct: BTreeSet<&String> = players.iter().collect();
        if players.len() > n
            || distinct.len() != players.len()
            || !players.iter().all(|p| roles.contains_key(p))
        {
            return;
        }
        let mut seat_list: Vec<Option<String>> = vec![None; n];
        if players.is_empty() {
            let host_seat = match options.get("host_seat") {
                Some(Value::String(s)) if s == "random" => random_seat(id),
                Some(v) => v.as_u64().map_or(0, |s| s as usize),
                None => 0,
            };
            seat_list[host_seat.min(n - 1)] = Some(by.to_string());
        } else {
            for (i, p) in players.iter().enumerate() {
                seat_list[i] = Some(p.clone());
            }
        }
        let mut g = GameSt {
            id: id.to_string(),
            kind: kind.to_string(),
            title: clip(title, MAX_TITLE),
            host: by.to_string(),
            seats: seat_list,
            options: options.clone(),
            rules,
            moves: Vec::new(),
            status: Status::Waiting,
            result: None,
            draw_offer: None,
            ts,
        };
        g.refresh_status();
        self.games.push(g);
    }

    fn leave(&mut self, _ts: i64, by: &str, game_id: &str) {
        let Some(g) = self.game_mut(game_id) else {
            return;
        };
        let Some(seat) = g.seat_of(by) else { return };
        match (g.status, g.realtime()) {
            (Status::Done, _) => {}
            (Status::Active, false) => {
                let out = Outcome::win(1 - seat, "left");
                self.finish(game_id, out);
            }
            _ => {
                g.seats[seat] = None;
                g.refresh_status();
            }
        }
    }

    fn play(&mut self, ts: i64, by: &str, game_id: &str, mv: &Value, n: u32) {
        let Some(g) = self.game_mut(game_id) else {
            return;
        };
        let Some(seat) = g.seat_of(by) else { return };
        if g.status != Status::Active
            || n as usize != g.moves.len() + 1
            || g.moves.len() >= MAX_MOVES
            || mv.to_string().len() > MAX_MOVE_JSON
        {
            return;
        }
        let Some(rules) = g.rules.as_mut() else {
            return;
        };
        if rules.apply(seat, mv).is_err() {
            return;
        }
        g.moves.push(MoveRec {
            seat,
            mv: mv.clone(),
            ts,
        });
        g.draw_offer = None;
        if let Some(out) = rules.outcome() {
            self.finish(game_id, out);
        }
    }

    fn draw(&mut self, by: &str, game_id: &str, action: &str) {
        let Some(g) = self.game_mut(game_id) else {
            return;
        };
        let Some(seat) = g.seat_of(by) else { return };
        if g.status != Status::Active || g.realtime() {
            return;
        }
        match (action, g.draw_offer) {
            ("offer", Some(o)) if o != seat => self.finish(game_id, Outcome::draw("agreed")),
            ("offer", _) => g.draw_offer = Some(seat),
            ("accept", Some(o)) if o != seat => self.finish(game_id, Outcome::draw("agreed")),
            ("decline", Some(o)) if o != seat => g.draw_offer = None,
            _ => {}
        }
    }

    fn realtime_result(
        &mut self,
        by: &str,
        game_id: &str,
        outcome: &str,
        scores: &BTreeMap<String, i64>,
    ) {
        let Some(g) = self.game_mut(game_id) else {
            return;
        };
        if !g.realtime() || g.host != by || g.status != Status::Active {
            return;
        }
        let seated: BTreeSet<&str> = g.seats.iter().flatten().map(String::as_str).collect();
        let kept: BTreeMap<String, i64> = scores
            .iter()
            .filter(|(u, _)| seated.contains(u.as_str()))
            .map(|(u, s)| (u.clone(), (*s).clamp(-MAX_SCORE, MAX_SCORE)))
            .collect();
        let best = kept.values().copied().max();
        let leaders: Vec<&String> = kept
            .iter()
            .filter(|(_, s)| Some(**s) == best)
            .map(|(u, _)| u)
            .collect();
        let (verdict, winner) = match (kept.is_empty(), leaders.len()) {
            (true, _) => ("completed", None),
            (false, 1) => ("win", Some(leaders[0].clone())),
            _ => ("draw", None),
        };
        let reason = clip(outcome, 32);
        let kind = g.kind.clone();
        g.status = Status::Done;
        g.result = Some(Finished {
            verdict,
            winner,
            reason: if reason.is_empty() {
                "completed".into()
            } else {
                reason
            },
            scores: kept.clone(),
        });
        self.rate_multi(&kind, &kept);
    }

    /// Pairwise Elo for a scored multi-player game; each delta is shared out over the opponents.
    fn rate_multi(&mut self, kind: &str, scores: &BTreeMap<String, i64>) {
        if scores.len() < 2 {
            return;
        }
        let pre: BTreeMap<&String, i32> = scores
            .keys()
            .map(|u| {
                (
                    u,
                    self.ratings
                        .get(&(kind.to_string(), u.clone()))
                        .copied()
                        .unwrap_or_default()
                        .elo,
                )
            })
            .collect();
        let others = (scores.len() - 1) as i32;
        let mut delta: BTreeMap<&String, i32> = BTreeMap::new();
        let top = scores.values().copied().max();
        for (a, sa) in scores {
            for (b, sb) in scores {
                if a >= b {
                    continue;
                }
                let s = match sa.cmp(sb) {
                    std::cmp::Ordering::Greater => 1.0,
                    std::cmp::Ordering::Equal => 0.5,
                    std::cmp::Ordering::Less => 0.0,
                };
                let (na, _) = elo::update(pre[a], pre[b], s);
                let d = na - pre[a];
                *delta.entry(a).or_default() += d;
                *delta.entry(b).or_default() -= d;
            }
        }
        for (u, s) in scores {
            let r = self
                .ratings
                .entry((kind.to_string(), u.clone()))
                .or_default();
            r.elo += delta.get(u).copied().unwrap_or(0) / others;
            if Some(*s) == top && scores.values().filter(|x| Some(**x) == top).count() == 1 {
                r.wins += 1;
            } else if Some(*s) == top {
                r.draws += 1;
            } else {
                r.losses += 1;
            }
        }
    }

    fn finish(&mut self, game_id: &str, out: Outcome) {
        let Some(g) = self.game_mut(game_id) else {
            return;
        };
        let users: Vec<Option<String>> = g.seats.clone();
        let kind = g.kind.clone();
        g.status = Status::Done;
        g.draw_offer = None;
        let (verdict, winner) = match out.verdict {
            Verdict::Win(s) => ("win", users.get(s).cloned().flatten()),
            Verdict::Draw => ("draw", None),
        };
        g.result = Some(Finished {
            verdict,
            winner: winner.clone(),
            reason: out.reason.clone(),
            scores: BTreeMap::new(),
        });
        let (Some(Some(a)), Some(Some(b))) = (users.first(), users.get(1)) else {
            return;
        };
        if a == b || users.len() != 2 {
            return;
        }
        let score_a = match out.verdict {
            Verdict::Win(0) => 1.0,
            Verdict::Win(_) => 0.0,
            Verdict::Draw => 0.5,
        };
        let ra = self
            .ratings
            .get(&(kind.clone(), a.clone()))
            .copied()
            .unwrap_or_default();
        let rb = self
            .ratings
            .get(&(kind.clone(), b.clone()))
            .copied()
            .unwrap_or_default();
        let (na, nb) = elo::update(ra.elo, rb.elo, score_a);
        let bump = |r: &mut Rating, new: i32, s: f64| {
            r.elo = new;
            if s == 1.0 {
                r.wins += 1;
            } else if s == 0.0 {
                r.losses += 1;
            } else {
                r.draws += 1;
            }
        };
        bump(
            self.ratings.entry((kind.clone(), a.clone())).or_default(),
            na,
            score_a,
        );
        bump(
            self.ratings.entry((kind, b.clone())).or_default(),
            nb,
            1.0 - score_a,
        );
    }

    fn quiz_create(
        &mut self,
        ts: i64,
        by: &str,
        id: &str,
        title: &str,
        qs: &[crate::event::QuizQuestionIn],
    ) {
        let ok = valid_id(id)
            && self.quizzes.len() < MAX_QUIZZES
            && !self.quizzes.iter().any(|q| q.id == id)
            && (1..=MAX_QUIZ_QUESTIONS).contains(&qs.len())
            && qs.iter().all(|q| {
                !clip(&q.q, MAX_QUESTION).is_empty()
                    && (2..=MAX_QUIZ_OPTIONS).contains(&q.options.len())
                    && q.options.iter().all(|o| !clip(o, MAX_OPTION).is_empty())
                    && q.answer_hash.len() == 64
                    && q.answer_hash.bytes().all(|b| b.is_ascii_hexdigit())
            });
        if !ok {
            return;
        }
        self.quizzes.push(QuizSt {
            id: id.to_string(),
            by: by.to_string(),
            title: clip(title, MAX_TITLE),
            questions: qs
                .iter()
                .map(|q| QuizQ {
                    q: clip(&q.q, MAX_QUESTION),
                    options: q.options.iter().map(|o| clip(o, MAX_OPTION)).collect(),
                    hash: q.answer_hash.to_ascii_lowercase(),
                })
                .collect(),
            answers: BTreeMap::new(),
            correct: None,
            ts,
        });
    }
}

// ---- views ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameView {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub host: String,
    pub seats: Vec<Option<String>>,
    pub options: Value,
    pub status: String,
    /// Seat to move (turn-based), if any.
    pub turn: Option<usize>,
    /// Kind specific public state, `legal` moves included; null for real-time kinds.
    pub state: Value,
    pub moves: Vec<Value>,
    pub move_count: usize,
    pub result: Option<Value>,
    pub draw_offer: Option<usize>,
    pub my_seat: Option<usize>,
    pub ts: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LeaderRow {
    pub user: String,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub elo: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArcadeView {
    pub games: Vec<GameView>,
    pub polls: Vec<Value>,
    pub quizzes: Vec<Value>,
    pub kudos: Vec<Value>,
    pub standups: Vec<Value>,
    pub leaderboard: BTreeMap<String, Vec<LeaderRow>>,
    pub waiting: u32,
}

impl ArcadeState {
    fn game_view(g: &GameSt, me: &str, move_cap: usize) -> GameView {
        let skip = g.moves.len().saturating_sub(move_cap);
        GameView {
            id: g.id.clone(),
            kind: g.kind.clone(),
            title: g.title.clone(),
            host: g.host.clone(),
            seats: g.seats.clone(),
            options: g.options.clone(),
            status: g.status.as_str().to_string(),
            turn: g.rules.as_ref().and_then(|r| r.turn()),
            state: g.rules.as_ref().map_or(Value::Null, |r| r.view()),
            moves: g.moves.iter().enumerate().skip(skip).map(|(i, m)| json!({ "n": i + 1, "seat": m.seat, "move": m.mv, "ts": m.ts })).collect(),
            move_count: g.moves.len(),
            result: g.result.as_ref().map(|r| json!({
                "verdict": r.verdict, "winner": r.winner, "reason": r.reason, "scores": r.scores,
            })),
            draw_offer: g.draw_offer,
            my_seat: g.seat_of(me),
            ts: g.ts,
        }
    }

    fn poll_view(p: &PollSt, me: &str) -> Value {
        let mut counts = vec![0u32; p.options.len()];
        for v in p.votes.values() {
            for &c in v {
                counts[c as usize] += 1;
            }
        }
        let options: Vec<Value> = p
            .options
            .iter()
            .zip(&counts)
            .map(|(t, n)| json!({ "text": t, "votes": n }))
            .collect();
        json!({
            "id": p.id, "by": p.by, "question": p.question, "options": options, "multi": p.multi,
            "anonymous": p.anonymous, "closed": p.closed, "voters": p.votes.len(),
            "mine": p.votes.get(me).cloned().unwrap_or_default(),
            "who": if p.anonymous { Value::Null } else { json!(p.votes) },
            "ts": p.ts,
        })
    }

    fn quiz_view(q: &QuizSt, me: &str) -> Value {
        let questions: Vec<Value> = q
            .questions
            .iter()
            .map(|x| json!({ "q": x.q, "options": x.options, "hash": x.hash }))
            .collect();
        let scores: Vec<Value> = match &q.correct {
            Some(c) => {
                let mut rows: Vec<(String, usize)> = q
                    .answers
                    .iter()
                    .map(|(u, a)| (u.clone(), a.iter().zip(c).filter(|(x, y)| x == y).count()))
                    .collect();
                rows.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
                rows.into_iter()
                    .map(|(u, s)| json!({ "user": u, "score": s, "total": c.len() }))
                    .collect()
            }
            None => Vec::new(),
        };
        json!({
            "id": q.id, "by": q.by, "title": q.title, "questions": questions, "answered": q.answers.len(),
            "mine": q.answers.get(me), "correct": q.correct, "scores": scores,
            "everyone": if q.correct.is_some() { json!(q.answers) } else { Value::Null },
            "ts": q.ts,
        })
    }

    /// Per-kind leaderboard, best Elo first.
    fn leaderboard(&self) -> BTreeMap<String, Vec<LeaderRow>> {
        let mut out: BTreeMap<String, Vec<LeaderRow>> = BTreeMap::new();
        for ((kind, user), r) in &self.ratings {
            out.entry(kind.clone()).or_default().push(LeaderRow {
                user: user.clone(),
                wins: r.wins,
                draws: r.draws,
                losses: r.losses,
                elo: r.elo,
            });
        }
        for rows in out.values_mut() {
            rows.sort_by(|a, b| b.elo.cmp(&a.elo).then(a.user.cmp(&b.user)));
        }
        out
    }

    /// The viewer's projection; `None` when the space has no arcade activity at all.
    pub fn render(&self, me: &str, cfg: &ProjectionConfig) -> Option<ArcadeView> {
        if self.games.is_empty()
            && self.polls.is_empty()
            && self.quizzes.is_empty()
            && self.kudos.is_empty()
            && self.standups.is_empty()
        {
            return None;
        }
        let mut done: Vec<&GameSt> = self
            .games
            .iter()
            .filter(|g| g.status == Status::Done)
            .collect();
        let skip = done.len().saturating_sub(cfg.arcade_done_games_max);
        done.drain(..skip);
        let live = self
            .games
            .iter()
            .filter(|g| g.status != Status::Done && g.seated() > 0);
        let mut games: Vec<&GameSt> = live.chain(done).collect();
        games.sort_by_key(|g| std::cmp::Reverse(g.ts));
        let mut days: Vec<&String> = self
            .standups
            .keys()
            .map(|(d, _)| d)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        days.reverse();
        days.truncate(cfg.arcade_standup_days);
        let standups = days
            .into_iter()
            .map(|d| {
                let posts: Vec<Value> = self
                    .standups
                    .iter()
                    .filter(|((day, _), _)| day == d)
                    .map(|((_, u), (y, t, b, ts))| json!({ "user": u, "yesterday": y, "today": t, "blockers": b, "ts": ts }))
                    .collect();
                json!({ "day": d, "posts": posts })
            })
            .collect();
        Some(ArcadeView {
            games: games.into_iter().map(|g| Self::game_view(g, me, cfg.arcade_moves_max)).collect(),
            polls: self.polls.iter().rev().map(|p| Self::poll_view(p, me)).collect(),
            quizzes: self.quizzes.iter().rev().map(|q| Self::quiz_view(q, me)).collect(),
            kudos: self
                .kudos
                .iter()
                .rev()
                .take(cfg.arcade_kudos_max)
                .map(|k| json!({ "by": k.by, "to": k.to, "reason": k.reason, "emoji": k.emoji, "ts": k.ts }))
                .collect(),
            standups,
            leaderboard: self.leaderboard(),
            waiting: self.waiting(),
        })
    }
}
