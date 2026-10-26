//! Swapping a restored backup into the data dir without ever leaving it half-written, and
//! finishing or undoing that swap if the app died in the middle of it.
//!
//! On disk a swap is: `<dir>.restore-check` (the staged backup), `<dir>.restore-old` (the old
//! data moved aside). Two marker files inside the aside dir say how far it got:
//! `.installing` (all old data is aside, staged files are going in) and `.complete` (all staged
//! files are in). The old data is deleted only after `.complete`; before it, recovery puts the
//! old data back. So at every instant one whole copy exists.

use std::io;
use std::path::{Path, PathBuf};

use hermod_core::api::DATA_ENTRIES;

/// Renames one path; injectable so tests can make a step fail.
pub type RenameFn<'a> = &'a dyn Fn(&Path, &Path) -> io::Result<()>;
/// Called after each durable step with its number; tests panic in it to simulate a crash.
pub type CheckpointFn<'a> = &'a dyn Fn(u32);

const INSTALLING: &str = ".installing";
const COMPLETE: &str = ".complete";

/// Where a restore stages the decrypted backup.
pub fn staged_path(dir: &Path) -> PathBuf {
    dir.with_extension("restore-check")
}

/// Where the old data waits while the staged files go in.
pub fn aside_path(dir: &Path) -> PathBuf {
    dir.with_extension("restore-old")
}

