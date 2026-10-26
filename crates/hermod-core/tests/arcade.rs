mod common;

use std::collections::BTreeMap;

use common::*;
use hermod_core::event::{EventBody, QuizOpenIn, QuizQuestionIn, Role};
use hermod_core::games::{self, quiz_commitment};
use hermod_core::identity::Identity;
use hermod_core::ids::{SpaceId, UserId};
use hermod_core::projections::arcade::ArcadeView;
use hermod_core::projections::project;
use serde_json::{Value, json};

struct Hall {
    log: Log,
    sid: SpaceId,
    a: UserId,
    b: UserId,
    c: UserId,
    _ids: Vec<Identity>,
}

fn invite_member() -> EventBody {
    EventBody::InviteCreate {
        id: "m".into(),
        exp: None,
        max_uses: None,
        role: Role::Member,
    }
}

fn join_m() -> EventBody {
    EventBody::MemberJoin {
        via_invite_from: None,
        invite: Some("m".into()),
    }
}

fn hall() -> Hall {
    let (i0, a) = user();
    let (i1, b) = user();
    let (i2, c) = user();
    let mut log = Log::new();
    let t = NOW - DAY;
    log.push(&a, t, space_create("Hall", &["chat", "arcade"]));
    log.push(&a, t, invite_member());
    log.push(&b, t, join_m());
    log.push(&c, t, join_m());
    Hall {
        log,
        sid: SpaceId([7; 32]),
        a,
        b,
        c,
        _ids: vec![i0, i1, i2],
    }
}

fn view_of(h: &Hall, me: UserId) -> Option<ArcadeView> {
    let snap = project(&ctx(me), &[h.log.input(h.sid, "Hall", "Team", false)]);
    snap.collections.arcade.into_values().next()
}

fn create(id: &str, kind: &str) -> EventBody {
    EventBody::GameCreate {
        game_id: id.into(),
        kind: kind.into(),
        title: format!("{kind} table"),
        players: vec![],
        seats: None,
        options: Value::Null,
    }
}

fn join(id: &str) -> EventBody {
    EventBody::GameJoin {
        game_id: id.into(),
        seat: None,
    }
}

fn mv(id: &str, n: u32, m: Value) -> EventBody {
    EventBody::GameMove {
        game_id: id.into(),
        mv: m,
        n,
    }
}

fn uci(u: &str) -> Value {
    json!({ "from": &u[0..2], "to": &u[2..4], "promo": u.get(4..5).unwrap_or("") })
}

fn game<'a>(v: &'a ArcadeView, id: &str) -> &'a hermod_core::projections::arcade::GameView {
    v.games.iter().find(|g| g.id == id).expect("game listed")
}

fn elo_of(v: &ArcadeView, kind: &str, user: UserId) -> (i32, u32, u32) {
    let u = user.to_string();
    let r = v.leaderboard[kind]
        .iter()
        .find(|r| r.user == u)
        .expect("rated");
    (r.elo, r.wins, r.losses)
}

/// A (white) creates, B joins, scholar's mate.
fn scholars_mate(h: &mut Hall) {
    let t = NOW - HOUR;
    h.log.push(&h.a.clone(), t, create("g1", "chess"));
    h.log.push(&h.b.clone(), t, join("g1"));
    let line = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"];
    for (i, m) in line.iter().enumerate() {
        let who = if i % 2 == 0 { h.a } else { h.b };
        h.log
            .push(&who, t + i as i64, mv("g1", i as u32 + 1, uci(m)));
    }
}

#[test]
fn chess_game_plays_out_and_updates_elo() {
    let mut h = hall();
    scholars_mate(&mut h);
    let v = view_of(&h, h.b).unwrap();
    let g = game(&v, "g1");
    assert_eq!(g.status, "done");
    assert_eq!(g.move_count, 7);
    let r = g.result.as_ref().unwrap();
    assert_eq!(r["verdict"], "win");
    assert_eq!(r["winner"], h.a.to_string());
    assert_eq!(r["reason"], "checkmate");
    assert_eq!(elo_of(&v, "chess", h.a), (1212, 1, 0));
    assert_eq!(elo_of(&v, "chess", h.b), (1188, 0, 1));
    assert_eq!(g.my_seat, Some(1));
    assert!(g.state["legal"].as_array().unwrap().is_empty());
}

