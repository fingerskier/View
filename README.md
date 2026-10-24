# View

A live file viewer for [Omarchy](https://omarchy.org). Run `view` in a directory and get a file tree beside a
rendered view of the selected file. Saving the file in your editor updates the view in place.

```sh
cd ~/some/project
view                # tree rooted here; the shell prompt comes straight back
view docs/guide.md  # root at docs/, open guide.md
view -f ~/notes     # stay attached to the terminal (logs to stderr)
```

## What it renders

| Kind | Extensions | How |
|---|---|---|
| Markdown | md, markdown, mdx… | markdown-it + DOMPurify, Shiki code blocks, mermaid diagrams, front matter, relative images/links |
| Code / text | everything else that is text | Shiki (≈200 languages), line numbers, wrap toggle; binary files fall back to a hex dump |
| Images | png, jpg, gif, webp, avif, bmp, ico, svg | fit / 1:1 |
| PDF | pdf | pdf.js with zoom, fit width/page |
| Tables | csv, tsv, psv | sticky header, row numbers |
| JSON | json, jsonl/ndjson, geojson… | collapsible tree |
| HTML | html, htm, xhtml | sandboxed frame; scripts off until you press `x`; the network is always blocked |
| 3D meshes | stl, obj (+mtl), ply, gltf/glb (Draco, meshopt), fbx, 3mf, dae, 3ds, amf, vtk/vtp, wrl, pcd, xyz, off, usd/usdz | three.js orbit view, wireframe, Z-up, grid |
| Word | docx, docm, dotx | docx-preview in-page; `o` switches to LibreOffice's exact print layout |
| Spreadsheets | xlsx, xlsm, xlsb, xls, ods | SheetJS, one tab per sheet, merged cells |
| Other office | odt, doc, rtf, pptx, ppt, odp, odg… | converted to PDF by **headless** LibreOffice (no window), cached in `~/.cache/view` |
| Audio / video | mp4, webm, mkv, mp3, wav, ogg, flac… | native player (needs GStreamer plugins, see below) |

The selected file re-renders when it changes on disk, keeping its scroll position, PDF page or camera. Atomic saves
(write a temp file, then rename it over the original) are handled. The tree updates as files come and go.
Composite formats (markdown, HTML, meshes) also reload when a sibling file changes, such as an edited texture,
`.mtl` or stylesheet.

Colors and font follow the current Omarchy theme (`omarchy-theme-color`, `omarchy-font-current`), and switching
themes restyles open windows live.

## Keys

| Key | Action |
|---|---|
| `↑` `↓` / `j` `k`, `PgUp` `PgDn`, `g` `G` | move in the tree (files preview as you move) |
| `→` `←` / `l` `h`, `Enter` | open / close folders |
| `.` | show hidden and git-ignored files |
| `s` | rendered ↔ source (markdown, SVG, HTML, CSV, JSON) |
| `r` | reload |
| `Ctrl+B` | toggle the sidebar |
| `q`, `Ctrl+Q`, `Ctrl+W` | close |

Renderer keys: code `w` wrap · image `1` actual size · PDF `-` `=` `f` `p` · table `t` header · HTML `x` scripts,
`b` open in browser · mesh `w` wireframe, `z` Z-up, `#` grid, `0` reset view · Word `i` dark pages, `o` print layout.

## Install

Needs Rust (this repo pins it with `mise`), Node, and the WebKitGTK that Tauri uses (`webkit2gtk-4.1`, already on
Omarchy).

```sh
npm install
npm run install-local   # builds and installs ~/.local/bin/view
```

Optional:

- `sudo pacman -S gst-plugins-good gst-libav` for audio/video. Without these, WebKitGTK crashes on media elements,
  so View shows a notice instead of a player.
- `libreoffice-fresh` for odt/doc/rtf/pptx/odp, and the exact print layout for docx.

## Develop

```sh
npm run app:dev     # Vite + tauri dev (debug builds never detach)
npm test            # frontend unit tests
cd src-tauri && cargo test
```

Layout: `src-tauri/src` holds the Rust side (CLI and detach, gitignore-aware listing, non-recursive watches on
only the expanded directories, Omarchy theme, LibreOffice conversion, and the `preview://` protocol for HTML).
`src/` holds the TypeScript UI, with one module per renderer in `src/renderers/`.

## Security notes

File contents are untrusted. Markdown is sanitized. SVG renders through `<img>`, so its scripts never run. HTML
runs in a sandboxed frame served over `preview://` with a CSP that blocks all network access, so even with scripts
enabled a page can read only files under the root and cannot send them anywhere. The app window cannot navigate
away from app content, file reads are confined to the root, and links open in your default browser.
