use notify::event::{AccessKind, AccessMode};
use notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

/// Whether an event can change what a file or directory listing shows.
/// inotify also reports opens and read-only closes, and the viewer reading a
/// file or listing a directory causes those; counting them would make every
/// render trigger another one. (atime bumps from reads raise no event.)
fn is_change(kind: &EventKind) -> bool {
    match kind {
        EventKind::Access(AccessKind::Close(AccessMode::Write)) => true,
        EventKind::Access(_) => false,
        _ => true,
    }
}

/// Non-recursive watches on exactly the directories the UI is showing, so a
/// huge tree (node_modules, target/) never costs more than what is expanded.
pub struct Watcher {
    debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
    dirs: HashSet<PathBuf>,
    extra: HashSet<PathBuf>,
}

impl Watcher {
    /// `on_change` runs on a dedicated thread with the de-duplicated set of
    /// paths touched in each debounce window.
    pub fn new<F>(on_change: F) -> notify::Result<Self>
    where
        F: Fn(BTreeSet<PathBuf>) + Send + 'static,
    {
        let (tx, rx) = mpsc::channel::<DebounceEventResult>();
        let debouncer = new_debouncer(Duration::from_millis(120), None, tx)?;
        std::thread::Builder::new()
            .name("view-watch".into())
            .spawn(move || {
                for result in rx {
                    let Ok(events) = result else { continue };
                    let paths: BTreeSet<PathBuf> = events
                        .into_iter()
                        .filter(|e| is_change(&e.event.kind))
                        .flat_map(|e| e.event.paths)
                        .collect();
                    if !paths.is_empty() {
                        on_change(paths);
                    }
                }
            })
            .map_err(notify::Error::io)?;
        Ok(Self { debouncer, dirs: HashSet::new(), extra: HashSet::new() })
    }

    /// Replace the set of UI-driven watched directories.
    pub fn set_dirs(&mut self, wanted: HashSet<PathBuf>) {
        for gone in self.dirs.difference(&wanted).cloned().collect::<Vec<_>>() {
            if !self.extra.contains(&gone) {
                let _ = self.debouncer.unwatch(&gone);
            }
            self.dirs.remove(&gone);
        }
        for dir in wanted {
            if !self.dirs.contains(&dir) && self.watch_one(&dir) {
                self.dirs.insert(dir);
            }
        }
    }

    /// Watch a directory outside the tree (e.g. the Omarchy theme). Calling it
    /// again re-arms the watch, which matters when the directory was replaced.
    pub fn watch_extra(&mut self, dir: &Path) {
        if self.extra.remove(dir) && !self.dirs.contains(dir) {
            let _ = self.debouncer.unwatch(dir);
        }
        if self.watch_one(dir) {
            self.extra.insert(dir.to_path_buf());
        }
    }

