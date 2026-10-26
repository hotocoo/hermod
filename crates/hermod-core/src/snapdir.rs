//! Skein folder snapshots and exports: walk a picked folder, plan adds/dels/changes against the
//! parent snapshot (K-003), and write a snapshot's files back out (K-010).

use crate::blobs::BlobStore;
use crate::error::{Error, Result};
use crate::event::{BlobRef, SnapFileIn};
use crate::textdiff::{BlobDiff, MAX_DIFF_BYTES, diff_blobs};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

/// Most files one folder snapshot may hold.
pub const MAX_SNAP_FILES: usize = 5000;
/// Most total bytes one folder snapshot may hold.
pub const MAX_SNAP_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Deepest folder nesting walked.
pub const MAX_SNAP_DEPTH: usize = 24;
/// Operating-system litter never snapshotted (dot-files are skipped separately).
pub const SYSTEM_NAMES: [&str; 5] = [
    "Thumbs.db",
    "desktop.ini",
    "ehthumbs.db",
    "$RECYCLE.BIN",
    "System Volume Information",
];

/// A folder scan planned against the parent snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapPlan {
    /// Every current file, plus a blob-less entry for each file the parent had that is gone.
    pub files: Vec<SnapFileIn>,
    pub added: u32,
    pub removed: u32,
    pub changed: u32,
}

fn bad(what: &'static str, detail: impl Into<String>) -> Error {
    Error::Invalid {
        what,
        detail: detail.into(),
    }
}

fn skipped(name: &str) -> bool {
    name.starts_with('.') || SYSTEM_NAMES.contains(&name)
}

