//! Chess with full rules: legal move generation, castling, en passant, promotion,
//! check, checkmate, stalemate, insufficient material, 50-move and threefold repetition.
//!
//! Board: 64 squares, index `rank * 8 + file` (a1 = 0, h8 = 63); pieces are `+kind` for white
//! and `-kind` for black with kind 1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king.
//! Moves are `{"from":"e2","to":"e4","promo":"q"}`; the UI also gets them as UCI strings.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::{GameRules, Outcome, str_field};

const START_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FIFTY_MOVE_HALFMOVES: u32 = 100;
const REPETITIONS: u8 = 3;
const WK: u8 = 1;
const WQ: u8 = 2;
const BK: u8 = 4;
const BQ: u8 = 8;
const KNIGHT_STEPS: [(i8, i8); 8] = [
    (1, 2),
    (2, 1),
    (2, -1),
    (1, -2),
    (-1, -2),
    (-2, -1),
    (-2, 1),
    (-1, 2),
];
const KING_STEPS: [(i8, i8); 8] = [
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
    (0, -1),
    (1, -1),
];
const ROOK_DIRS: [(i8, i8); 4] = [(1, 0), (0, 1), (-1, 0), (0, -1)];
const BISHOP_DIRS: [(i8, i8); 4] = [(1, 1), (-1, 1), (-1, -1), (1, -1)];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mv {
    pub from: u8,
    pub to: u8,
    /// Promotion piece kind (2..=5) or 0.
    pub promo: u8,
}

#[derive(Debug, Clone)]
pub struct Chess {
    board: [i8; 64],
    /// 0 white to move, 1 black.
    side: usize,
    castling: u8,
    ep: Option<u8>,
    halfmove: u32,
    fullmove: u32,
    seen: BTreeMap<Vec<u8>, u8>,
    over: Option<Outcome>,
}

fn sq_name(s: u8) -> String {
    format!("{}{}", (b'a' + s % 8) as char, s / 8 + 1)
}

fn parse_sq(s: &str) -> Option<u8> {
    let b = s.as_bytes();
    if b.len() != 2 || !(b'a'..=b'h').contains(&b[0]) || !(b'1'..=b'8').contains(&b[1]) {
        return None;
    }
    Some((b[1] - b'1') * 8 + (b[0] - b'a'))
}

fn promo_char(k: u8) -> &'static str {
    match k {
        2 => "n",
        3 => "b",
        4 => "r",
        5 => "q",
        _ => "",
    }
}

fn promo_kind(c: &str) -> Option<u8> {
    match c {
        "" => Some(0),
        "n" => Some(2),
        "b" => Some(3),
        "r" => Some(4),
        "q" => Some(5),
        _ => None,
    }
}

fn step(sq: u8, df: i8, dr: i8) -> Option<u8> {
    let f = (sq % 8) as i8 + df;
    let r = (sq / 8) as i8 + dr;
    ((0..8).contains(&f) && (0..8).contains(&r)).then(|| (r * 8 + f) as u8)
}

fn sign(side: usize) -> i8 {
    if side == 0 { 1 } else { -1 }
}

impl Mv {
    pub fn uci(&self) -> String {
        format!(
            "{}{}{}",
            sq_name(self.from),
            sq_name(self.to),
            promo_char(self.promo)
        )
    }
}

impl Chess {
    pub fn start() -> Self {
        Self::from_fen(START_FEN).expect("start fen")
    }

