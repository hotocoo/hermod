//! Replacing or wiping an install's data so that no interruption leaves a fresh identity over
//! an old database (or the reverse), and finishing or undoing a swap the app died in the middle of.
//!
//! On disk a swap is: the staged install (anywhere on the same filesystem; the app uses
//! [`staging_path`]) and [`REPLACED_DIR`] inside the data dir, where the old data waits. Two marker
//! files inside it say how far the swap got: [`INSTALLING`] (all old data is aside, staged files
//! are going in) and [`COMPLETE`] (all staged files are in). The old data is deleted only after
//! `COMPLETE`; before it, [`recover`] puts the old data back. So at every instant one whole copy
//! exists. Every rename group and marker is flushed with a directory fsync before the next step.

use std::io;
use std::path::{Path, PathBuf};

use crate::api::{DATA_ENTRIES, DB_FILE};
use crate::error::{Error, Result};
use crate::identity::KEY_FILE;

/// Scratch directory inside the data dir that holds the old data while a swap runs.
pub(crate) const REPLACED_DIR: &str = ".replaced";
/// Marker: all old data is aside, staged files are being moved in.
const INSTALLING: &str = ".installing";
/// Marker: all staged files are in; the old data is no longer needed.
const COMPLETE: &str = ".complete";
/// Extension of the sibling folder a backup or linked identity is unpacked into before the swap.
const STAGING_EXT: &str = "restore-check";

/// Renames one path; injectable so tests can make a step fail.
pub(crate) type RenameFn<'a> = &'a dyn Fn(&Path, &Path) -> io::Result<()>;
/// Called after each durable step with its number; tests panic in it to simulate a crash.
pub(crate) type CheckpointFn<'a> = &'a dyn Fn(u32);

/// Where the app stages an install before [`replace`]. [`recover`] deletes it when it settles a
/// swap, so a decrypted copy never lingers.
pub fn staging_path(dir: &Path) -> PathBuf {
    dir.with_extension(STAGING_EXT)
}

fn parent_of(p: &Path) -> &Path {
    p.parent().unwrap_or(Path::new("."))
}

/// Flushes a directory's entries (renames, creations) to disk so a power loss cannot reorder
/// them past a later marker. Windows cannot open a directory for this; NTFS journals metadata,
/// so it is a no-op there.
fn sync_dir(p: &Path) -> io::Result<()> {
    if cfg!(unix) {
        std::fs::File::open(p)?.sync_all()
    } else {
        Ok(())
    }
}

fn sync_dirs(ps: &[&Path]) -> Result<()> {
    Ok(ps.iter().try_for_each(|p| sync_dir(p))?)
}

/// Creates an empty marker file and makes it, and its folder entry, durable.
fn write_marker(p: &Path) -> Result<()> {
    std::fs::File::create(p).and_then(|f| f.sync_all())?;
    sync_dirs(&[parent_of(p)])
}

fn exists(p: &Path) -> bool {
    p.symlink_metadata().is_ok()
}

fn remove_any(p: &Path) -> io::Result<()> {
    let r = if p.is_dir() {
        std::fs::remove_dir_all(p)
    } else {
        std::fs::remove_file(p)
    };
    match r {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        r => r,
    }
}

/// Puts the contents of `staged` in place of `dir`'s install. On failure the old install is
/// restored and the staged copy is kept.
pub(crate) fn replace(dir: &Path, staged: &Path) -> Result<()> {
    replace_with(dir, staged, &|a, b| std::fs::rename(a, b), &|_| {})
}

/// Moves the current data of `dir` aside, then every entry of `staged` into `dir`. The old data
/// is deleted only when all of it succeeded; on any failure the new entries go back and the old
/// data returns, so the original is intact and the staged copy is kept.
pub(crate) fn replace_with(
    dir: &Path,
    staged: &Path,
    rename: RenameFn,
    checkpoint: CheckpointFn,
) -> Result<()> {
    // A leftover from an earlier crash is settled first, never just deleted.
    recover(dir)?;
    let aside = dir.join(REPLACED_DIR);
    // Refuse before touching anything: an entry outside the data set has no aside copy, so
    // installing it could overwrite something that cannot be put back.
    for entry in std::fs::read_dir(staged)? {
        let name = entry?.file_name();
        if !DATA_ENTRIES.iter().any(|d| name == *d) {
            return Err(Error::invalid(
                "backup",
                format!("unexpected entry {name:?}"),
            ));
        }
    }
    std::fs::create_dir_all(&aside)?;
    sync_dirs(&[dir])?;
    let mut step = 0u32;
    let mut tick = || {
        step += 1;
        checkpoint(step);
    };
    let mut moved_aside = Vec::new();
    let mut installed = Vec::new();
    let result = (|| -> Result<()> {
        for name in DATA_ENTRIES {
            let from = dir.join(name);
            if exists(&from) {
                rename(&from, &aside.join(name))?;
                moved_aside.push(name);
                tick();
            }
        }
        sync_dirs(&[dir, &aside])?;
        write_marker(&aside.join(INSTALLING))?;
        tick();
        for entry in std::fs::read_dir(staged)? {
            let name = entry?.file_name();
            rename(&staged.join(&name), &dir.join(&name))?;
            installed.push(name);
            tick();
        }
        sync_dirs(&[dir, staged])?;
        write_marker(&aside.join(COMPLETE))?;
        tick();
        Ok(())
    })();
    if let Err(err) = result {
        // Best effort, and never through the injectable `rename`: undo must not fail with it.
        let mut clean = true;
        for name in installed {
            if let Err(e) = std::fs::rename(dir.join(&name), staged.join(&name)) {
                clean = false;
                tracing::error!("swap rollback: cannot move {name:?} back: {e}");
            }
        }
        for name in moved_aside {
            if let Err(e) = std::fs::rename(aside.join(name), dir.join(name)) {
                clean = false;
                tracing::error!("swap rollback: cannot put back {name:?}: {e}");
            }
        }
        // Left in place when incomplete: `recover` finishes the undo at the next open.
        if clean && let Err(e) = std::fs::remove_dir_all(&aside) {
            tracing::error!("swap rollback: cannot remove the aside folder: {e}");
        }
        return Err(err);
    }
    std::fs::remove_dir_all(&aside)?;
    sync_dirs(&[dir])
}

