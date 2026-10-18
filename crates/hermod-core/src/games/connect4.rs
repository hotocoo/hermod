//! Connect four on a 7 x 6 board. Move `{"col": 0..6}`; seat 0 plays first.

use serde_json::{Value, json};

use super::{GameRules, Outcome};

const COLS: usize = 7;
const ROWS: usize = 6;
const WIN: usize = 4;

#[derive(Debug, Clone, Default)]
struct C4 {
    /// `cells[col][row]`, row 0 at the bottom.
    cells: [[Option<u8>; ROWS]; COLS],
    moves: usize,
    over: Option<Outcome>,
}

fn col_of(mv: &Value) -> Result<usize, String> {
    let c = mv
        .get("col")
        .and_then(Value::as_u64)
        .ok_or("move needs a col")?;
    (c < COLS as u64)
        .then_some(c as usize)
        .ok_or_else(|| "column out of range".into())
}

impl C4 {
    fn wins(&self, col: usize, row: usize, who: u8) -> bool {
        [(1i32, 0i32), (0, 1), (1, 1), (1, -1)]
            .iter()
            .any(|&(dc, dr)| {
                let run = |sign: i32| {
                    (1..WIN as i32)
                        .take_while(|k| {
                            let (c, r) = (col as i32 + sign * k * dc, row as i32 + sign * k * dr);
                            (0..COLS as i32).contains(&c)
                                && (0..ROWS as i32).contains(&r)
                                && self.cells[c as usize][r as usize] == Some(who)
                        })
                        .count()
                };
                1 + run(1) + run(-1) >= WIN
            })
    }
}

impl GameRules for C4 {
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
        if self.cells[col_of(mv)?][ROWS - 1].is_some() {
            return Err("column full".into());
        }
        Ok(())
    }

    fn apply(&mut self, seat: usize, mv: &Value) -> Result<(), String> {
        self.validate(seat, mv)?;
        let col = col_of(mv)?;
        let row = self.cells[col]
            .iter()
            .position(Option::is_none)
            .expect("checked not full");
        self.cells[col][row] = Some(seat as u8);
        self.moves += 1;
        self.over = if self.wins(col, row, seat as u8) {
            Some(Outcome::win(seat, "four_in_row"))
        } else if self.moves == COLS * ROWS {
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
            (0..COLS)
                .filter(|&c| self.cells[c][ROWS - 1].is_none())
                .collect()
        } else {
            Vec::new()
        };
        json!({ "cells": self.cells, "legal": legal, "cols": COLS, "rows": ROWS })
    }
}

pub fn init(_game_id: &str, _options: &Value) -> Result<Box<dyn GameRules>, String> {
    Ok(Box::new(C4::default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drop(g: &mut C4, seat: usize, col: usize) -> Result<(), String> {
        g.apply(seat, &json!({ "col": col }))
    }

    #[test]
    fn vertical_win() {
        let mut g = C4::default();
        for i in 0..3 {
            drop(&mut g, 0, 0).unwrap();
            drop(&mut g, 1, 1).unwrap();
            assert!(g.outcome().is_none(), "round {i}");
        }
        drop(&mut g, 0, 0).unwrap();
        assert_eq!(g.outcome(), Some(Outcome::win(0, "four_in_row")));
    }

    #[test]
    fn diagonal_win_and_full_column() {
        let mut g = C4::default();
        // seat 0 climbs the diagonal (0,0) (1,1) (2,2) (3,3) while seat 1 fills below it
        for (i, c) in [0usize, 1, 1, 2, 3, 2, 2, 3, 6, 3, 3]
            .into_iter()
            .enumerate()
        {
            if g.outcome().is_some() {
                break;
            }
            drop(&mut g, i % 2, c).unwrap();
        }
        assert_eq!(g.outcome(), Some(Outcome::win(0, "four_in_row")));
        let mut g = C4::default();
        for i in 0..ROWS {
            drop(&mut g, i % 2, 0).unwrap();
        }
        assert!(drop(&mut g, 0, 0).is_err(), "full column");
        assert!(drop(&mut g, 0, 7).is_err(), "range");
        assert!(drop(&mut g, 1, 1).is_err(), "turn");
    }
}
