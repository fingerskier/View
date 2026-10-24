mod cli;
mod fsops;
mod office;
mod preview;
mod theme;
mod watch;

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const TEXT_LIMIT: u64 = 8 * 1024 * 1024;

struct AppState {
    root: PathBuf,
    initial: Option<PathBuf>,
    cache_dir: PathBuf,
    watcher: Mutex<Option<watch::Watcher>>,
}

impl AppState {
    fn resolve(&self, path: &str) -> Result<PathBuf, String> {
        fsops::confine(&self.root, path)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    root: String,
    root_label: String,
    initial: Option<String>,
    version: &'static str,
    has_office: bool,
    /// WebKitGTK crashes on <audio>/<video> when GStreamer's autodetect sinks are missing.
    has_media: bool,
}

fn home_label(path: &Path) -> String {
    match dirs::home_dir().and_then(|h| path.strip_prefix(&h).ok().map(Path::to_path_buf)) {
        Some(rel) if rel.as_os_str().is_empty() => "~".into(),
        Some(rel) => format!("~/{}", rel.display()),
        None => path.display().to_string(),
    }
}

#[tauri::command]
fn session(state: State<AppState>) -> Session {
    Session {
        root: state.root.to_string_lossy().into_owned(),
        root_label: home_label(&state.root),
        initial: state.initial.as_ref().map(|p| p.to_string_lossy().into_owned()),
        version: env!("CARGO_PKG_VERSION"),
        has_office: office::soffice().is_some(),
        has_media: gstreamer_sinks_present(),
    }
}

/// `autoaudiosink`/`autovideosink` live in gst-plugins-good's autodetect plugin.
fn gstreamer_sinks_present() -> bool {
    let from_env = ["GST_PLUGIN_SYSTEM_PATH_1_0", "GST_PLUGIN_PATH_1_0", "GST_PLUGIN_SYSTEM_PATH", "GST_PLUGIN_PATH"]
        .into_iter()
        .filter_map(std::env::var_os)
        .flat_map(|v| std::env::split_paths(&v).collect::<Vec<_>>());
    let defaults = ["/usr/lib/gstreamer-1.0", "/usr/lib64/gstreamer-1.0", "/usr/lib/x86_64-linux-gnu/gstreamer-1.0"].map(PathBuf::from);
    from_env.chain(defaults).any(|dir| dir.join("libgstautodetect.so").is_file())
}

#[tauri::command]
fn list_dir(state: State<AppState>, path: String, show_all: bool) -> Result<Vec<fsops::Entry>, String> {
    fsops::list_dir(&state.resolve(&path)?, show_all).map_err(|e| e.to_string())
}

#[tauri::command]
fn stat(state: State<AppState>, path: String) -> Result<fsops::Entry, String> {
    fsops::stat(&state.resolve(&path)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text(state: State<AppState>, path: String, limit: Option<u64>) -> Result<fsops::TextFile, String> {
    let limit = limit.unwrap_or(TEXT_LIMIT).min(TEXT_LIMIT);
    fsops::read_text(&state.resolve(&path)?, limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_head(state: State<AppState>, path: String, len: u64) -> Result<Response, String> {
    let bytes = fsops::read_head(&state.resolve(&path)?, len.min(TEXT_LIMIT)).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn watch_dirs(state: State<AppState>, dirs: Vec<String>) -> Result<(), String> {
    let wanted: HashSet<PathBuf> = dirs.iter().filter_map(|d| state.resolve(d).ok()).collect();
    if let Some(w) = state.watcher.lock().map_err(|e| e.to_string())?.as_mut() {
        w.set_dirs(wanted);
    }
    Ok(())
}

#[tauri::command]
fn get_theme() -> theme::Theme {
    theme::load()
}

#[tauri::command]
async fn office_pdf(app: AppHandle, path: String) -> Result<String, String> {
    let state = app.state::<AppState>();
    let src = state.resolve(&path)?;
    let cache = state.cache_dir.clone();
    tauri::async_runtime::spawn_blocking(move || office::to_pdf(&src, &cache))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.to_string_lossy().into_owned())
}

fn start_watcher(app: &AppHandle) -> notify::Result<watch::Watcher> {
    let handle = app.clone();
    let theme_base = theme::base_dir();
    let mut watcher = watch::Watcher::new(move |paths| {
        // inotify watches inodes: a watched directory that was replaced at the
        // same path (rm + mkdir, mv over) needs a fresh watch.
        if let Some(w) = handle.state::<AppState>().watcher.lock().ok().as_mut().and_then(|g| g.as_mut()) {
            w.rearm(&paths);
            // omarchy-theme-set swaps theme/ via rm + mv; re-adding also covers
            // the moment it did not exist.
            if let Some(base) = &theme_base {
                if paths.iter().any(|p| p.starts_with(base)) {
                    w.watch_extra(&base.join("theme"));
                }
            }
        }
        let in_theme = |p: &PathBuf| theme_base.as_ref().is_some_and(|b| p.starts_with(b));
        let (theme_paths, fs_paths): (Vec<_>, Vec<_>) = paths.into_iter().partition(in_theme);
        if !fs_paths.is_empty() {
            let list: Vec<String> = fs_paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
            let _ = handle.emit("fs-changed", list);
        }
        if !theme_paths.is_empty() {
            let _ = handle.emit("theme-changed", theme::load());
        }
    })?;
    if let Some(base) = theme::base_dir() {
        watcher.watch_extra(&base);
        watcher.watch_extra(&base.join("theme"));
    }
    Ok(watcher)
}

fn run(launch: cli::Launch) {
    let cache_dir = dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("view");
    let title = format!("view — {}", home_label(&launch.root));
    let state = AppState {
        root: launch.root,
        initial: launch.initial,
        cache_dir,
        watcher: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .register_asynchronous_uri_scheme_protocol("preview", |ctx, request, responder| {
            let root = ctx.app_handle().state::<AppState>().root.clone();
            std::thread::spawn(move || responder.respond(preview::handle(&root, &request)));
        })
        .setup(move |app| {
            let state = app.state::<AppState>();
            let scope = app.asset_protocol_scope();
            scope.allow_directory(&state.root, true)?;
            let office_dir = state.cache_dir.join("office");
            std::fs::create_dir_all(&office_dir)?;
            scope.allow_directory(&office_dir, false)?;

            match start_watcher(app.handle()) {
                Ok(w) => *state.watcher.lock().unwrap() = Some(w),
                Err(e) => eprintln!("view: file watching disabled: {e}"),
            }

            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                // Links are opened externally by the UI; never navigate the app (or
                // a previewed HTML frame) to anything but app and file content.
                .on_navigation(|url| match url.scheme() {
                    "tauri" | "asset" | "preview" => true,
                    "http" => {
                        url.host_str() == Some("tauri.localhost")
                            || (cfg!(debug_assertions) && url.host_str() == Some("localhost") && url.port() == Some(1420))
                    }
                    _ => false,
                })
                .title(&title)
                .inner_size(1280.0, 860.0)
                .min_inner_size(480.0, 320.0)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session, list_dir, stat, read_text, read_head, watch_dirs, get_theme, office_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running view");
}

/// Re-exec in a new session with stdio detached so the shell prompt returns.
fn detach(launch: &cli::Launch) -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    let mut cmd = Command::new(std::env::current_exe()?);
    cmd.args(["--foreground", "--"])
        .arg(launch.target())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    unsafe {
        cmd.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    cmd.spawn().map(|_| ())
}

pub fn main_entry() {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let launch = match cli::parse(std::env::args().skip(1), &cwd) {
        Ok(cli::Command::Run(launch)) => launch,
        Ok(cli::Command::Help) => {
            print!("{}", cli::USAGE);
            return;
        }
        Ok(cli::Command::Version) => {
            println!("view {}", env!("CARGO_PKG_VERSION"));
            return;
        }
        Err(e) => {
            eprintln!("view: {e}\n\n{}", cli::USAGE);
            std::process::exit(2);
        }
    };
    // Debug builds run under `tauri dev`, which needs the process to stay put.
    if !launch.foreground && !cfg!(debug_assertions) {
        if let Err(e) = detach(&launch) {
            eprintln!("view: could not start: {e}");
            std::process::exit(1);
        }
        return;
    }
    run(launch);
}
