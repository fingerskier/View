use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

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
                    let paths: BTreeSet<PathBuf> =
                        events.into_iter().flat_map(|e| e.event.paths).collect();
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

    fn watch_one(&mut self, dir: &Path) -> bool {
        if self.dirs.contains(dir) || self.extra.contains(dir) {
            return true;
        }
        self.debouncer.watch(dir, RecursiveMode::NonRecursive).is_ok()
    }
}