#[test]
fn illegal_out_of_turn_and_replayed_moves_are_ignored() {
    let mut h = hall();
    let t = NOW - HOUR;
    h.log.push(&h.a.clone(), t, create("g1", "chess"));
    // B has not joined yet: a move now is ignored, and so is an outsider
    h.log.push(&h.a.clone(), t, mv("g1", 1, uci("e2e4")));
    h.log.push(&h.c.clone(), t, mv("g1", 1, uci("e2e4")));
    h.log.push(&h.b.clone(), t, join("g1"));
    h.log.push(&h.b.clone(), t, mv("g1", 1, uci("e7e5"))); // out of turn
    h.log.push(&h.a.clone(), t, mv("g1", 1, uci("e2e5"))); // illegal
    h.log.push(&h.a.clone(), t, mv("g1", 2, uci("e2e4"))); // wrong move number
    h.log.push(&h.a.clone(), t, mv("g1", 1, uci("e2e4"))); // finally fine
    h.log.push(&h.a.clone(), t, mv("g1", 1, uci("d2d4"))); // replay of number 1
    h.log.push(&h.b.clone(), t, mv("g1", 2, uci("e7e5")));
    let v = view_of(&h, h.a).unwrap();
    let g = game(&v, "g1");
    assert_eq!(g.move_count, 2);
    assert_eq!(g.state["turn"], 0);
    assert_eq!(g.status, "active");
}

#[test]
fn resign_and_draw_offers() {
    let mut h = hall();
    let t = NOW - HOUR;
    for id in ["r", "d"] {
        h.log.push(&h.a.clone(), t, create(id, "tictactoe"));
        h.log.push(&h.b.clone(), t, join(id));
    }
    h.log.push(
        &h.a.clone(),
        t,
        EventBody::GameDraw {
            game_id: "d".into(),
            action: "offer".into(),
        },
    );
    h.log.push(
        &h.b.clone(),
        t,
        EventBody::GameDraw {
            game_id: "d".into(),
            action: "accept".into(),
        },
    );
    h.log.push(
        &h.b.clone(),
        t,
        EventBody::GameResign {
            game_id: "r".into(),
        },
    );
    let v = view_of(&h, h.a).unwrap();
    assert_eq!(game(&v, "d").result.as_ref().unwrap()["verdict"], "draw");
    assert_eq!(
        game(&v, "r").result.as_ref().unwrap()["winner"],
        h.a.to_string()
    );
    // equal ratings: the draw changes nothing, the win then moves 12 points
    let (elo, wins, _) = elo_of(&v, "tictactoe", h.a);
    assert_eq!((elo, wins), (1212, 1));
}

#[test]
fn connect4_vertical_win_through_the_fold() {
    let mut h = hall();
    let t = NOW - HOUR;
    h.log.push(&h.a.clone(), t, create("c4", "connect4"));
    h.log.push(&h.b.clone(), t, join("c4"));
    let cols = [0, 1, 0, 1, 0, 1, 0];
    for (i, c) in cols.iter().enumerate() {
        let who = if i % 2 == 0 { h.a } else { h.b };
        h.log
            .push(&who, t, mv("c4", i as u32 + 1, json!({ "col": c })));
    }
    let v = view_of(&h, h.a).unwrap();
    assert_eq!(
        game(&v, "c4").result.as_ref().unwrap()["reason"],
        "four_in_row"
    );
}

#[test]
fn replay_is_deterministic_under_shuffled_ingest() {
    let mut h = hall();
    scholars_mate(&mut h);
    h.log.push(
        &h.c.clone(),
        NOW - 10,
        EventBody::KudosGive {
            to: h.a.to_string(),
            reason: "nice mate".into(),
            emoji: "x".into(),
        },
    );
    let reference = serde_json::to_value(project(
        &ctx(h.a),
        &[h.log.input(h.sid, "Hall", "Team", false)],
    ))
    .unwrap();
    for rot in [1usize, 5, 9] {
        let mut input = h.log.input(h.sid, "Hall", "Team", false);
        input.events_mut().rotate_left(rot);
        input.events_mut().reverse();
        let again = serde_json::to_value(project(&ctx(h.a), &[input])).unwrap();
        assert_eq!(reference, again, "rotation {rot}");
    }
}

