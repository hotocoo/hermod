//! Full-text search over decrypted content, backed by a local SQLite FTS5 table.
//!
//! The index is derived: it is rebuilt per space from the folded projection whenever the space's
//! applied-event count differs from the stored stamp, so it honours edits, deletes, moderation
//! removals and authorization exactly like the UI does. Blocked authors are filtered at query time.

use std::collections::BTreeSet;

use rusqlite::{Connection, params, params_from_iter};
use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::ids::SpaceId;

/// Marks the start of a highlighted match in [`SearchHit::snippet`].
pub const HIT_OPEN: char = '\u{1}';
/// Marks the end of a highlighted match.
pub const HIT_CLOSE: char = '\u{2}';

const SNIPPET_TOKENS: i64 = 12;

/// One indexable thing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchItem {
    /// `message`, `post`, `doc`, `card`, `snap` or `event`.
    pub kind: &'static str,
    pub id: String,
    pub author: String,
    pub ts: i64,
    pub channel: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchHit {
    pub kind: String,
    /// Space id (hex).
    pub space: String,
    pub id: String,
    pub channel: String,
    pub author: String,
    pub ts: i64,
    /// Text around the match with [`HIT_OPEN`] and [`HIT_CLOSE`] around each hit.
    pub snippet: String,
}

pub fn is_stale(conn: &Connection, space: &SpaceId, stamp: u64) -> Result<bool> {
    let have: Option<i64> = conn
        .query_row(
            "SELECT stamp FROM search_state WHERE space_id = ?1",
            [&space.0[..]],
            |r| r.get(0),
        )
        .ok();
    Ok(have != Some(stamp as i64))
}

/// Replaces every row of `space` with `items` and records `stamp`.
pub fn reindex(
    conn: &mut Connection,
    space: &SpaceId,
    items: &[SearchItem],
    stamp: u64,
) -> Result<()> {
    let tx = conn.transaction()?;
    let sid = &space.0[..];
    tx.execute("DELETE FROM search WHERE space_id = ?1", [sid])?;
    {
        let mut ins = tx.prepare("INSERT INTO search(text, kind, space_id, ref, author, ts, channel) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")?;
        for it in items.iter().filter(|i| !i.text.trim().is_empty()) {
            ins.execute(params![
                it.text, it.kind, sid, it.id, it.author, it.ts, it.channel
            ])?;
        }
    }
    tx.execute(
        "INSERT INTO search_state(space_id, stamp) VALUES (?1, ?2) ON CONFLICT(space_id) DO UPDATE SET stamp = excluded.stamp",
        params![sid, stamp as i64],
    )?;
    tx.commit()?;
    Ok(())
}

/// Turns free text into an FTS5 expression: every word must match, the last as a prefix.
pub fn match_expr(q: &str) -> Option<String> {
    let words: Vec<String> = q
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect();
    let last = words.len().checked_sub(1)?;
    Some(
        words
            .iter()
            .enumerate()
            .map(|(i, w)| {
                if i == last {
                    format!("\"{w}\"*")
                } else {
                    format!("\"{w}\"")
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
    )
}

/// Ranked hits. `spaces` limits the search to those spaces (callers pass only joined ones).
pub fn query(
    conn: &Connection,
    q: &str,
    spaces: &[SpaceId],
    kinds: &[String],
    blocked: &BTreeSet<String>,
    limit: usize,
) -> Result<Vec<SearchHit>> {
    let Some(expr) = match_expr(q) else {
        return Ok(Vec::new());
    };
    if spaces.is_empty() {
        return Ok(Vec::new());
    }
    let mut sql = format!(
        "SELECT kind, space_id, ref, channel, author, ts, snippet(search, 0, char(1), char(2), '\u{2026}', {SNIPPET_TOKENS})
         FROM search WHERE search MATCH ?1 AND space_id IN ({})",
        vec!["?"; spaces.len()].join(",")
    );
    if !kinds.is_empty() {
        sql.push_str(&format!(
            " AND kind IN ({})",
            vec!["?"; kinds.len()].join(",")
        ));
    }
    sql.push_str(" ORDER BY rank LIMIT ?");
    let mut args: Vec<rusqlite::types::Value> = vec![expr.into()];
    args.extend(
        spaces
            .iter()
            .map(|s| rusqlite::types::Value::Blob(s.0.to_vec())),
    );
    args.extend(
        kinds
            .iter()
            .map(|k| rusqlite::types::Value::Text(k.clone())),
    );
    // Over-fetch so filtering blocked authors still fills the page.
    args.push(((limit + blocked.len() * 8).max(limit) as i64).into());
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(params_from_iter(args), |r| {
        let sid: Vec<u8> = r.get(1)?;
        Ok(SearchHit {
            kind: r.get(0)?,
            space: crate::ids::hex_encode(&sid),
            id: r.get(2)?,
            channel: r.get(3)?,
            author: r.get(4)?,
            ts: r.get(5)?,
            snippet: r.get(6)?,
        })
    })?;
    let mut out = Vec::new();
    for hit in rows {
        let hit = hit?;
        if !blocked.contains(&hit.author) {
            out.push(hit);
            if out.len() == limit {
                break;
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts5_is_available_in_the_bundled_build() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE VIRTUAL TABLE t USING fts5(x);")
            .unwrap();
    }

    /// S-001: a query over 50k indexed items answers in under 100 ms.
    #[test]
    fn query_over_fifty_thousand_items_is_under_a_hundred_ms() {
        const ITEMS: usize = 50_000;
        const BUDGET: std::time::Duration = std::time::Duration::from_millis(100);
        const KILN_EVERY: usize = 500;
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE search USING fts5(
               text, kind UNINDEXED, space_id UNINDEXED, ref UNINDEXED, author UNINDEXED, ts UNINDEXED,
               channel UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
             CREATE TABLE search_state(space_id BLOB PRIMARY KEY, stamp INTEGER NOT NULL);",
        )
        .unwrap();
        let space = SpaceId([7; 32]);
        let items: Vec<SearchItem> = (0..ITEMS)
            .map(|i| SearchItem {
                kind: "message",
                id: format!("m{i}"),
                author: "u".into(),
                ts: i as i64,
                channel: "general".into(),
                text: if i % KILN_EVERY == 0 {
                    format!("the kiln is warm number {i}")
                } else {
                    format!("ordinary chatter about glaze and clay number {i}")
                },
            })
            .collect();
        reindex(&mut conn, &space, &items, 1).unwrap();
        let start = std::time::Instant::now();
        let hits = query(
            &conn,
            "kiln",
            &[space],
            &[],
            &BTreeSet::new(),
            ITEMS / KILN_EVERY,
        )
        .unwrap();
        let took = start.elapsed();
        assert_eq!(hits.len(), ITEMS / KILN_EVERY);
        assert!(hits[0].snippet.contains(HIT_OPEN), "match is highlighted");
        assert!(took < BUDGET, "query took {took:?}");
    }

    #[test]
    fn match_expression_is_safe() {
        assert_eq!(
            match_expr("kiln glaze").as_deref(),
            Some("\"kiln\" \"glaze\"*")
        );
        assert_eq!(match_expr("  \"; DROP -- *  "), Some("\"drop\"*".into()));
        assert_eq!(match_expr("***"), None);
        assert_eq!(
            match_expr("Br\u{fc}cke").as_deref(),
            Some("\"br\u{fc}cke\"*")
        );
    }
}
