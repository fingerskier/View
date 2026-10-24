use std::path::{Path, PathBuf};

pub const USAGE: &str = "\
usage: view [-f|--foreground] [PATH]

Open a live file viewer rooted at PATH (default: the current directory).
If PATH is a file, its directory becomes the root and the file is opened.

  -f, --foreground  stay attached to the terminal
  -h, --help        show this help
  -V, --version     show the version
";

#[derive(Debug, PartialEq)]
pub enum Command {
    Run(Launch),
    Help,
    Version,
}

#[derive(Debug, PartialEq)]
pub struct Launch {
    /// Canonical directory shown as the tree root.
    pub root: PathBuf,
    /// File to open on startup, when PATH named a file.
    pub initial: Option<PathBuf>,
    pub foreground: bool,
}

impl Launch {
    /// The path to hand to a detached child so it resolves to the same launch.
    pub fn target(&self) -> &Path {
        self.initial.as_deref().unwrap_or(&self.root)
    }
}

pub fn parse<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Result<Command, String> {
    let mut foreground = false;
    let mut target: Option<String> = None;
    let mut positional_only = false;

    for arg in args {
        if !positional_only && arg.starts_with('-') && arg != "-" {
            match arg.as_str() {
                "--" => positional_only = true,
                "-f" | "--foreground" => foreground = true,
                "-h" | "--help" => return Ok(Command::Help),
                "-V" | "--version" => return Ok(Command::Version),
                _ => return Err(format!("unknown option: {arg}")),
            }
        } else if target.is_none() {
            target = Some(arg);
        } else {
            return Err("expected at most one PATH".into());
        }
    }

    let path = match target {
        Some(t) => cwd.join(t),
        None => cwd.to_path_buf(),
    };
    let path = path
        .canonicalize()
        .map_err(|e| format!("{}: {e}", path.display()))?;

    if path.is_dir() {
        return Ok(Command::Run(Launch { root: path, initial: None, foreground }));
    }
    let root = path
        .parent()
        .ok_or_else(|| format!("{}: has no parent directory", path.display()))?
        .to_path_buf();
    Ok(Command::Run(Launch { root, initial: Some(path), foreground }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn defaults_to_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let cmd = parse(args(&[]), &root).unwrap();
        assert_eq!(cmd, Command::Run(Launch { root, initial: None, foreground: false }));
    }

    #[test]
    fn file_argument_opens_parent_with_selection() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("a.md"), "# hi").unwrap();
        let cmd = parse(args(&["-f", "a.md"]), &root).unwrap();
        assert_eq!(
            cmd,
            Command::Run(Launch { root: root.clone(), initial: Some(root.join("a.md")), foreground: true })
        );
    }

    #[test]
    fn double_dash_allows_dash_names() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir(root.join("-odd")).unwrap();
        let cmd = parse(args(&["--", "-odd"]), &root).unwrap();
        assert_eq!(cmd, Command::Run(Launch { root: root.join("-odd"), initial: None, foreground: false }));
    }

    #[test]
    fn rejects_missing_paths_and_unknown_flags() {
        let dir = tempfile::tempdir().unwrap();
        assert!(parse(args(&["nope"]), dir.path()).is_err());
        assert!(parse(args(&["--bogus"]), dir.path()).is_err());
        assert!(parse(args(&["a", "b"]), dir.path()).is_err());
        assert_eq!(parse(args(&["-h"]), dir.path()).unwrap(), Command::Help);
    }
}