fn ioerr(x: io::Error) -> String {
    x.to_string()
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

/// Moves the current data of `dir` aside, then every entry of the staged dir into `dir`. The
/// old data is deleted only when all of it succeeded; on any failure the new entries go back and
/// the old data returns, so the original is intact and the staged copy is kept.
pub fn swap_data(dir: &Path, rename: RenameFn, checkpoint: CheckpointFn) -> Result<(), String> {
    // A leftover from an earlier crash is settled first, never just deleted.
    recover(dir)?;
    let (staged, aside) = (staged_path(dir), aside_path(dir));
    std::fs::create_dir_all(&aside).map_err(ioerr)?;
    let mut step = 0u32;
    let mut tick = || {
        step += 1;
        checkpoint(step);
    };
    let mut moved_aside = Vec::new();
    let mut installed = Vec::new();
    let result = (|| -> Result<(), String> {
        for name in DATA_ENTRIES {
            let from = dir.join(name);
            if exists(&from) {
                rename(&from, &aside.join(name)).map_err(ioerr)?;
                moved_aside.push(name);
                tick();
            }
        }
        std::fs::write(aside.join(INSTALLING), b"").map_err(ioerr)?;
        tick();
        for entry in std::fs::read_dir(&staged).map_err(ioerr)? {
            let name = entry.map_err(ioerr)?.file_name();
            rename(&staged.join(&name), &dir.join(&name)).map_err(ioerr)?;
            installed.push(name);
            tick();
        }
        std::fs::write(aside.join(COMPLETE), b"").map_err(ioerr)?;
        tick();
        Ok(())
    })();
    if let Err(msg) = result {
        // Best effort, and never through the injectable `rename`: undo must not fail with it.
        let mut clean = true;
        for name in installed {
            if let Err(e) = std::fs::rename(dir.join(&name), staged.join(&name)) {
                clean = false;
                tracing::error!("restore rollback: cannot move {name:?} back: {e}");
            }
        }
        for name in moved_aside {
            if let Err(e) = std::fs::rename(aside.join(name), dir.join(name)) {
                clean = false;
                tracing::error!("restore rollback: cannot put back {name:?}: {e}");
            }
        }
        // Left in place when incomplete: `recover` finishes the undo at the next open.
        if clean && let Err(e) = std::fs::remove_dir_all(&aside) {
            tracing::error!("restore rollback: cannot remove the aside folder: {e}");
        }
        return Err(msg);
    }
    std::fs::remove_dir_all(&aside).map_err(ioerr)
}

/// Settles a swap an earlier run did not finish. Run before the data dir is opened.
/// `.complete` present: the new data is whole, so the old goes. Otherwise the old data goes
/// back over whatever of the new got installed. Never deletes the only whole copy.
pub fn recover(dir: &Path) -> Result<(), String> {
    let aside = aside_path(dir);
    if !exists(&aside) {
        return Ok(());
    }
    if exists(&aside.join(COMPLETE)) {
        tracing::warn!("finishing an interrupted restore");
        remove_any(&aside).map_err(ioerr)?;
        return remove_any(&staged_path(dir)).map_err(ioerr);
    }
    tracing::warn!("undoing an interrupted restore");
    // Pass 1: entries the old data lacked are new (all old data was already aside once
    // `.installing` exists). The marker goes next, so an interrupted recovery never repeats this
    // pass over entries pass 2 already put back.
    if exists(&aside.join(INSTALLING)) {
        for name in DATA_ENTRIES {
            if !exists(&aside.join(name)) {
                remove_any(&dir.join(name)).map_err(ioerr)?;
            }
        }
        remove_any(&aside.join(INSTALLING)).map_err(ioerr)?;
    }
    // Pass 2: old entries go back over whatever new one got installed.
    for name in DATA_ENTRIES {
        let kept = aside.join(name);
        if exists(&kept) {
            remove_any(&dir.join(name)).map_err(ioerr)?;
            std::fs::rename(&kept, dir.join(name)).map_err(ioerr)?;
        }
    }
    remove_any(&aside).map_err(ioerr)?;
    remove_any(&staged_path(dir)).map_err(ioerr)
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::fs;
    use std::panic::{AssertUnwindSafe, catch_unwind};

    use super::*;

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("data");
        let staged = staged_path(&dir);
        fs::create_dir_all(dir.join("blobs")).unwrap();
        fs::write(dir.join("hermod.db"), "old db").unwrap();
        fs::write(dir.join("hermod.db-wal"), "old wal").unwrap();
        fs::write(dir.join("blobs/a"), "old blob").unwrap();
        fs::write(dir.join("peers.json"), "keep").unwrap();
        fs::create_dir_all(staged.join("blobs")).unwrap();
        fs::write(staged.join("hermod.db"), "new db").unwrap();
        fs::write(staged.join("identity.key"), "new key").unwrap();
        fs::write(staged.join("blobs/b"), "new blob").unwrap();
        (t, dir)
    }

    fn real(a: &Path, b: &Path) -> io::Result<()> {
        fs::rename(a, b)
    }

    fn assert_old(dir: &Path, ctx: &str) {
        assert_eq!(
            fs::read_to_string(dir.join("hermod.db")).unwrap(),
            "old db",
            "{ctx}"
        );
        assert_eq!(
            fs::read_to_string(dir.join("hermod.db-wal")).unwrap(),
            "old wal",
            "{ctx}"
        );
        assert_eq!(
            fs::read_to_string(dir.join("blobs/a")).unwrap(),
            "old blob",
            "{ctx}"
        );
        assert!(!dir.join("identity.key").exists(), "{ctx}");
        assert!(!dir.join("blobs/b").exists(), "{ctx}");
        assert_eq!(
            fs::read_to_string(dir.join("peers.json")).unwrap(),
            "keep",
            "{ctx}"
        );
    }

    fn assert_new(dir: &Path, ctx: &str) {
        assert_eq!(
            fs::read_to_string(dir.join("hermod.db")).unwrap(),
            "new db",
            "{ctx}"
        );
        assert_eq!(
            fs::read_to_string(dir.join("identity.key")).unwrap(),
            "new key",
            "{ctx}"
        );
        assert_eq!(
            fs::read_to_string(dir.join("blobs/b")).unwrap(),
            "new blob",
            "{ctx}"
        );
        assert!(!dir.join("hermod.db-wal").exists(), "{ctx}");
        assert!(!dir.join("blobs/a").exists(), "{ctx}");
    }

    #[test]
    fn success_replaces_data_and_removes_the_old() {
        let (_t, dir) = fixture();
        swap_data(&dir, &real, &|_| {}).unwrap();
        assert_new(&dir, "done");
        assert_eq!(fs::read_to_string(dir.join("peers.json")).unwrap(), "keep");
        assert!(!aside_path(&dir).exists());
    }

    #[test]
    fn a_failing_rename_leaves_the_original_intact_and_keeps_staged() {
        // 3 moves aside plus 3 installs.
        for fail_at in 0..6 {
            let (_t, dir) = fixture();
            let n = Cell::new(0);
            let err = swap_data(
                &dir,
                &|a, b| {
                    n.set(n.get() + 1);
                    if n.get() == fail_at + 1 {
                        return Err(io::Error::other("injected"));
                    }
                    fs::rename(a, b)
                },
                &|_| {},
            )
            .unwrap_err();
            assert!(err.contains("injected"), "{err}");
            assert_old(&dir, &format!("fail at {fail_at}"));
            let staged = staged_path(&dir);
            assert_eq!(
                fs::read_to_string(staged.join("hermod.db")).unwrap(),
                "new db"
            );
            assert!(staged.join("identity.key").exists() && staged.join("blobs/b").exists());
            assert!(
                !aside_path(&dir).exists(),
                "a clean rollback leaves nothing to recover"
            );
            // A later open must not touch the intact data.
            recover(&dir).unwrap();
            assert_old(&dir, "after recover");
        }
    }

    #[test]
    fn a_crash_after_any_step_recovers_to_whole_old_or_whole_new_data() {
        // Steps: 3 moves aside, .installing, 3 installs, .complete.
        let total = 8;
        for crash_at in 1..=total {
            let (_t, dir) = fixture();
            let r = catch_unwind(AssertUnwindSafe(|| {
                swap_data(&dir, &real, &|s| {
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
                !aside_path(&dir).exists() && !staged_path(&dir).exists(),
                "{ctx}"
            );
            // Recovery is idempotent.
            recover(&dir).unwrap();
        }
    }
}
