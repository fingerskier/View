//! Office formats without a good in-browser renderer (odt, doc, rtf, pptx,
//! odp, …) are converted to PDF by a headless LibreOffice, never its GUI.

use std::collections::hash_map::DefaultHasher;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

const TIMEOUT: Duration = Duration::from_secs(120);

/// One conversion at a time inside this process; the flock below covers
/// other `view` processes sharing the LibreOffice profile.
static LOCAL: Mutex<()> = Mutex::new(());

pub fn soffice() -> Option<PathBuf> {
    let on_path = std::env::var_os("PATH").into_iter().flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>());
    on_path
        .flat_map(|dir| [dir.join("soffice"), dir.join("libreoffice")])
        .chain([PathBuf::from("/usr/lib/libreoffice/program/soffice"), PathBuf::from("/opt/libreoffice/program/soffice")])
        .find(|p| p.is_file())
}

fn hash_of<T: Hash>(value: T) -> String {
    let mut h = DefaultHasher::new();
    value.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Cache file name: `<hash of path>-<hash of size+mtime>.pdf`, so an edit
/// yields a new name and older versions of the same source can be pruned.
pub fn cache_name(src: &Path, meta: &fs::Metadata) -> (String, String) {
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos());
    let prefix = hash_of(src);
    let name = format!("{prefix}-{}.pdf", hash_of((meta.len(), mtime)));
    (prefix, name)
}

struct FileLock(File);

impl FileLock {
    fn acquire(path: &Path) -> std::io::Result<Self> {
        let file = File::options().create(true).truncate(false).write(true).open(path)?;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Self(file))
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        unsafe { libc::flock(self.0.as_raw_fd(), libc::LOCK_UN) };
    }
}

pub fn to_pdf(src: &Path, cache_dir: &Path) -> Result<PathBuf, String> {
    let meta = fs::metadata(src).map_err(|e| e.to_string())?;
    let (prefix, name) = cache_name(src, &meta);
    let out_dir = cache_dir.join("office");
    let target = out_dir.join(&name);
    if target.is_file() {
        return Ok(target);
    }
    let soffice = soffice().ok_or("LibreOffice (soffice) is not installed")?;
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let _local = LOCAL.lock().unwrap_or_else(|e| e.into_inner());
    let _lock = FileLock::acquire(&cache_dir.join("libreoffice.lock")).map_err(|e| e.to_string())?;
    if target.is_file() {
        return Ok(target);
    }

    let work = out_dir.join(format!("tmp-{}-{}", std::process::id(), hash_of(Instant::now())));
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = convert(&soffice, src, &work, &cache_dir.join("libreoffice-profile"));
    let produced = result.and_then(|_| {
        fs::read_dir(&work)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .find(|p| p.extension().is_some_and(|x| x == "pdf"))
            .ok_or_else(|| "LibreOffice produced no PDF".to_string())
    });
    let outcome = produced.and_then(|pdf| {
        // Drop stale conversions of the same source before publishing the new one.
        if let Ok(entries) = fs::read_dir(&out_dir) {
            for entry in entries.filter_map(Result::ok) {
                let file = entry.file_name().to_string_lossy().into_owned();
                if file.starts_with(&format!("{prefix}-")) && file != name {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        fs::rename(&pdf, &target).map_err(|e| e.to_string())?;
        Ok(target)
    });
    let _ = fs::remove_dir_all(&work);
    outcome
}

fn convert(soffice: &Path, src: &Path, out: &Path, profile: &Path) -> Result<(), String> {
    let profile_url = format!("file://{}", profile.display());
    let mut child = Command::new(soffice)
        .arg(format!("-env:UserInstallation={profile_url}"))
        .args(["--headless", "--invisible", "--norestore", "--nologo", "--nodefault", "--nolockcheck"])
        .args(["--convert-to", "pdf", "--outdir"])
        .arg(out)
        .arg(src)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start LibreOffice: {e}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                let mut err = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    use std::io::Read;
                    let _ = stderr.read_to_string(&mut err);
                }
                return Err(format!("LibreOffice failed ({status}): {}", err.trim()));
            }
            Ok(None) if started.elapsed() > TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("LibreOffice timed out".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_name_changes_with_content_not_path_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.odt");
        fs::write(&f, "one").unwrap();
        let (p1, n1) = cache_name(&f, &fs::metadata(&f).unwrap());
        fs::write(&f, "three").unwrap();
        let (p2, n2) = cache_name(&f, &fs::metadata(&f).unwrap());
        assert_eq!(p1, p2);
        assert_ne!(n1, n2);
        assert!(n2.starts_with(&format!("{p2}-")) && n2.ends_with(".pdf"));
    }
}