/// Settles a swap an earlier run did not finish. Run before the data dir is opened.
/// `COMPLETE` present: the new data is whole, so the old goes. Otherwise the old data goes back
/// over whatever of the new got installed. Never deletes the only whole copy.
pub(crate) fn recover(dir: &Path) -> Result<()> {
    let aside = dir.join(REPLACED_DIR);
    if !exists(&aside) {
        return Ok(());
    }
    let staging = staging_path(dir);
    if exists(&aside.join(COMPLETE)) {
        tracing::warn!("finishing an interrupted swap");
        remove_any(&aside)?;
        remove_any(&staging)?;
        return sync_dirs(&[dir, parent_of(dir)]);
    }
    tracing::warn!("undoing an interrupted swap");
    // Pass 1: entries the old data lacked are new (all old data was already aside once
    // `INSTALLING` exists). The marker goes next, so an interrupted recovery never repeats this
    // pass over entries pass 2 already put back.
    if exists(&aside.join(INSTALLING)) {
        for name in DATA_ENTRIES {
            if !exists(&aside.join(name)) {
                remove_any(&dir.join(name))?;
            }
        }
        // The deletions must be durable before the marker that guards them goes.
        sync_dirs(&[dir])?;
        remove_any(&aside.join(INSTALLING))?;
        sync_dirs(&[&aside])?;
    }
    // Pass 2: old entries go back over whatever new one got installed.
    for name in DATA_ENTRIES {
        let kept = aside.join(name);
        if exists(&kept) {
            remove_any(&dir.join(name))?;
            std::fs::rename(&kept, dir.join(name))?;
            sync_dirs(&[dir, &aside])?;
        }
    }
    remove_any(&aside)?;
    remove_any(&staging)?;
    sync_dirs(&[dir, parent_of(dir)])
}

/// Refuses to start on a database whose key file is gone: minting a new identity there would
/// orphan every event in it.
pub(crate) fn check_key_present(dir: &Path) -> Result<()> {
    if dir.join(DB_FILE).exists() && !dir.join(KEY_FILE).exists() {
        return Err(Error::invalid(
            "data",
            "the identity key is missing but the database is present; restore a backup instead",
        ));
    }
    Ok(())
}

