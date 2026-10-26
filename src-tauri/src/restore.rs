//! Swapping a restored backup into the data dir without ever leaving it half-written.

use std::io;
use std::path::Path;

use hermod_core::api::DATA_ENTRIES;

/// Renames one path; injectable so tests can make a step fail.
pub type RenameFn<'a> = &'a dyn Fn(&Path, &Path) -> io::Result<()>;

fn ioerr(x: io::Error) -> String {
    x.to_string()
}

/// Moves the current data of `dir` into `aside`, then every entry of `staged` into `dir`. The old
/// data is deleted only when all of it succeeded; on any failure the new entries go back to
/// `staged` and the old data returns to `dir`, so the original is intact and `staged` is kept.
pub fn swap_data(dir: &Path, staged: &Path, aside: &Path, rename: RenameFn) -> Result<(), String> {
    match std::fs::remove_dir_all(aside) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(ioerr(e)),
    }
    std::fs::create_dir_all(aside).map_err(ioerr)?;
    let mut moved_aside = Vec::new();
    let mut installed = Vec::new();
    let result = (|| -> Result<(), String> {
        for name in DATA_ENTRIES {
            let from = dir.join(name);
            if from.symlink_metadata().is_ok() {
                rename(&from, &aside.join(name)).map_err(ioerr)?;
                moved_aside.push(name);
            }
        }
        for entry in std::fs::read_dir(staged).map_err(ioerr)? {
            let name = entry.map_err(ioerr)?.file_name();
            rename(&staged.join(&name), &dir.join(&name)).map_err(ioerr)?;
            installed.push(name);
        }
        Ok(())
    })();
    if let Err(msg) = result {
        // Best effort, and never through the injectable `rename`: undo must not fail with it.
        for name in installed {
            if let Err(e) = std::fs::rename(dir.join(&name), staged.join(&name)) {
                tracing::error!("restore rollback: cannot move {name:?} back: {e}");
            }
        }
        for name in moved_aside {
            if let Err(e) = std::fs::rename(aside.join(name), dir.join(name)) {
                tracing::error!("restore rollback: cannot put back {name:?}: {e}");
            }
        }
        return Err(msg);
    }
    std::fs::remove_dir_all(aside).map_err(ioerr)
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::fs;

    use super::*;

    fn fixture() -> (
        tempfile::TempDir,
        std::path::PathBuf,
        std::path::PathBuf,
        std::path::PathBuf,
    ) {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("data");
        let staged = t.path().join("data.restore-check");
        let aside = t.path().join("data.restore-old");
        fs::create_dir_all(dir.join("blobs")).unwrap();
        fs::write(dir.join("hermod.db"), "old db").unwrap();
        fs::write(dir.join("blobs/a"), "old blob").unwrap();
        fs::write(dir.join("peers.json"), "keep").unwrap();
        fs::create_dir_all(staged.join("blobs")).unwrap();
        fs::write(staged.join("hermod.db"), "new db").unwrap();
        fs::write(staged.join("identity.key"), "new key").unwrap();
        fs::write(staged.join("blobs/b"), "new blob").unwrap();
        (t, dir, staged, aside)
    }

    #[test]
    fn success_replaces_data_and_removes_the_old() {
        let (_t, dir, staged, aside) = fixture();
        swap_data(&dir, &staged, &aside, &|a, b| fs::rename(a, b)).unwrap();
        assert_eq!(fs::read_to_string(dir.join("hermod.db")).unwrap(), "new db");
        assert!(dir.join("blobs/b").exists() && !dir.join("blobs/a").exists());
        assert_eq!(fs::read_to_string(dir.join("peers.json")).unwrap(), "keep");
        assert!(!aside.exists());
    }

    #[test]
    fn a_failing_rename_leaves_the_original_intact_and_keeps_staged() {
        // Fail at every step in turn: aside moves and installs alike.
        for fail_at in 0..5 {
            let (_t, dir, staged, aside) = fixture();
            let n = Cell::new(0);
            let err = swap_data(&dir, &staged, &aside, &|a, b| {
                n.set(n.get() + 1);
                if n.get() == fail_at + 1 {
                    return Err(io::Error::other("injected"));
                }
                fs::rename(a, b)
            })
            .unwrap_err();
            assert!(err.contains("injected"), "{err}");
            assert_eq!(fs::read_to_string(dir.join("hermod.db")).unwrap(), "old db");
            assert_eq!(fs::read_to_string(dir.join("blobs/a")).unwrap(), "old blob");
            assert!(!dir.join("identity.key").exists(), "step {fail_at}");
            assert_eq!(
                fs::read_to_string(staged.join("hermod.db")).unwrap(),
                "new db"
            );
            assert!(staged.join("identity.key").exists() && staged.join("blobs/b").exists());
        }
    }
}
