use serde::Serialize;
use std::cmp::Ordering;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    /// Milliseconds since the epoch, 0 when unknown.
    pub modified: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub text: String,
    pub size: u64,
    pub modified: f64,
    pub truncated: bool,
    pub binary: bool,
}

/// Resolve a path from the UI against the (canonical) root. It must stay under
/// the root both lexically and after following symlinks, so a link such as
/// `outside -> /etc` cannot be used to read past the root. Paths that no longer
/// exist (a deleted file being stat'ed) are checked through their nearest
/// existing ancestor. Returns the lexical path.
pub fn confine(root: &Path, requested: &str) -> Result<PathBuf, String> {
    let requested = Path::new(requested);
    let joined = if requested.is_absolute() { requested.to_path_buf() } else { root.join(requested) };
    let mut lexical = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::ParentDir => {
                if !lexical.pop() {
                    return Err("path escapes the filesystem root".into());
                }
            }
            Component::CurDir => {}
            other => lexical.push(other),
        }
    }
    if !lexical.starts_with(root) {
        return Err(format!("{} is outside {}", lexical.display(), root.display()));
    }

    let mut probe = lexical.as_path();
    let mut missing = Vec::new();
    let real = loop {
        match probe.canonicalize() {
            Ok(found) => break missing.iter().rev().fold(found, |acc: PathBuf, part| acc.join(part)),
            Err(_) => match (probe.parent(), probe.file_name()) {
                (Some(parent), Some(name)) => {
                    missing.push(name.to_os_string());
                    probe = parent;
                }
                _ => break lexical.clone(),
            },
        }
    };
    if real.starts_with(root) {
        Ok(lexical)
    } else {
        Err(format!("{} links outside {}", lexical.display(), root.display()))
    }
}

fn modified_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

pub fn stat(path: &Path) -> io::Result<Entry> {
    let link = fs::symlink_metadata(path)?;
    // Follow symlinks for type/size, but still list dangling links.
    let meta = fs::metadata(path).unwrap_or_else(|_| link.clone());
    Ok(Entry {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        is_dir: meta.is_dir(),
        is_symlink: link.file_type().is_symlink(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified: modified_ms(&meta),
    })
}

/// List one directory level. Unless `show_all`, hidden files and anything
/// matched by .gitignore/.ignore (including parents' ignore files) is skipped.
pub fn list_dir(dir: &Path, show_all: bool) -> io::Result<Vec<Entry>> {
    if !fs::metadata(dir)?.is_dir() {
        return Err(io::Error::new(io::ErrorKind::NotADirectory, "not a directory"));
    }
    let filtered = !show_all;
    let walker = ignore::WalkBuilder::new(dir)
        .max_depth(Some(1))
        .follow_links(false)
        .hidden(filtered)
        .ignore(filtered)
        .parents(filtered)
        .git_ignore(filtered)
        .git_global(filtered)
        .git_exclude(filtered)
        .require_git(false)
        .build();

    let mut entries: Vec<Entry> = walker
        .filter_map(Result::ok)
        .filter(|e| e.depth() == 1)
        .filter_map(|e| stat(e.path()).ok())
        .collect();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| natural_cmp(&a.name, &b.name)));
    Ok(entries)
}

/// Case-insensitive comparison that orders digit runs numerically (file2 < file10).
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    // Case and zero-padding only break ties once everything else is equal.
    let mut tie = Ordering::Equal;
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return tie,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut s = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        s.push(c);
                        it.next();
                    }
                    s
                };
                let (na, nb) = (take(&mut a), take(&mut b));
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if ord != Ordering::Equal {
                    return ord;
                }
                tie = tie.then_with(|| na.len().cmp(&nb.len()));
            }
            (Some(x), Some(y)) => {
                let ord = x.to_lowercase().cmp(y.to_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                tie = tie.then_with(|| x.cmp(&y));
                a.next();
                b.next();
            }
        }
    }
}

/// NUL bytes or invalid UTF-8 in the sample mean binary. A multi-byte
/// sequence cut off at the end of the sample is not counted as invalid.
pub fn looks_binary(sample: &[u8]) -> bool {
    if sample.contains(&0) {
        return true;
    }
    match std::str::from_utf8(sample) {
        Ok(_) => false,
        Err(e) => e.error_len().is_some(),
    }
}