#[test]
fn realtime_result_only_from_host() {
    let mut h = hall();
    let t = NOW - HOUR;
    h.log.push(
        &h.a.clone(),
        t,
        EventBody::GameCreate {
            game_id: "p".into(),
            kind: "pictionary".into(),
            title: "draw".into(),
            players: vec![],
            seats: Some(4),
            options: Value::Null,
        },
    );
    h.log.push(&h.b.clone(), t, join("p"));
    // illegal for real-time kinds: game.move
    h.log.push(&h.b.clone(), t, mv("p", 1, json!({ "x": 1 })));
    let scores = |a: i64, b: i64| {
        BTreeMap::from([
            (h.a.to_string(), a),
            (h.b.to_string(), b),
            (h.c.to_string(), 99),
        ])
    };
    h.log.push(
        &h.b.clone(),
        t,
        EventBody::GameResult {
            game_id: "p".into(),
            outcome: "x".into(),
            scores: scores(0, 100),
        },
    );
    let v = view_of(&h, h.a).unwrap();
    assert_eq!(game(&v, "p").status, "active", "only the host may report");
    assert_eq!(game(&v, "p").move_count, 0);
    h.log.push(
        &h.a.clone(),
        t,
        EventBody::GameResult {
            game_id: "p".into(),
            outcome: "rounds_done".into(),
            scores: scores(30, 70),
        },
    );
    let v = view_of(&h, h.a).unwrap();
    let r = game(&v, "p").result.as_ref().unwrap();
    assert_eq!(r["winner"], h.b.to_string());
    assert!(
        r["scores"].get(h.c.to_string()).is_none(),
        "unseated users are dropped"
    );
    let (elo_b, w, _) = elo_of(&v, "pictionary", h.b);
    assert!(elo_b > 1200 && w == 1);
}

#[test]
fn battleship_cheater_forfeits_through_the_fold() {
    let mut h = hall();
    let t = NOW - HOUR;
    h.log.push(&h.a.clone(), t, create("bs", "battleship"));
    h.log.push(&h.b.clone(), t, join("bs"));
    let honest = |row0: usize| {
        let mut b = vec![b'.'; 100];
        for (i, (id, size)) in [(b'a', 5usize), (b'b', 4), (b'c', 3), (b'd', 3), (b'e', 2)]
            .into_iter()
            .enumerate()
        {
            for c in 0..size {
                b[(row0 + i) * 10 + c] = id;
            }
        }
        String::from_utf8(b).unwrap()
    };
    let (board_a, board_b) = (honest(0), honest(5));
    let c = |board: &str| json!({ "commit": games::commit_hash(&["battleship", board, "salt"]) });
    h.log.push(&h.a.clone(), t, mv("bs", 1, c(&board_a)));
    h.log.push(&h.b.clone(), t, mv("bs", 2, c(&board_b)));
    // A shoots B's carrier cell; B lies "miss"
    h.log
        .push(&h.a.clone(), t, mv("bs", 3, json!({ "shot": 50 })));
    h.log
        .push(&h.b.clone(), t, mv("bs", 4, json!({ "res": "miss" })));
    let v = view_of(&h, h.a).unwrap();
    assert_eq!(game(&v, "bs").state["phase"], "play");
    assert_eq!(game(&v, "bs").state["committed"], json!([true, true]));
    // the shared commitment hides both boards: nothing secret is in the projection
    assert!(!serde_json::to_string(&v).unwrap().contains(&board_b));
}

#[test]
fn polls_multi_anonymous_and_close() {
    let mut h = hall();
    let t = NOW - HOUR;
    let a = h.a;
    h.log.push(
        &a,
        t,
        EventBody::PollCreate {
            poll_id: "p1".into(),
            question: "Lunch?".into(),
            options: vec!["Pho".into(), "Tacos".into(), "Salad".into()],
            multi: true,
            anonymous: true,
        },
    );
    h.log.push(
        &h.b.clone(),
        t,
        EventBody::PollVote {
            poll_id: "p1".into(),
            choices: vec![0, 1],
        },
    );
    h.log.push(
        &h.c.clone(),
        t,
        EventBody::PollVote {
            poll_id: "p1".into(),
            choices: vec![1, 1, 9],
        },
    ); // out of range: ignored
    h.log.push(
        &h.c.clone(),
        t,
        EventBody::PollVote {
            poll_id: "p1".into(),
            choices: vec![1],
        },
    );
    h.log.push(
        &h.b.clone(),
        t,
        EventBody::PollClose {
            poll_id: "p1".into(),
        },
    ); // not creator: ignored
    let v = view_of(&h, h.b).unwrap();
    let p = &v.polls[0];
    assert_eq!(p["options"][1]["votes"], 2);
    assert_eq!(p["voters"], 2);
    assert_eq!(p["mine"], json!([0, 1]));
    assert!(p["who"].is_null(), "anonymous polls hide who voted");
    assert_eq!(p["closed"], false);
    h.log.push(
        &a,
        t,
        EventBody::PollClose {
            poll_id: "p1".into(),
        },
    );
    h.log.push(
        &h.c.clone(),
        t,
        EventBody::PollVote {
            poll_id: "p1".into(),
            choices: vec![2],
        },
    );
    let p = &view_of(&h, h.b).unwrap().polls[0];
    assert_eq!(p["closed"], true);
    assert_eq!(p["options"][2]["votes"], 0, "votes after close are ignored");
}