    pub fn from_fen(fen: &str) -> Result<Self, String> {
        let mut parts = fen.split_whitespace();
        let rows = parts.next().ok_or("empty fen")?;
        let mut board = [0i8; 64];
        let ranks: Vec<&str> = rows.split('/').collect();
        if ranks.len() != 8 {
            return Err("fen needs 8 ranks".into());
        }
        for (i, row) in ranks.iter().enumerate() {
            let rank = 7 - i;
            let mut file = 0usize;
            for c in row.chars() {
                if let Some(n) = c.to_digit(10) {
                    file += n as usize;
                    continue;
                }
                let kind = match c.to_ascii_lowercase() {
                    'p' => 1,
                    'n' => 2,
                    'b' => 3,
                    'r' => 4,
                    'q' => 5,
                    'k' => 6,
                    _ => return Err("bad fen piece".into()),
                };
                if file >= 8 {
                    return Err("fen rank too long".into());
                }
                board[rank * 8 + file] = if c.is_ascii_uppercase() { kind } else { -kind };
                file += 1;
            }
            if file != 8 {
                return Err("fen rank length".into());
            }
        }
        let side = match parts.next().unwrap_or("w") {
            "w" => 0,
            "b" => 1,
            _ => return Err("bad side".into()),
        };
        let mut castling = 0;
        for c in parts.next().unwrap_or("-").chars() {
            castling |= match c {
                'K' => WK,
                'Q' => WQ,
                'k' => BK,
                'q' => BQ,
                _ => 0,
            };
        }
        let ep = match parts.next().unwrap_or("-") {
            "-" => None,
            s => Some(parse_sq(s).ok_or("bad ep square")?),
        };
        let halfmove = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let fullmove = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1);
        let mut g = Chess {
            board,
            side,
            castling,
            ep,
            halfmove,
            fullmove,
            seen: BTreeMap::new(),
            over: None,
        };
        g.record_position();
        g.settle();
        Ok(g)
    }

    pub fn fen(&self) -> String {
        let mut out = String::new();
        for rank in (0..8).rev() {
            let mut empty = 0;
            for file in 0..8 {
                let p = self.board[rank * 8 + file];
                if p == 0 {
                    empty += 1;
                    continue;
                }
                if empty > 0 {
                    out.push_str(&empty.to_string());
                    empty = 0;
                }
                let c = ['p', 'n', 'b', 'r', 'q', 'k'][p.unsigned_abs() as usize - 1];
                out.push(if p > 0 { c.to_ascii_uppercase() } else { c });
            }
            if empty > 0 {
                out.push_str(&empty.to_string());
            }
            if rank > 0 {
                out.push('/');
            }
        }
        let mut cast = String::new();
        for (bit, c) in [(WK, 'K'), (WQ, 'Q'), (BK, 'k'), (BQ, 'q')] {
            if self.castling & bit != 0 {
                cast.push(c);
            }
        }
        if cast.is_empty() {
            cast.push('-');
        }
        let ep = self.ep.map_or("-".to_string(), sq_name);
        format!(
            "{out} {} {cast} {ep} {} {}",
            if self.side == 0 { 'w' } else { 'b' },
            self.halfmove,
            self.fullmove
        )
    }

    fn king_sq(&self, side: usize) -> Option<u8> {
        let k = 6 * sign(side);
        self.board.iter().position(|&p| p == k).map(|i| i as u8)
    }

    /// True when `sq` is attacked by any piece of `by`.
    fn attacked(&self, sq: u8, by: usize) -> bool {
        let s = sign(by);
        // pawns attack forward: a pawn of `by` at sq - dr attacks sq
        for df in [-1, 1] {
            if let Some(from) = step(sq, df, -s)
                && self.board[from as usize] == s
            {
                return true;
            }
        }
        for (df, dr) in KNIGHT_STEPS {
            if let Some(from) = step(sq, df, dr)
                && self.board[from as usize] == 2 * s
            {
                return true;
            }
        }
        for (df, dr) in KING_STEPS {
            if let Some(from) = step(sq, df, dr)
                && self.board[from as usize] == 6 * s
            {
                return true;
            }
        }
        for (dirs, kinds) in [(ROOK_DIRS, [4, 5]), (BISHOP_DIRS, [3, 5])] {
            for (df, dr) in dirs {
                let mut cur = sq;
                while let Some(n) = step(cur, df, dr) {
                    let p = self.board[n as usize];
                    if p != 0 {
                        if p * s > 0 && kinds.contains(&p.abs()) {
                            return true;
                        }
                        break;
                    }
                    cur = n;
                }
            }
        }
        false
    }

    pub fn in_check(&self, side: usize) -> bool {
        self.king_sq(side)
            .is_some_and(|k| self.attacked(k, 1 - side))
    }

    fn pseudo_moves(&self) -> Vec<Mv> {
        let mut out = Vec::with_capacity(48);
        let s = sign(self.side);
        for from in 0..64u8 {
            let p = self.board[from as usize];
            if p * s <= 0 {
                continue;
            }
            match p.abs() {
                1 => self.pawn_moves(from, &mut out),
                2 => self.step_moves(from, &KNIGHT_STEPS, &mut out),
                3 => self.slide_moves(from, &BISHOP_DIRS, &mut out),
                4 => self.slide_moves(from, &ROOK_DIRS, &mut out),
                5 => {
                    self.slide_moves(from, &ROOK_DIRS, &mut out);
                    self.slide_moves(from, &BISHOP_DIRS, &mut out);
                }
                _ => {
                    self.step_moves(from, &KING_STEPS, &mut out);
                    self.castle_moves(from, &mut out);
                }
            }
        }
        out
    }

    fn push_pawn(from: u8, to: u8, out: &mut Vec<Mv>) {
        if to / 8 == 0 || to / 8 == 7 {
            for promo in [5, 4, 3, 2] {
                out.push(Mv { from, to, promo });
            }
        } else {
            out.push(Mv { from, to, promo: 0 });
        }
    }

    fn pawn_moves(&self, from: u8, out: &mut Vec<Mv>) {
        let s = sign(self.side);
        let start_rank = if self.side == 0 { 1 } else { 6 };
        if let Some(one) = step(from, 0, s)
            && self.board[one as usize] == 0
        {
            Self::push_pawn(from, one, out);
            if from / 8 == start_rank
                && let Some(two) = step(from, 0, 2 * s)
                && self.board[two as usize] == 0
            {
                out.push(Mv {
                    from,
                    to: two,
                    promo: 0,
                });
            }
        }
        for df in [-1, 1] {
            let Some(to) = step(from, df, s) else {
                continue;
            };
            let target = self.board[to as usize];
            if target * s < 0 || (target == 0 && self.ep == Some(to)) {
                Self::push_pawn(from, to, out);
            }
        }
    }

    fn step_moves(&self, from: u8, steps: &[(i8, i8)], out: &mut Vec<Mv>) {
        let s = sign(self.side);
        for &(df, dr) in steps {
            if let Some(to) = step(from, df, dr)
                && self.board[to as usize] * s <= 0
            {
                out.push(Mv { from, to, promo: 0 });
            }
        }
    }

    fn slide_moves(&self, from: u8, dirs: &[(i8, i8)], out: &mut Vec<Mv>) {
        let s = sign(self.side);
        for &(df, dr) in dirs {
            let mut cur = from;
            while let Some(to) = step(cur, df, dr) {
                let t = self.board[to as usize];
                if t * s > 0 {
                    break;
                }
                out.push(Mv { from, to, promo: 0 });
                if t != 0 {
                    break;
                }
                cur = to;
            }
        }
    }

    fn castle_moves(&self, from: u8, out: &mut Vec<Mv>) {
        let (home, king_bit, queen_bit) = if self.side == 0 {
            (4, WK, WQ)
        } else {
            (60, BK, BQ)
        };
        if from != home {
            return;
        }
        let them = 1 - self.side;
        let rook = 4 * sign(self.side);
        let b = |o: i8| self.board[(home as i8 + o) as usize];
        if self.castling & king_bit != 0
            && b(1) == 0
            && b(2) == 0
            && b(3) == rook
            && !self.attacked(home, them)
            && !self.attacked(home + 1, them)
        {
            out.push(Mv {
                from,
                to: home + 2,
                promo: 0,
            });
        }
        if self.castling & queen_bit != 0
            && b(-1) == 0
            && b(-2) == 0
            && b(-3) == 0
            && b(-4) == rook
            && !self.attacked(home, them)
            && !self.attacked(home - 1, them)
        {
            out.push(Mv {
                from,
                to: home - 2,
                promo: 0,
            });
        }
    }

    /// Board after `m`, assuming it is pseudo-legal. Returns the new position without history.
    fn make(&self, m: Mv) -> Chess {
        let mut n = self.clone();
        let piece = n.board[m.from as usize];
        let s = sign(self.side);
        let captured = n.board[m.to as usize];
        n.board[m.from as usize] = 0;
        n.board[m.to as usize] = if m.promo != 0 {
            m.promo as i8 * s
        } else {
            piece
        };
        if piece.abs() == 1 && captured == 0 && m.from % 8 != m.to % 8 {
            // en passant: the captured pawn sits behind the target square
            n.board[(m.to as i8 - 8 * s) as usize] = 0;
        }
        if piece.abs() == 6 && (m.to as i8 - m.from as i8).abs() == 2 {
            let (rook_from, rook_to) = if m.to > m.from {
                (m.to + 1, m.to - 1)
            } else {
                (m.to - 2, m.to + 1)
            };
            n.board[rook_to as usize] = n.board[rook_from as usize];
            n.board[rook_from as usize] = 0;
        }
        for sq in [m.from, m.to] {
            n.castling &= match sq {
                4 => !(WK | WQ),
                0 => !WQ,
                7 => !WK,
                60 => !(BK | BQ),
                56 => !BQ,
                63 => !BK,
                _ => 0xff,
            };
        }
        n.ep = (piece.abs() == 1 && (m.to as i8 - m.from as i8).abs() == 16)
            .then(|| ((m.to as i8 + m.from as i8) / 2) as u8);
        n.halfmove = if piece.abs() == 1 || captured != 0 {
            0
        } else {
            n.halfmove + 1
        };
        if self.side == 1 {
            n.fullmove += 1;
        }
        n.side = 1 - self.side;
        n
    }

    pub fn legal_moves(&self) -> Vec<Mv> {
        self.pseudo_moves()
            .into_iter()
            .filter(|&m| !self.make(m).in_check(self.side))
            .collect()
    }

    fn position_key(&self) -> Vec<u8> {
        let mut k: Vec<u8> = self.board.iter().map(|&p| p as u8).collect();
        k.push(self.side as u8);
        k.push(self.castling);
        // en passant only matters for repetition when a capture is actually possible
        let ep_live = self.ep.filter(|&e| {
            self.legal_moves().iter().any(|m| {
                m.to == e
                    && self.board[m.from as usize].abs() == 1
                    && self.board[m.to as usize] == 0
                    && m.from % 8 != m.to % 8
            })
        });
        k.push(ep_live.unwrap_or(255));
        k
    }

    fn record_position(&mut self) {
        let key = self.position_key();
        *self.seen.entry(key).or_insert(0) += 1;
    }

    fn insufficient_material(&self) -> bool {
        let mut minors = 0;
        for &p in &self.board {
            match p.abs() {
                0 | 6 => {}
                2 | 3 => minors += 1,
                _ => return false,
            }
        }
        minors <= 1
    }

    fn settle(&mut self) {
        let legal = self.legal_moves();
        self.over = if legal.is_empty() {
            Some(if self.in_check(self.side) {
                Outcome::win(1 - self.side, "checkmate")
            } else {
                Outcome::draw("stalemate")
            })
        } else if self.insufficient_material() {
            Some(Outcome::draw("insufficient_material"))
        } else if self.seen.get(&self.position_key()).copied().unwrap_or(0) >= REPETITIONS {
            Some(Outcome::draw("threefold"))
        } else if self.halfmove >= FIFTY_MOVE_HALFMOVES {
            Some(Outcome::draw("fifty_moves"))
        } else {
            None
        };
    }

    fn parse_move(&self, mv: &Value) -> Result<Mv, String> {
        let from = str_field(mv, "from")
            .and_then(parse_sq)
            .ok_or("bad from square")?;
        let to = str_field(mv, "to")
            .and_then(parse_sq)
            .ok_or("bad to square")?;
        let promo = promo_kind(str_field(mv, "promo").unwrap_or("")).ok_or("bad promotion")?;
        let m = Mv { from, to, promo };
        if self.legal_moves().contains(&m) {
            Ok(m)
        } else {
            Err("illegal move".into())
        }
    }

    /// Counts leaf nodes at `depth` (move generator test).
    pub fn perft(&self, depth: u32) -> u64 {
        if depth == 0 {
            return 1;
        }
        let moves = self.legal_moves();
        if depth == 1 {
            return moves.len() as u64;
        }
        moves
            .into_iter()
            .map(|m| self.make(m).perft(depth - 1))
            .sum()
    }
}