/// Regular files under `root` as `(relative path with '/', absolute path)`, sorted by path.
/// Hidden and system entries and symlinks are skipped; the caps are enforced, never truncated.
pub fn walk_folder(root: &Path) -> Result<Vec<(String, PathBuf)>> {
    let mut out = Vec::new();
    let mut total = 0u64;
    let mut stack = vec![(root.to_path_buf(), String::new(), 0usize)];
    while let Some((dir, prefix, depth)) = stack.pop() {
        if depth > MAX_SNAP_DEPTH {
            return Err(bad("folder", "folders are nested too deeply"));
        }
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| bad("folder", "a file name is not valid text"))?;
            if skipped(&name) {
                continue;
            }
            let meta = fs::symlink_metadata(entry.path())?;
            let rel = format!("{prefix}{name}");
            if meta.is_dir() {
                stack.push((entry.path(), format!("{rel}/"), depth + 1));
            } else if meta.is_file() {
                total += meta.len();
                if out.len() >= MAX_SNAP_FILES || total > MAX_SNAP_BYTES {
                    return Err(bad("folder", "this folder is too large to snapshot"));
                }
                out.push((rel, entry.path()));
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Added and removed line counts turning `from` into `to`; binary or oversized files count 0.
fn line_counts(
    blobs: &BlobStore,
    from: Option<&BlobRef>,
    to: Option<&BlobRef>,
) -> Result<(u32, u32)> {
    if from
        .iter()
        .chain(to.iter())
        .any(|b| b.size > MAX_DIFF_BYTES)
    {
        return Ok((0, 0));
    }
    let d = diff_blobs(
        blobs,
        from.map(|b| b.hash.as_str()),
        to.map(|b| b.hash.as_str()),
    )?;
    let BlobDiff::Text { hunks } = d else {
        return Ok((0, 0));
    };
    let count = |t| {
        hunks
            .iter()
            .flat_map(|h| &h.rows)
            .filter(|r| r.t == t)
            .count() as u32
    };
    Ok((count('+'), count('-')))
}

/// Compares `new` (path, stored blob) to the parent's files by path and hash.
pub fn plan(
    blobs: &BlobStore,
    parent: &[SnapFileIn],
    new: Vec<(String, BlobRef)>,
) -> Result<SnapPlan> {
    let old: BTreeMap<&str, &BlobRef> = parent
        .iter()
        .filter_map(|f| f.blob.as_ref().map(|b| (f.path.as_str(), b)))
        .collect();
    let mut out = SnapPlan {
        files: Vec::new(),
        added: 0,
        removed: 0,
        changed: 0,
    };
    let mut kept = HashSet::new();
    for (path, blob) in new {
        let before = old.get(path.as_str()).copied();
        let (adds, dels) = match before {
            Some(b) if b.hash == blob.hash => (0, 0),
            Some(b) => {
                out.changed += 1;
                line_counts(blobs, Some(b), Some(&blob))?
            }
            None => {
                out.added += 1;
                line_counts(blobs, None, Some(&blob))?
            }
        };
        kept.insert(path.clone());
        out.files.push(SnapFileIn {
            path,
            blob: Some(blob),
            adds,
            dels,
        });
    }
    for (path, b) in old.iter().filter(|(p, _)| !kept.contains(**p)) {
        out.removed += 1;
        let (_, dels) = line_counts(blobs, Some(b), None)?;
        out.files.push(SnapFileIn {
            path: (*path).to_string(),
            blob: None,
            adds: 0,
            dels,
        });
    }
    Ok(out)
}

/// A snapshot path is untrusted peer input: relative, no `.`/`..`, no separators of another OS.
fn safe_rel(path: &str) -> Result<PathBuf> {
    let ok = !path.is_empty()
        && !path.contains(['\\', '\0'])
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
        && !path.ends_with('/');
    if ok {
        Ok(path.split('/').collect())
    } else {
        Err(bad("path", format!("unsafe file path {path:?}")))
    }
}

/// Writes every file that has a blob into `dest`, a missing or empty folder. Nothing is
/// overwritten, and nothing is written unless every blob is complete and every path is safe.
pub fn export(blobs: &BlobStore, files: &[SnapFileIn], dest: &Path) -> Result<u32> {
    let wanted: Vec<(PathBuf, &BlobRef)> = files
        .iter()
        .filter_map(|f| f.blob.as_ref().map(|b| (&f.path, b)))
        .map(|(p, b)| safe_rel(p).map(|rel| (rel, b)))
        .collect::<Result<_>>()?;
    let mut seen = HashSet::new();
    for (rel, b) in &wanted {
        if !seen.insert(rel) {
            return Err(bad("path", "two files share one path"));
        }
        if !blobs.is_complete(&b.hash)? {
            return Err(Error::NotFound(format!(
                "file {} is not available yet",
                b.name
            )));
        }
    }
    if dest.exists() && (!dest.is_dir() || fs::read_dir(dest)?.next().is_some()) {
        return Err(bad(
            "folder",
            "choose a folder that does not exist yet or is empty",
        ));
    }
    for (rel, b) in &wanted {
        let target = dest.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)?;
        let m = blobs
            .manifest(&b.hash)?
            .ok_or_else(|| Error::NotFound(format!("file {}", b.name)))?;
        for idx in 0..m.chunks.len() {
            f.write_all(&blobs.read_chunk_in(&m, &b.hash, idx as u32)?)?;
        }
        f.sync_all()?;
    }
    Ok(wanted.len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, BlobStore) {
        let d = tempfile::tempdir().unwrap();
        let s = BlobStore::open(d.path()).unwrap();
        (d, s)
    }

    fn put(s: &BlobStore, name: &str, data: &[u8]) -> BlobRef {
        let i = s.put_bytes(data).unwrap();
        BlobRef {
            hash: i.hash,
            size: i.size,
            name: name.into(),
            mime: String::new(),
        }
    }

    fn file(path: &str, blob: &BlobRef) -> SnapFileIn {
        SnapFileIn {
            path: path.into(),
            blob: Some(blob.clone()),
            adds: 0,
            dels: 0,
        }
    }

    #[test]
    fn plan_counts_added_removed_and_changed_by_path_and_hash() {
        let (_d, s) = store();
        let same = put(&s, "same", b"x\n");
        let old = put(&s, "edit", b"one\ntwo\n");
        let new = put(&s, "edit", b"one\n2\nthree\n");
        let gone = put(&s, "gone", b"a\nb\nc\n");
        let fresh = put(&s, "fresh", b"p\nq\n");
        let parent = [file("same", &same), file("edit", &old), file("gone", &gone)];
        let p = plan(
            &s,
            &parent,
            vec![
                ("same".into(), same),
                ("edit".into(), new),
                ("fresh".into(), fresh),
            ],
        )
        .unwrap();
        assert_eq!((p.added, p.removed, p.changed), (1, 1, 1));
        let by = |n: &str| p.files.iter().find(|f| f.path == n).unwrap();
        assert_eq!((by("same").adds, by("same").dels), (0, 0));
        assert_eq!((by("edit").adds, by("edit").dels), (2, 1));
        assert_eq!((by("fresh").adds, by("fresh").dels), (2, 0));
        assert!(by("gone").blob.is_none());
        assert_eq!((by("gone").adds, by("gone").dels), (0, 3));
    }

    #[test]
    fn plan_ignores_removed_entries_of_the_parent() {
        let (_d, s) = store();
        let a = put(&s, "a", b"x\n");
        let parent = [SnapFileIn {
            path: "a".into(),
            blob: None,
            adds: 0,
            dels: 1,
        }];
        let p = plan(&s, &parent, vec![("a".into(), a)]).unwrap();
        assert_eq!((p.added, p.removed, p.changed), (1, 0, 0));
    }

    #[test]
    fn walk_skips_hidden_system_and_nests_with_slashes() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("src/deep")).unwrap();
        fs::create_dir_all(d.path().join(".git")).unwrap();
        for p in [
            "a.txt",
            "src/b.txt",
            "src/deep/c.txt",
            ".hidden",
            ".git/x",
            "Thumbs.db",
        ] {
            fs::write(d.path().join(p), b"1").unwrap();
        }
        let got: Vec<String> = walk_folder(d.path())
            .unwrap()
            .into_iter()
            .map(|x| x.0)
            .collect();
        assert_eq!(got, ["a.txt", "src/b.txt", "src/deep/c.txt"]);
    }

    #[test]
    fn export_writes_files_and_refuses_unsafe_or_occupied_targets() {
        let (_d, s) = store();
        let a = put(&s, "a", b"alpha");
        let b = put(&s, "b", b"beta");
        let files = [file("a.txt", &a), file("sub/b.txt", &b)];
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("export");
        assert_eq!(export(&s, &files, &dest).unwrap(), 2);
        assert_eq!(fs::read(dest.join("sub/b.txt")).unwrap(), b"beta");
        // Second run: the folder is no longer empty, nothing is overwritten.
        assert!(export(&s, &files, &dest).is_err());
        for evil in ["../x", "/abs", "a/../../x", "", "dir/", "a\\b"] {
            let e = tempfile::tempdir().unwrap();
            assert!(
                export(&s, &[file(evil, &a)], &e.path().join("o")).is_err(),
                "{evil}"
            );
        }
        let ghost = BlobRef {
            hash: "ab".repeat(32),
            size: 1,
            name: "g".into(),
            mime: String::new(),
        };
        let e = tempfile::tempdir().unwrap();
        let dest = e.path().join("o");
        assert!(export(&s, &[file("ok", &a), file("g", &ghost)], &dest).is_err());
        assert!(!dest.exists(), "nothing written when a blob is missing");
    }
}