#[test]
fn single_choice_poll_rejects_two_choices() {
    let mut h = hall();
    let t = NOW - HOUR;
    h.log.push(
        &h.a.clone(),
        t,
        EventBody::PollCreate {
            poll_id: "s".into(),
            question: "Q".into(),
            options: vec!["x".into(), "y".into()],
            multi: false,
            anonymous: false,
        },
    );
    h.log.push(
        &h.b.clone(),
        t,
        EventBody::PollVote {
            poll_id: "s".into(),
            choices: vec![0, 1],
        },
    );
    h.log.push(
        &h.c.clone(),
        t,
        EventBody::PollVote {
            poll_id: "s".into(),
            choices: vec![1],
        },
    );
    let p = &view_of(&h, h.a).unwrap().polls[0];
    assert_eq!(p["voters"], 1);
    assert_eq!(p["who"][h.c.to_string()], json!([1]));
}

#[test]
fn quiz_answers_commit_by_hash_and_reveal_scores() {
    let mut h = hall();
    let t = NOW - HOUR;
    let qs = |salts: &[&str; 2]| -> Vec<QuizQuestionIn> {
        [(2u32, "Capital of France?"), (0, "2 + 2 = 4?")]
            .iter()
            .enumerate()
            .map(|(i, (ans, q))| QuizQuestionIn {
                q: (*q).into(),
                options: vec!["a".into(), "b".into(), "c".into()],
                answer_hash: quiz_commitment("z", i, *ans, salts[i]),
            })
            .collect()
    };
    h.log.push(
        &h.a.clone(),
        t,
        EventBody::QuizCreate {
            quiz_id: "z".into(),
            title: "T".into(),
            questions: qs(&["s0", "s1"]),
        },
    );
    h.log.push(
        &h.b.clone(),
        t,
        EventBody::QuizAnswer {
            quiz_id: "z".into(),
            answers: vec![2, 0],
        },
    );
    h.log.push(
        &h.c.clone(),
        t,
        EventBody::QuizAnswer {
            quiz_id: "z".into(),
            answers: vec![1, 0],
        },
    );
    h.log.push(
        &h.a.clone(),
        t,
        EventBody::QuizAnswer {
            quiz_id: "z".into(),
            answers: vec![2, 0],
        },
    ); // host cannot play
    let before = &view_of(&h, h.b).unwrap().quizzes[0];
    assert_eq!(before["answered"], 2);
    assert!(before["correct"].is_null());
    assert!(
        before["everyone"].is_null(),
        "others' answers stay hidden until reveal"
    );
    // wrong salt: ignored. right salts: revealed
    let open = |s0: &str, s1: &str| {
        vec![
            QuizOpenIn {
                answer: 2,
                salt: s0.into(),
            },
            QuizOpenIn {
                answer: 0,
                salt: s1.into(),
            },
        ]
    };
    h.log.push(
        &h.a.clone(),
        t,
        EventBody::QuizReveal {
            quiz_id: "z".into(),
            answers: open("bad", "s1"),
        },
    );
    assert!(view_of(&h, h.b).unwrap().quizzes[0]["correct"].is_null());
    h.log.push(
        &h.b.clone(),
        t,
        EventBody::QuizReveal {
            quiz_id: "z".into(),
            answers: open("s0", "s1"),
        },
    ); // not host
    h.log.push(
        &h.a.clone(),
        t,
        EventBody::QuizReveal {
            quiz_id: "z".into(),
            answers: open("s0", "s1"),
        },
    );
    let q = &view_of(&h, h.b).unwrap().quizzes[0];
    assert_eq!(q["correct"], json!([2, 0]));
    assert_eq!(q["scores"][0]["user"], h.b.to_string());
    assert_eq!(q["scores"][0]["score"], 2);
    assert_eq!(q["scores"][1]["score"], 1);
}