impl GameRules for Chess {
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
        self.parse_move(mv).map(|_| ())
    }

    fn apply(&mut self, seat: usize, mv: &Value) -> Result<(), String> {
        self.validate(seat, mv)?;
        let m = self.parse_move(mv)?;
        let mut next = self.make(m);
        next.seen = std::mem::take(&mut self.seen);
        next.record_position();
        next.settle();
        *self = next;
        Ok(())
    }

    fn outcome(&self) -> Option<Outcome> {
        self.over.clone()
    }

    fn view(&self) -> Value {
        let legal: Vec<String> = if self.over.is_none() {
            self.legal_moves().iter().map(Mv::uci).collect()
        } else {
            Vec::new()
        };
        json!({
            "fen": self.fen(),
            "turn": self.side,
            "check": self.in_check(self.side),
            "legal": legal,
        })
    }
}

pub fn init(_game_id: &str, _options: &Value) -> Result<Box<dyn GameRules>, String> {
    Ok(Box::new(Chess::start()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play(g: &mut Chess, ucis: &[&str]) {
        for u in ucis {
            let seat = g.side;
            let mv = json!({"from": &u[0..2], "to": &u[2..4], "promo": u.get(4..5).unwrap_or("")});
            g.apply(seat, &mv).unwrap_or_else(|e| panic!("{u}: {e}"));
        }
    }

    #[test]
    fn perft_start_position() {
        let g = Chess::start();
        assert_eq!(g.perft(1), 20);
        assert_eq!(g.perft(2), 400);
        assert_eq!(g.perft(3), 8902);
        assert_eq!(g.perft(4), 197_281);
    }

    #[test]
    fn perft_kiwipete() {
        let g =
            Chess::from_fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1")
                .unwrap();
        assert_eq!(g.perft(1), 48);
        assert_eq!(g.perft(2), 2039);
        assert_eq!(g.perft(3), 97_862);
    }

    #[test]
    fn perft_endgame_and_promotions() {
        // position 3 (en passant pins) and position 4 (promotions, castling through check)
        let p3 = Chess::from_fen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1").unwrap();
        assert_eq!((p3.perft(1), p3.perft(2), p3.perft(4)), (14, 191, 43_238));
        let p4 =
            Chess::from_fen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1")
                .unwrap();
        assert_eq!((p4.perft(1), p4.perft(2), p4.perft(3)), (6, 264, 9467));
        let p5 =
            Chess::from_fen("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8").unwrap();
        assert_eq!((p5.perft(1), p5.perft(2), p5.perft(3)), (44, 1486, 62_379));
    }

    #[test]
    fn scholars_mate() {
        let mut g = Chess::start();
        play(
            &mut g,
            &["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"],
        );
        assert_eq!(g.outcome(), Some(Outcome::win(0, "checkmate")));
        assert!(g.turn().is_none());
        assert!(g.apply(1, &json!({"from":"a7","to":"a6"})).is_err());
    }

    #[test]
    fn illegal_and_out_of_turn_rejected_without_change() {
        let mut g = Chess::start();
        let before = g.fen();
        assert!(g.apply(0, &json!({"from":"e2","to":"e5"})).is_err());
        assert!(g.apply(1, &json!({"from":"e7","to":"e5"})).is_err());
        assert!(g.apply(0, &json!({"from":"zz","to":"e4"})).is_err());
        assert!(
            g.apply(0, &json!({"from":"e2","to":"e4","promo":"x"}))
                .is_err()
        );
        assert_eq!(g.fen(), before);
    }

    #[test]
    fn castling_en_passant_promotion() {
        let mut g = Chess::from_fen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1").unwrap();
        play(&mut g, &["e1g1", "e8c8"]);
        assert_eq!(g.fen(), "2kr3r/8/8/8/8/8/8/R4RK1 w - - 2 2");
        // cannot castle through an attacked square
        let g = Chess::from_fen("r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1").unwrap();
        assert!(!g.legal_moves().iter().any(|m| m.uci() == "e1g1"));
        // en passant
        let mut g = Chess::start();
        play(&mut g, &["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]);
        assert_eq!(g.board[parse_sq("d5").unwrap() as usize], 0);
        assert_eq!(g.board[parse_sq("d6").unwrap() as usize], 1);
        // promotion needs a piece and can be any of four
        let mut g = Chess::from_fen("8/P6k/8/8/8/8/8/K7 w - - 0 1").unwrap();
        assert_eq!(g.legal_moves().iter().filter(|m| m.from == 48).count(), 4);
        assert!(g.apply(0, &json!({"from":"a7","to":"a8"})).is_err());
        play(&mut g, &["a7a8n"]);
        assert_eq!(g.board[56], 2);
    }

    #[test]
    fn stalemate_and_insufficient_material() {
        let g = Chess::from_fen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").unwrap();
        assert_eq!(g.outcome(), Some(Outcome::draw("stalemate")));
        let g = Chess::from_fen("7k/8/6K1/8/8/8/8/6B1 w - - 0 1").unwrap();
        assert_eq!(g.outcome(), Some(Outcome::draw("insufficient_material")));
    }

    #[test]
    fn fifty_move_rule() {
        let mut g = Chess::from_fen("4k3/8/8/8/8/8/8/R3K3 w - - 98 80").unwrap();
        assert!(g.outcome().is_none());
        play(&mut g, &["a1a2", "e8e7"]);
        assert_eq!(g.outcome(), Some(Outcome::draw("fifty_moves")));
    }

    #[test]
    fn threefold_repetition() {
        let mut g = Chess::start();
        let cycle = ["g1f3", "g8f6", "f3g1", "f6g8"];
        play(&mut g, &cycle);
        assert!(g.outcome().is_none());
        play(&mut g, &cycle);
        assert_eq!(g.outcome(), Some(Outcome::draw("threefold")));
    }

    #[test]
    fn view_lists_legal_moves_for_ui() {
        let v = Chess::start().view();
        assert_eq!(v["legal"].as_array().unwrap().len(), 20);
        assert_eq!(v["turn"], 0);
    }
}