    /// Re-register watched directories at or below `touched` paths: replacing
    /// a directory also orphans the watches on everything inside it. A
    /// directory that is gone is forgotten, so the UI's next `set_dirs` adds
    /// it back if it returns.
    pub fn rearm<'a>(&mut self, touched: impl IntoIterator<Item = &'a PathBuf>) {
        let touched: Vec<&PathBuf> = touched.into_iter().collect();
        let stale: BTreeSet<PathBuf> = self
            .dirs
            .iter()
            .chain(&self.extra)
            .filter(|dir| touched.iter().any(|t| dir.starts_with(t)))
            .cloned()
            .collect();
        for dir in stale {
            let _ = self.debouncer.unwatch(&dir);
            if self.debouncer.watch(&dir, RecursiveMode::NonRecursive).is_err() {
                self.dirs.remove(&dir);
                self.extra.remove(&dir);
            }
        }
    }

    fn watch_one(&mut self, dir: &Path) -> bool {
        if self.dirs.contains(dir) || self.extra.contains(dir) {
            return true;
        }
        self.debouncer.watch(dir, RecursiveMode::NonRecursive).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange, MetadataKind, ModifyKind, RemoveKind, RenameMode};
    use std::os::unix::fs::PermissionsExt;
    use std::sync::{Arc, Mutex};
    use std::time::SystemTime;

    #[test]
    fn reads_are_not_changes() {
        assert!(!is_change(&EventKind::Access(AccessKind::Open(AccessMode::Any))));
        assert!(!is_change(&EventKind::Access(AccessKind::Close(AccessMode::Read))));
        assert!(is_change(&EventKind::Access(AccessKind::Close(AccessMode::Write))));
        assert!(is_change(&EventKind::Modify(ModifyKind::Data(DataChange::Any))));
        assert!(is_change(&EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any))));
        assert!(is_change(&EventKind::Modify(ModifyKind::Name(RenameMode::To))));
        assert!(is_change(&EventKind::Create(CreateKind::File)));
        assert!(is_change(&EventKind::Remove(RemoveKind::File)));
    }

    /// Reading a watched file or listing a watched directory must not report
    /// anything, or the viewer re-renders forever; writes, chmod and touch must.
    #[test]
    fn reading_is_silent_changes_are_not() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "one").unwrap();
        // Let the write's events land before the watch starts.
        std::thread::sleep(Duration::from_millis(50));

        let seen = Arc::new(Mutex::new(Vec::<PathBuf>::new()));
        let sink = seen.clone();
        let mut w = Watcher::new(move |paths| sink.lock().unwrap().extend(paths)).unwrap();
        w.set_dirs(HashSet::from([dir.path().to_path_buf()]));
        let settle = || {
            std::thread::sleep(Duration::from_millis(400));
            std::mem::take(&mut *seen.lock().unwrap())
        };
        let read = || {
            for _ in 0..5 {
                std::fs::read(&file).unwrap();
                std::fs::read_dir(dir.path()).unwrap().for_each(drop);
            }
        };

        read();
        assert_eq!(settle(), Vec::<PathBuf>::new(), "reads reported");

        std::fs::write(&file, "two").unwrap();
        assert!(settle().contains(&file), "write missed");
        read();
        assert_eq!(settle(), Vec::<PathBuf>::new(), "reads after a write reported");

        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(settle().contains(&file), "chmod missed");
        read();
        assert_eq!(settle(), Vec::<PathBuf>::new(), "reads after a chmod reported");

        // Read-only handle: its close must not be what gets reported.
        std::fs::File::open(&file).unwrap().set_modified(SystemTime::now()).unwrap();
        assert!(settle().contains(&file), "touch missed");
    }

    /// Swapping out a directory above a watched one must not leave that
    /// watch on the old inode (lib.rs calls `rearm` with every batch).
    #[test]
    fn replacing_an_ancestor_rearms_watched_descendants() {
        let root = tempfile::tempdir().unwrap();
        let (a, sub) = (root.path().join("a"), root.path().join("a/sub"));
        std::fs::create_dir_all(&sub).unwrap();

        let (tx, rx) = mpsc::channel::<BTreeSet<PathBuf>>();
        let mut w = Watcher::new(move |paths| drop(tx.send(paths))).unwrap();
        w.set_dirs(HashSet::from([root.path().to_path_buf(), a.clone(), sub.clone()]));

        std::fs::rename(&a, root.path().join("a.old")).unwrap();
        std::fs::create_dir_all(root.path().join("a.new/sub")).unwrap();
        std::fs::rename(root.path().join("a.new"), &a).unwrap();
        let wait = || rx.recv_timeout(Duration::from_secs(2)).expect("no event");
        w.rearm(&wait());
        // Drain the rest of the swap; re-arming must not generate events of its own.
        for _ in 0..5 {
            let Ok(more) = rx.recv_timeout(Duration::from_millis(300)) else { break };
            w.rearm(&more);
        }
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err(), "rearm keeps reporting");

        let file = sub.join("f.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(wait().contains(&file), "edit inside the replaced tree missed");
    }
}
