//! Replacing or wiping an install's data so that no interruption leaves a fresh identity over
//! an old database (or the reverse).
//!
//! A replace first moves the old files into [`REPLACED_DIR`], writes [`OLD_MOVED`], then moves
//! the staged files in with the key last. [`recover`] runs at every open: with the marker and the
//! new key present the swap finished (drop the old data), otherwise it is rolled back to the old.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use crate::api::DB_FILE;
use crate::error::{Error, Result};
use crate::identity::KEY_FILE;

/// Scratch directory inside the data dir that holds the old data while a swap runs.
pub(crate) const REPLACED_DIR: &str = ".replaced";
/// Written once the old data is fully aside; from then on the new files are being moved in.
pub(crate) const OLD_MOVED: &str = "old-moved";
/// An install's files in the order a swap moves them. The key is last: while it is absent the
/// install counts as not yet swapped in.
pub(crate) const DATA_FILES: [&str; 5] =
    ["blobs", DB_FILE, "hermod.db-wal", "hermod.db-shm", KEY_FILE];

fn missing_ok(r: std::io::Result<()>) -> Result<()> {
    match r {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// Renames every data file that exists in `from` into `to`.
fn move_files(from: &Path, to: &Path) -> Result<()> {
    DATA_FILES
        .iter()
        .try_for_each(|name| missing_ok(fs::rename(from.join(name), to.join(name))))
}

fn remove_files(dir: &Path) -> Result<()> {
    for name in DATA_FILES {
        let p = dir.join(name);
        missing_ok(fs::remove_file(&p).or_else(|_| fs::remove_dir_all(&p)))?;
    }
    Ok(())
}

/// Puts the contents of `staged` in place of `dir`'s install. On failure the old install is
/// restored.
pub(crate) fn replace(dir: &Path, staged: &Path) -> Result<()> {
    let aside = dir.join(REPLACED_DIR);
    missing_ok(fs::remove_dir_all(&aside))?;
    fs::create_dir_all(&aside)?;
    let moved = move_files(dir, &aside)
        .and_then(|()| Ok(fs::write(aside.join(OLD_MOVED), b"")?))
        .and_then(|()| move_files(staged, dir));
    if let Err(e) = moved {
        // Best effort: the old data must come back, and the caller sees the original error.
        let _ = recover(dir);
        return Err(e);
    }
    missing_ok(fs::remove_dir_all(&aside))
}

/// Finishes or undoes a swap that did not complete (a crash, or a failure `replace` could not undo).
pub(crate) fn recover(dir: &Path) -> Result<()> {
    let aside = dir.join(REPLACED_DIR);
    if !aside.exists() {
        return Ok(());
    }
    let finished = aside.join(OLD_MOVED).exists() && dir.join(KEY_FILE).exists();
    if !finished {
        if aside.join(OLD_MOVED).exists() {
            // Part of the new install got in; the old one is whole in `aside`.
            remove_files(dir)?;
        }
        move_files(&aside, dir)?;
    }
    missing_ok(fs::remove_dir_all(&aside))
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
    remove_files(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn install(dir: &Path, tag: &str) {
        fs::create_dir_all(dir.join("blobs")).unwrap();
        for name in [DB_FILE, KEY_FILE] {
            fs::write(dir.join(name), tag).unwrap();
        }
    }

    fn read(dir: &Path, name: &str) -> String {
        fs::read_to_string(dir.join(name)).unwrap()
    }

    #[test]
    fn replace_swaps_everything_and_leaves_no_scratch() {
        let (d, s) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        install(d.path(), "old");
        install(s.path(), "new");
        replace(d.path(), s.path()).unwrap();
        assert_eq!(
            (read(d.path(), DB_FILE), read(d.path(), KEY_FILE)),
            ("new".into(), "new".into())
        );
        assert!(!d.path().join(REPLACED_DIR).exists());
    }

    #[test]
    fn crash_with_old_data_aside_rolls_back() {
        let (d, s) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        install(d.path(), "old");
        install(s.path(), "new");
        // Simulate: old moved aside and marked, the new db moved in, killed before the key.
        let aside = d.path().join(REPLACED_DIR);
        fs::create_dir_all(&aside).unwrap();
        move_files(d.path(), &aside).unwrap();
        fs::write(aside.join(OLD_MOVED), "").unwrap();
        fs::rename(s.path().join(DB_FILE), d.path().join(DB_FILE)).unwrap();
        assert!(check_key_present(d.path()).is_err());
        recover(d.path()).unwrap();
        assert_eq!(
            (read(d.path(), DB_FILE), read(d.path(), KEY_FILE)),
            ("old".into(), "old".into())
        );
        assert!(!aside.exists());
    }

    #[test]
    fn crash_before_the_old_data_was_all_aside_rolls_back() {
        let d = tempfile::tempdir().unwrap();
        install(d.path(), "old");
        let aside = d.path().join(REPLACED_DIR);
        fs::create_dir_all(&aside).unwrap();
        fs::rename(d.path().join(DB_FILE), aside.join(DB_FILE)).unwrap();
        recover(d.path()).unwrap();
        assert_eq!(read(d.path(), DB_FILE), "old");
        assert_eq!(read(d.path(), KEY_FILE), "old");
    }

    #[test]
    fn crash_after_the_new_key_landed_finishes_the_swap() {
        let (d, s) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        install(d.path(), "old");
        install(s.path(), "new");
        let aside = d.path().join(REPLACED_DIR);
        fs::create_dir_all(&aside).unwrap();
        move_files(d.path(), &aside).unwrap();
        fs::write(aside.join(OLD_MOVED), "").unwrap();
        move_files(s.path(), d.path()).unwrap();
        recover(d.path()).unwrap();
        assert_eq!(
            (read(d.path(), DB_FILE), read(d.path(), KEY_FILE)),
            ("new".into(), "new".into())
        );
        assert!(!aside.exists());
    }

    #[test]
    fn wipe_removes_everything_and_tolerates_nothing_there() {
        let d = tempfile::tempdir().unwrap();
        install(d.path(), "old");
        wipe(d.path()).unwrap();
        assert!(!d.path().join(KEY_FILE).exists() && !d.path().join(DB_FILE).exists());
        wipe(d.path()).unwrap();
    }
}
