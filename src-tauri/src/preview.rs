//! `preview://` serves files under the root to the sandboxed HTML preview
//! frame. Unlike the asset protocol it lets the frame load its own relative
//! stylesheets/scripts/images (same-origin sandbox), and every HTML/SVG
//! document gets a CSP that blocks the network, so even a page with scripts
//! enabled can read only what is under the root and cannot send it anywhere.

use crate::fsops;
use std::path::Path;
use tauri::http::{header, Request, Response, StatusCode};

pub fn mime_for(path: &Path) -> &'static str {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "xhtml" => "application/xhtml+xml",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "map" | "webmanifest" => "application/json",
        "xml" => "application/xml",
        "txt" | "md" | "csv" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "ogg" | "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

pub fn csp(scripts: bool) -> String {
    let script = if scripts { "'self' preview: 'unsafe-inline' 'unsafe-eval' blob:" } else { "'none'" };
    format!(
        "default-src 'self' preview: data: blob:; script-src {script}; \
         style-src 'self' preview: 'unsafe-inline' data:; img-src 'self' preview: data: blob:; \
         media-src 'self' preview: data: blob:; font-src 'self' preview: data:; \
         connect-src 'self' preview: data: blob:; frame-src 'self' preview:; worker-src 'self' preview: blob:; \
         object-src 'none'; form-action 'none'; base-uri 'self' preview:"
    )
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(code).body(Vec::new()).unwrap()
}

/// URL shape matches the frontend's: `preview://localhost/%2Fabs/path?scripts=1`.
pub fn handle(root: &Path, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let raw = uri.path().strip_prefix('/').unwrap_or(uri.path());
    let decoded = percent_encoding::percent_decode_str(raw).decode_utf8_lossy();
    let scripts = uri.query().is_some_and(|q| q.split('&').any(|kv| kv == "scripts=1"));

    let Ok(path) = fsops::confine(root, &decoded) else { return status(StatusCode::FORBIDDEN) };
    let Ok(bytes) = std::fs::read(&path) else { return status(StatusCode::NOT_FOUND) };
    // Every response carries the policy, not just documents: a worker takes
    // its CSP from its own script response, not from the page that started it.
    Response::builder()
        .header(header::CONTENT_TYPE, mime_for(&path))
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", csp(scripts))
        .body(bytes)
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(root: &Path, url: &str) -> Response<Vec<u8>> {
        handle(root, &Request::builder().uri(url).body(Vec::new()).unwrap())
    }

    #[test]
    fn serves_files_under_root_with_csp() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("a b.html"), "<p>hi</p>").unwrap();
        let encoded = root.to_string_lossy().trim_start_matches('/').replace(' ', "%20");
        let res = get(&root, &format!("preview://localhost/%2F{encoded}/a%20b.html"));
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.body(), b"<p>hi</p>");
        let csp = res.headers()["Content-Security-Policy"].to_str().unwrap();
        assert!(csp.contains("script-src 'none'"));

        let res = get(&root, &format!("preview://localhost/%2F{encoded}/a%20b.html?scripts=1"));
        assert!(res.headers()["Content-Security-Policy"].to_str().unwrap().contains("'unsafe-inline'"));

        // Scripts (potential workers) get a network-blocking policy too.
        std::fs::write(root.join("w.js"), "postMessage(1)").unwrap();
        let res = get(&root, &format!("preview://localhost/%2F{encoded}/w.js"));
        let csp = res.headers()["Content-Security-Policy"].to_str().unwrap();
        assert!(csp.contains("connect-src 'self' preview: data: blob:") && !csp.contains("https:"));
    }

    #[test]
    fn refuses_paths_outside_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        assert_eq!(get(&root, "preview://localhost/%2Fetc/passwd").status(), StatusCode::FORBIDDEN);
        let escape = format!("preview://localhost/%2F{}/../x", root.to_string_lossy().trim_start_matches('/'));
        assert_eq!(get(&root, &escape).status(), StatusCode::FORBIDDEN);
    }
}
