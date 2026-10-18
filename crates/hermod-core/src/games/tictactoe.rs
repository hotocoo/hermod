//! Tic-tac-toe. Move `{"cell": 0..8}`; seat 0 plays X.

use serde_json::{Value, json};

use super::{GameRules, Outcome};

const LINES: [[usize; 3]; 8] = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
];

#[derive(Debug, Clone, Default)]
struct Ttt {
    cells: [Option<u8>; 9],
    moves: usize,
    over: Option<Outcome>,
}

fn cell_of(mv: &Value) -> Result<usize, String> {
    let c = mv
        .get("cell")
        .and_then(Value::as_u64)
        .ok_or("move needs a cell")?;
    (c < 9)
        .then_some(c as usize)
        .ok_or_else(|| "cell out of range".into())
}

impl GameRules for Ttt {
    fn seats(&self) -> usize {
        2
    }

    fn turn(&self) -> Option<usize> {
        self.over.is_none().then_some(self.moves % 2)
    }

    fn validate(&self, seat: usize, mv: &Value) -> Result<(), String> {
        if self.over.is_some() {
            return Err("game over".into());
        }
        if seat != self.moves % 2 {
            return Err("not your turn".into());
        }
        if self.cells[cell_of(mv)?].is_some() {
            return Err("cell taken".into());
        }
        Ok(())
    }

    fn apply(&mut self, seat: usize, mv: &Value) -> Result<(), String> {
        self.validate(seat, mv)?;
        self.cells[cell_of(mv)?] = Some(seat as u8);
        self.moves += 1;
        let won = LINES
            .iter()
            .any(|l| l.iter().all(|&i| self.cells[i] == Some(seat as u8)));
        self.over = if won {
            Some(Outcome::win(seat, "three_in_row"))
        } else if self.moves == 9 {
            Some(Outcome::draw("full_board"))
        } else {
            None
        };
        Ok(())
    }

    fn outcome(&self) -> Option<Outcome> {
        self.over.clone()
    }

    fn view(&self) -> Value {
        let legal: Vec<usize> = if self.over.is_none() {
            (0..9).filter(|&i| self.cells[i].is_none()).collect()
        } else {
            Vec::new()
        };
        json!({ "cells": self.cells, "legal": legal })
    }
}

pub fn init(_game_id: &str, _options: &Value) -> Result<Box<dyn GameRules>, String> {
    Ok(Box::new(Ttt::default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mv(c: usize) -> Value {
        json!({ "cell": c })
    }

    #[test]
    fn row_win_and_rejections() {
        let mut g = Ttt::default();
        assert!(g.apply(1, &mv(0)).is_err());
        for (seat, c) in [(0, 0), (1, 3), (0, 1), (1, 4)] {
            g.apply(seat, &mv(c)).unwrap();
        }
        assert!(g.apply(0, &mv(3)).is_err(), "taken");
        assert!(g.apply(0, &mv(9)).is_err(), "range");
        g.apply(0, &mv(2)).unwrap();
        assert_eq!(g.outcome(), Some(Outcome::win(0, "three_in_row")));
        assert!(g.apply(1, &mv(5)).is_err());
    }

    #[test]
    fn full_board_draws() {
        let mut g = Ttt::default();
        // X O X / X O O / O X X
        for (i, c) in [0, 1, 2, 4, 3, 5, 7, 6, 8].into_iter().enumerate() {
            g.apply(i % 2, &mv(c)).unwrap();
        }
        assert_eq!(g.outcome(), Some(Outcome::draw("full_board")));
    }
}
