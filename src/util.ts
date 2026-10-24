/** Asset-protocol URL that keeps real `/` separators, so relative references
 * inside a document (glTF buffers, OBJ materials, HTML/markdown images)
 * resolve against the file's directory. The backend strips one leading `/`
 * and percent-decodes, so the leading `%2F` becomes the absolute root. */
export function assetUrl(path: string, version?: string | number): string {
  const rest = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  const url = `asset://localhost/%2F${rest}`;
  return version === undefined ? url : `${url}?v=${encodeURIComponent(String(version))}`;
}

/** Same shape on the `preview://` protocol, which serves the sandboxed HTML
 * frame with a network-blocking CSP (see src-tauri/src/preview.rs). */
export function previewUrl(path: string, scripts: boolean): string {
  const rest = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `preview://localhost/%2F${rest}${scripts ? "?scripts=1" : ""}`;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function extname(name: string): string {
  const base = basename(name);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i + 1).toLowerCase();
}

/** Resolve `ref` (relative or absolute) against directory `dir`, lexically. */
export function resolvePath(dir: string, ref: string): string {
  const parts = (ref.startsWith("/") ? ref : `${dir}/${ref}`).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

export function relativeTo(root: string, path: string): string {
  if (path === root) return "";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatTime(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

/** localStorage that never throws (private windows, blocked storage). */
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`view:${key}`);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`view:${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

/** A toolbar toggle button. `key` is a single-key shortcut handled globally. */
export function toggleButton(
  parent: HTMLElement,
  label: string,
  initial: boolean,
  onChange: (on: boolean) => void,
  opts: { key?: string; title?: string } = {},
): { set(on: boolean): void; el: HTMLButtonElement } {
  const btn = el("button", {
    class: "tool",
    "aria-pressed": String(initial),
    title: opts.title ?? label + (opts.key ? ` (${opts.key})` : ""),
    "data-key": opts.key,
  });
  btn.textContent = label;
  let on = initial;
  const set = (v: boolean) => {
    on = v;
    btn.setAttribute("aria-pressed", String(v));
  };
  btn.addEventListener("click", () => {
    set(!on);
    onChange(on);
  });
  parent.append(btn);
  return { set, el: btn };
}

export function actionButton(
  parent: HTMLElement,
  label: string,
  onClick: () => void,
  opts: { key?: string; title?: string } = {},
): HTMLButtonElement {
  const btn = el("button", {
    class: "tool",
    title: opts.title ?? label + (opts.key ? ` (${opts.key})` : ""),
    "data-key": opts.key,
  });
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  parent.append(btn);
  return btn;
}

export function messageBox(kind: "info" | "error", title: string, detail?: string): HTMLElement {
  return el("div", { class: `message ${kind}` }, el("strong", { text: title }), ...(detail ? [el("p", { text: detail })] : []));
}