/// Deletes an install's data. Database first and key last, so an interruption never leaves a
/// database without its key.
pub(crate) fn wipe(dir: &Path) -> Result<()> {
    recover(dir)?;
    for name in DATA_ENTRIES.iter().rev() {
        remove_any(&dir.join(name))?;
    }
    sync_dirs(&[dir])
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::fs;
    use std::panic::{AssertUnwindSafe, catch_unwind};

    use super::*;

    /// A data dir holding an old install plus a file outside the data set, and a staged new one.
    fn make_dirs() -> (tempfile::TempDir, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("data");
        let staged = staging_path(&dir);
        fs::create_dir_all(dir.join("blobs")).unwrap();
        fs::write(dir.join(DB_FILE), "old db").unwrap();
        fs::write(dir.join("hermod.db-wal"), "old wal").unwrap();
        fs::write(dir.join("blobs/a"), "old blob").unwrap();
        fs::write(dir.join("peers.json"), "keep").unwrap();
        fs::create_dir_all(staged.join("blobs")).unwrap();
        fs::write(staged.join(DB_FILE), "new db").unwrap();
        fs::write(staged.join(KEY_FILE), "new key").unwrap();
        fs::write(staged.join("blobs/b"), "new blob").unwrap();
        (t, dir)
    }

    fn real(a: &Path, b: &Path) -> io::Result<()> {
        fs::rename(a, b)
    }

    fn text(dir: &Path, name: &str) -> String {
        fs::read_to_string(dir.join(name)).unwrap()
    }

    fn assert_old(dir: &Path, ctx: &str) {
        assert_eq!(text(dir, DB_FILE), "old db", "{ctx}");
        assert_eq!(text(dir, "hermod.db-wal"), "old wal", "{ctx}");
        assert_eq!(text(dir, "blobs/a"), "old blob", "{ctx}");
        assert!(!dir.join(KEY_FILE).exists(), "{ctx}");
        assert!(!dir.join("blobs/b").exists(), "{ctx}");
        assert_eq!(text(dir, "peers.json"), "keep", "{ctx}");
    }

    fn assert_new(dir: &Path, ctx: &str) {
        assert_eq!(text(dir, DB_FILE), "new db", "{ctx}");
        assert_eq!(text(dir, KEY_FILE), "new key", "{ctx}");
        assert_eq!(text(dir, "blobs/b"), "new blob", "{ctx}");
        assert!(!dir.join("hermod.db-wal").exists(), "{ctx}");
        assert!(!dir.join("blobs/a").exists(), "{ctx}");
    }

    #[test]
    fn success_replaces_data_and_removes_the_old() {
        let (_t, dir) = make_dirs();
        replace(&dir, &staging_path(&dir)).unwrap();
        assert_new(&dir, "done");
        assert_eq!(text(&dir, "peers.json"), "keep");
        assert!(!dir.join(REPLACED_DIR).exists());
    }

    #[test]
    fn an_unexpected_staged_entry_is_refused_before_anything_moves() {
        let (_t, dir) = make_dirs();
        let staged = staging_path(&dir);
        fs::write(staged.join("peers.json"), "evil").unwrap();
        let err = replace(&dir, &staged).unwrap_err().to_string();
        assert!(err.contains("unexpected entry"), "{err}");
        assert_old(&dir, "refused");
        assert!(!dir.join(REPLACED_DIR).exists());
        assert_eq!(text(&staged, DB_FILE), "new db");
    }

    #[test]
    fn a_failing_rename_leaves_the_original_intact_and_keeps_staged() {
        // 3 moves aside plus 3 installs.
        for fail_at in 0..6 {
            let (_t, dir) = make_dirs();
            let staged = staging_path(&dir);
            let n = Cell::new(0);
            let err = replace_with(
                &dir,
                &staged,
                &|a, b| {
                    n.set(n.get() + 1);
                    if n.get() == fail_at + 1 {
                        return Err(io::Error::other("injected"));
                    }
                    fs::rename(a, b)
                },
                &|_| {},
            )
            .unwrap_err()
            .to_string();
            assert!(err.contains("injected"), "{err}");
            assert_old(&dir, &format!("fail at {fail_at}"));
            assert_eq!(text(&staged, DB_FILE), "new db");
            assert!(staged.join(KEY_FILE).exists() && staged.join("blobs/b").exists());
            assert!(
                !dir.join(REPLACED_DIR).exists(),
                "a clean rollback leaves nothing to recover"
            );
            // A later open must not touch the intact data.
            recover(&dir).unwrap();
            assert_old(&dir, "after recover");
        }
    }

    #[test]
    fn a_crash_after_any_step_recovers_to_whole_old_or_whole_new_data() {
        // Steps: 3 moves aside, the installing marker, 3 installs, the complete marker.
        let total = 8;
        for crash_at in 1..=total {
            let (_t, dir) = make_dirs();
            let r = catch_unwind(AssertUnwindSafe(|| {
                replace_with(&dir, &staging_path(&dir), &real, &|s| {
                    if s == crash_at {
                        panic!("simulated crash");
                    }
                })
            }));
            assert!(r.is_err(), "step {crash_at} must crash");
            recover(&dir).unwrap();
            let ctx = format!("crash after step {crash_at}");
            if crash_at == total {
                assert_new(&dir, &ctx);
            } else {
                assert_old(&dir, &ctx);
            }
            assert!(
                !dir.join(REPLACED_DIR).exists() && !staging_path(&dir).exists(),
                "{ctx}"
            );
            // Recovery is idempotent.
            recover(&dir).unwrap();
        }
    }

    #[test]
    fn open_refuses_a_database_without_its_key() {
        let (_t, dir) = make_dirs();
        assert!(check_key_present(&dir).is_err());
        fs::write(dir.join(KEY_FILE), "k").unwrap();
        check_key_present(&dir).unwrap();
    }

    #[test]
    fn wipe_removes_everything_and_tolerates_nothing_there() {
        let (_t, dir) = make_dirs();
        wipe(&dir).unwrap();
        assert!(!dir.join(KEY_FILE).exists() && !dir.join(DB_FILE).exists());
        assert_eq!(text(&dir, "peers.json"), "keep");
        wipe(&dir).unwrap();
    }
}
