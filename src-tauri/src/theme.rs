use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub name: Option<String>,
    pub mode: String,
    pub colors: BTreeMap<String, String>,
    pub font: Option<String>,
}

/// `~/.local/state/omarchy/current`; `theme/` inside it is swapped wholesale
/// (rm + mv) by omarchy-theme-set, and `theme.name` is rewritten.
pub fn base_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".local/state/omarchy/current"))
}

fn omarchy_cmd(name: &str, args: &[&str]) -> Option<String> {
    let candidates = [PathBuf::from(name), PathBuf::from("/usr/share/omarchy/bin").join(name)];
    candidates.iter().find_map(|bin| {
        let out = Command::new(bin).args(args).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    })
}

/// `key<TAB>value` lines from `omarchy-theme-color --all`.
pub fn parse_resolved(out: &str) -> BTreeMap<String, String> {
    out.lines()
        .filter_map(|line| line.split_once('\t'))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .filter(|(k, v)| !k.is_empty() && !v.is_empty())
        .collect()
}

/// Top-level string keys of a colors.toml.
pub fn parse_colors_toml(src: &str) -> BTreeMap<String, String> {
    let Ok(table) = src.parse::<toml::Table>() else { return BTreeMap::new() };
    table
        .into_iter()
        .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
        .collect()
}

pub fn load() -> Theme {
    let base = base_dir();
    // The resolver applies Omarchy's alias/fallback cascade; the raw file is
    // the fallback for systems without it.
    let mut colors = omarchy_cmd("omarchy-theme-color", &["--all"])
        .map(|out| parse_resolved(&out))
        .unwrap_or_default();
    if colors.is_empty() {
        if let Some(src) = base.as_ref().and_then(|b| std::fs::read_to_string(b.join("theme/colors.toml")).ok()) {
            colors = parse_colors_toml(&src);
        }
    }
    let name = base
        .as_ref()
        .and_then(|b| std::fs::read_to_string(b.join("theme.name")).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let font = omarchy_cmd("omarchy-font-current", &[])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let mode = colors.get("mode").cloned().unwrap_or_else(|| "dark".into());
    Theme { name, mode, colors, font }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_resolver_output() {
        let c = parse_resolved("accent\t#89b4fa\nbackground\t#1e1e2e\nbogus line\n\t#fff\n");
        assert_eq!(c.len(), 2);
        assert_eq!(c["accent"], "#89b4fa");
    }

    #[test]
    fn parses_colors_toml_strings_only() {
        let c = parse_colors_toml("mode = \"light\"\naccent = \"#123456\"\nopacity = 0.9\n[extra]\nx = \"y\"\n");
        assert_eq!(c.get("mode").map(String::as_str), Some("light"));
        assert_eq!(c.get("accent").map(String::as_str), Some("#123456"));
        assert!(!c.contains_key("opacity") && !c.contains_key("extra"));
    }
}
