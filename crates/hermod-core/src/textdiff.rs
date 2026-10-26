//! Line diff of two stored blobs (Skein file diff view).

use crate::blobs::BlobStore;
use crate::error::Result;
use serde::Serialize;
use similar::{ChangeTag, TextDiff};

/// Largest blob (bytes) either side may have; bigger ones are reported, never read.
pub const MAX_DIFF_BYTES: u64 = 1024 * 1024;
/// Leading bytes scanned for a NUL to call a blob binary.
pub const BINARY_SNIFF_BYTES: usize = 8192;
/// Unchanged lines kept around each change.
pub const DIFF_CONTEXT_LINES: usize = 3;

/// One diff row: `t` is `+`, `-` or a space.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiffRow {
    pub t: char,
    pub s: String,
}

/// A run of changes with its context; starts are 1-based.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Hunk {
    pub old_start: usize,
    pub new_start: usize,
    pub rows: Vec<DiffRow>,
}

/// Outcome of diffing two blobs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum BlobDiff {
    Text { hunks: Vec<Hunk> },
    Binary,
    TooLarge,
}

enum Side {
    Text(String),
    Binary,
    TooLarge,
}

/// An absent side (file added or removed) reads as empty text.
fn load(blobs: &BlobStore, hash: Option<&str>) -> Result<Side> {
    let Some(h) = hash else {
        return Ok(Side::Text(String::new()));
    };
    if blobs.size(h)? > MAX_DIFF_BYTES {
        return Ok(Side::TooLarge);
    }
    let bytes = blobs.read_all(h)?;
    let head = &bytes[..bytes.len().min(BINARY_SNIFF_BYTES)];
    if head.contains(&0) {
        return Ok(Side::Binary);
    }
    Ok(String::from_utf8(bytes).map_or(Side::Binary, Side::Text))
}

/// Line hunks turning blob `from` into blob `to`; `None` is an empty side.
pub fn diff_blobs(blobs: &BlobStore, from: Option<&str>, to: Option<&str>) -> Result<BlobDiff> {
    let (a, b) = match (load(blobs, from)?, load(blobs, to)?) {
        (Side::TooLarge, _) | (_, Side::TooLarge) => return Ok(BlobDiff::TooLarge),
        (Side::Binary, _) | (_, Side::Binary) => return Ok(BlobDiff::Binary),
        (Side::Text(a), Side::Text(b)) => (a, b),
    };
    Ok(BlobDiff::Text {
        hunks: diff_text(&a, &b),
    })
}

fn diff_text(a: &str, b: &str) -> Vec<Hunk> {
    let d = TextDiff::from_lines(a, b);
    d.grouped_ops(DIFF_CONTEXT_LINES)
        .iter()
        .map(|g| Hunk {
            old_start: g.first().map_or(0, |o| o.old_range().start + 1),
            new_start: g.first().map_or(0, |o| o.new_range().start + 1),
            rows: g
                .iter()
                .flat_map(|op| d.iter_changes(op))
                .map(|c| DiffRow {
                    t: match c.tag() {
                        ChangeTag::Insert => '+',
                        ChangeTag::Delete => '-',
                        ChangeTag::Equal => ' ',
                    },
                    s: c.value().trim_end_matches(['\n', '\r']).to_string(),
                })
                .collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(s: &BlobStore, data: &[u8]) -> String {
        s.put_bytes(data).unwrap().hash
    }

    #[test]
    fn hunks_mark_adds_dels_and_context() {
        let dir = tempfile::tempdir().unwrap();
        let s = BlobStore::open(dir.path()).unwrap();
        let (a, b) = (put(&s, b"one\ntwo\nthree\n"), put(&s, b"one\n2\nthree\n"));
        let BlobDiff::Text { hunks } = diff_blobs(&s, Some(&a), Some(&b)).unwrap() else {
            panic!("text expected");
        };
        assert_eq!(hunks.len(), 1);
        assert_eq!((hunks[0].old_start, hunks[0].new_start), (1, 1));
        let marks: String = hunks[0].rows.iter().map(|r| r.t).collect();
        assert_eq!(marks, " -+ ");
        assert_eq!(hunks[0].rows[1].s, "two");
    }

    #[test]
    fn added_file_is_all_additions() {
        let dir = tempfile::tempdir().unwrap();
        let s = BlobStore::open(dir.path()).unwrap();
        let b = put(&s, b"x\ny\n");
        let BlobDiff::Text { hunks } = diff_blobs(&s, None, Some(&b)).unwrap() else {
            panic!("text expected");
        };
        assert_eq!(hunks[0].rows.len(), 2);
        assert!(hunks[0].rows.iter().all(|r| r.t == '+'));
    }

    #[test]
    fn identical_blobs_have_no_hunks() {
        let dir = tempfile::tempdir().unwrap();
        let s = BlobStore::open(dir.path()).unwrap();
        let a = put(&s, b"same\n");
        assert_eq!(
            diff_blobs(&s, Some(&a), Some(&a)).unwrap(),
            BlobDiff::Text { hunks: vec![] }
        );
    }

    #[test]
    fn binary_and_oversize_are_reported_not_diffed() {
        let dir = tempfile::tempdir().unwrap();
        let s = BlobStore::open(dir.path()).unwrap();
        let t = put(&s, b"text\n");
        let nul = put(&s, b"a\0b");
        let bad = put(&s, &[0xff, 0xfe, 0xfd]);
        let big = put(&s, &vec![b'a'; MAX_DIFF_BYTES as usize + 1]);
        assert_eq!(
            diff_blobs(&s, Some(&t), Some(&nul)).unwrap(),
            BlobDiff::Binary
        );
        assert_eq!(
            diff_blobs(&s, Some(&bad), Some(&t)).unwrap(),
            BlobDiff::Binary
        );
        assert_eq!(
            diff_blobs(&s, Some(&t), Some(&big)).unwrap(),
            BlobDiff::TooLarge
        );
    }

    #[test]
    fn missing_blob_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let s = BlobStore::open(dir.path()).unwrap();
        assert!(diff_blobs(&s, Some(&"0".repeat(64)), None).is_err());
    }
}