pub fn read_text(path: &Path, limit: u64) -> io::Result<TextFile> {
    let file = File::open(path)?;
    let meta = file.metadata()?;
    if meta.is_dir() {
        return Err(io::Error::new(io::ErrorKind::IsADirectory, "is a directory"));
    }
    let mut buf = Vec::new();
    file.take(limit).read_to_end(&mut buf)?;
    let binary = looks_binary(&buf[..buf.len().min(8192)]);
    Ok(TextFile {
        text: if binary { String::new() } else { String::from_utf8_lossy(&buf).into_owned() },
        size: meta.len(),
        modified: modified_ms(&meta),
        truncated: meta.len() > buf.len() as u64,
        binary,
    })
}

pub fn read_head(path: &Path, len: u64) -> io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    File::open(path)?.take(len).read_to_end(&mut buf)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confine_rejects_escapes() {
        let dir = tempfile::tempdir().unwrap();
        let root = &dir.path().canonicalize().unwrap();
        let r = root.to_string_lossy();
        assert_eq!(confine(root, &format!("{r}/a/b.md")).unwrap(), root.join("a/b.md"));
        assert_eq!(confine(root, &format!("{r}/a/../c")).unwrap(), root.join("c"));
        assert_eq!(confine(root, "sub/x.txt").unwrap(), root.join("sub/x.txt"));
        assert!(confine(root, &format!("{r}/../secret")).is_err());
        assert!(confine(root, "/etc/passwd").is_err());
        assert!(confine(root, &format!("{r}2/x")).is_err());
    }

    #[test]
    fn confine_follows_symlinks() {
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret"), "x").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let root = &dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("docs")).unwrap();
        fs::write(root.join("docs/a.md"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("out")).unwrap();
        std::os::unix::fs::symlink(root.join("docs"), root.join("alias")).unwrap();

        assert!(confine(root, &format!("{}/out/secret", root.display())).is_err());
        assert!(confine(root, &format!("{}/out", root.display())).is_err());
        // Links that stay inside the root are fine, as are paths that no longer exist.
        assert_eq!(confine(root, &format!("{}/alias/a.md", root.display())).unwrap(), root.join("alias/a.md"));
        assert!(confine(root, &format!("{}/docs/deleted.md", root.display())).is_ok());
        assert!(confine(root, &format!("{}/out/deleted", root.display())).is_err());
    }

    #[test]
    fn natural_order() {
        let mut names = vec!["file10", "File2", "file1", "a", "file02"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, vec!["a", "file1", "File2", "file02", "file10"]);
    }

    #[test]
    fn binary_detection() {
        assert!(!looks_binary(b"plain text\n"));
        assert!(!looks_binary("héllo".as_bytes()));
        assert!(!looks_binary(&"é".as_bytes()[..1]), "truncated sequence is not binary");
        assert!(looks_binary(b"PK\x03\x04\x00\x00"));
        assert!(looks_binary(&[0xff, 0xfe, 0x41, 0x42]));
    }

    #[test]
    fn listing_respects_gitignore_and_sorts_dirs_first() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join(".gitignore"), "build/\n*.log\n").unwrap();
        fs::create_dir(root.join("build")).unwrap();
        fs::create_dir(root.join("src")).unwrap();
        fs::write(root.join("debug.log"), "x").unwrap();
        fs::write(root.join("b.txt"), "x").unwrap();
        fs::write(root.join("a10.txt"), "x").unwrap();
        fs::write(root.join("a9.txt"), "x").unwrap();

        let names: Vec<_> = list_dir(root, false).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["src", "a9.txt", "a10.txt", "b.txt"]);

        let all: Vec<_> = list_dir(root, true).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(all, vec!["build", "src", ".gitignore", "a9.txt", "a10.txt", "b.txt", "debug.log"]);
    }

    #[test]
    fn nested_listing_applies_parent_ignores() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join(".gitignore"), "*.tmp\n").unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/keep.md"), "x").unwrap();
        fs::write(root.join("sub/drop.tmp"), "x").unwrap();
        let names: Vec<_> = list_dir(&root.join("sub"), false).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["keep.md"]);
    }

    #[test]
    fn read_text_truncates_and_flags_binary() {
        let dir = tempfile::tempdir().unwrap();
        let text = dir.path().join("t.txt");
        fs::write(&text, "0123456789").unwrap();
        let t = read_text(&text, 4).unwrap();
        assert_eq!((t.text.as_str(), t.truncated, t.binary, t.size), ("0123", true, false, 10));

        let bin = dir.path().join("b.bin");
        fs::write(&bin, [1u8, 0, 2, 3]).unwrap();
        let b = read_text(&bin, 1024).unwrap();
        assert!(b.binary && b.text.is_empty());
        assert_eq!(read_head(&bin, 2).unwrap(), vec![1, 0]);
    }
}