#[test]
fn kudos_and_standups() {
    let mut h = hall();
    let t = NOW - HOUR;
    let give = |to: UserId, reason: &str| EventBody::KudosGive {
        to: to.to_string(),
        reason: reason.into(),
        emoji: "x".into(),
    };
    h.log.push(&h.a.clone(), t, give(h.b, "great demo"));
    h.log.push(&h.a.clone(), t, give(h.a, "me")); // self kudos ignored
    h.log.push(&h.a.clone(), t, give(h.b, "   ")); // empty reason ignored
    let (ghost, _) = user();
    h.log
        .push(&h.a.clone(), t, give(ghost.user_id(), "stranger")); // non member
    let stand = |day: &str, today: &str| EventBody::StandupPost {
        day: day.into(),
        yesterday: "y".into(),
        today: today.into(),
        blockers: String::new(),
    };
    h.log.push(&h.b.clone(), t, stand("2026-10-14", "first"));
    h.log.push(&h.b.clone(), t, stand("2026-10-14", "second"));
    h.log.push(&h.b.clone(), t, stand("tomorrow", "bad day"));
    h.log.push(&h.c.clone(), t, stand("2026-10-14", "c today"));
    let v = view_of(&h, h.a).unwrap();
    assert_eq!(v.kudos.len(), 1);
    assert_eq!(v.kudos[0]["reason"], "great demo");
    assert_eq!(v.standups.len(), 1);
    let posts = v.standups[0]["posts"].as_array().unwrap();
    assert_eq!(posts.len(), 2);
    assert!(posts.iter().any(|p| p["today"] == "second"));
}

#[test]
fn waiting_games_light_the_sign_and_invites_seat_players() {
    let mut h = hall();
    let t = NOW - HOUR;
    h.log.push(&h.a.clone(), t, create("open", "go9"));
    let v = view_of(&h, h.b).unwrap();
    assert_eq!(v.waiting, 1);
    assert_eq!(game(&v, "open").status, "waiting");
    h.log.push(&h.b.clone(), t, join("open"));
    assert_eq!(view_of(&h, h.b).unwrap().waiting, 0);
    // a challenge names both players
    h.log.push(
        &h.a.clone(),
        t,
        EventBody::GameCreate {
            game_id: "ch".into(),
            kind: "checkers".into(),
            title: String::new(),
            players: vec![h.a.to_string(), h.c.to_string()],
            seats: None,
            options: Value::Null,
        },
    );
    let g = view_of(&h, h.c).unwrap();
    assert_eq!(game(&g, "ch").status, "active");
    assert_eq!(game(&g, "ch").my_seat, Some(1));
    // bad creations are ignored: wrong seat count, stranger seated, unknown kind
    let bad =
        |id: &str, kind: &str, players: Vec<String>, seats: Option<u8>| EventBody::GameCreate {
            game_id: id.into(),
            kind: kind.into(),
            title: String::new(),
            players,
            seats,
            options: Value::Null,
        };
    h.log
        .push(&h.a.clone(), t, bad("b1", "chess", vec![], Some(3)));
    h.log.push(
        &h.a.clone(),
        t,
        bad("b2", "chess", vec![user().1.to_string()], None),
    );
    h.log.push(&h.a.clone(), t, bad("b3", "nope", vec![], None));
    let ids: Vec<String> = view_of(&h, h.a)
        .unwrap()
        .games
        .iter()
        .map(|g| g.id.clone())
        .collect();
    assert!(!ids.iter().any(|i| i.starts_with('b')), "{ids:?}");
}

#[test]
fn non_members_and_guests_cannot_play() {
    let mut h = hall();
    let t = NOW - HOUR;
    let (_, stranger) = user();
    h.log.push(&stranger, t, create("s", "chess"));
    h.log.push(&h.a.clone(), t, create("g", "chess"));
    h.log.push(&stranger, t, join("g"));
    let v = view_of(&h, h.a).unwrap();
    assert_eq!(v.games.len(), 1);
    assert_eq!(game(&v, "g").status, "waiting");
}
