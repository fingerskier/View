import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type Session } from "./api";
import { classify, type FileType, type Kind } from "./filetypes";
import type { Ctx, Renderer, View } from "./renderers/types";
import { assetUrl, dirname, el, formatSize, formatTime, messageBox, relativeTo, resolvePath } from "./util";

const renderers: Record<Kind, () => Promise<{ default: Renderer }>> = {
  markdown: () => import("./renderers/markdown"),
  code: () => import("./renderers/code"),
  image: () => import("./renderers/image"),
  svg: () => import("./renderers/svg"),
  pdf: () => import("./renderers/pdf"),
  table: () => import("./renderers/table"),
  json: () => import("./renderers/json"),
  html: () => import("./renderers/html"),
  video: () => import("./renderers/media"),
  audio: () => import("./renderers/media"),
  mesh: () => import("./renderers/mesh"),
  docx: () => import("./renderers/docx"),
  sheet: () => import("./renderers/sheet"),
  office: () => import("./renderers/office"),
};

/** Kinds that pull in sibling files (images, .mtl/.bin, stylesheets): reload
 * when anything in the same directory changes, not just the file itself. */
const COMPOUND: Kind[] = ["markdown", "html", "mesh"];

const kindLabel: Record<Kind, string> = {
  markdown: "Markdown",
  code: "Text",
  image: "Image",
  svg: "SVG",
  pdf: "PDF",
  table: "Table",
  json: "JSON",
  html: "HTML",
  video: "Video",
  audio: "Audio",
  mesh: "3D model",
  docx: "Word",
  sheet: "Spreadsheet",
  office: "Document (LibreOffice)",
};

interface Current {
  path: string;
  type: FileType;
  version: number;
  view: View | null;
  /** Changed on disk while the first render was still running. */
  dirty: boolean;
  /** The first render threw, so there is no view to update in place. */
  failed: boolean;
}

export interface ViewerEls {
  view: HTMLElement;
  tools: HTMLElement;
  crumbs: HTMLElement;
  kind: HTMLElement;
  size: HTMLElement;
  time: HTMLElement;
  live: HTMLElement;
}

export class Viewer {
  private current: Current | null = null;
  private token = 0;
  private updating = false;
  private again = false;

  constructor(
    private els: ViewerEls,
    private session: Session,
    private navigate: (path: string) => void,
  ) {
    els.view.addEventListener("click", (e) => this.onLinkClick(e));
  }

  get path(): string | null {
    return this.current?.path ?? null;
  }

  welcome() {
    this.dispose();
    this.els.tools.replaceChildren();
    this.els.crumbs.replaceChildren();
    for (const k of ["kind", "size", "time"] as const) this.els[k].textContent = "";
    const keys: [string, string][] = [
      ["↑ ↓ / j k", "move"],
      ["→ ← / l h", "open / close folder"],
      [".", "hidden & ignored files"],
      ["s", "rendered / source"],
      ["r", "reload"],
      ["Ctrl+B", "toggle sidebar"],
      ["q", "quit"],
    ];
    this.els.view.replaceChildren(
      el(
        "div",
        { class: "welcome" },
        el("h1", { text: this.session.rootLabel }),
        el("p", { text: "Pick a file. It re-renders whenever it changes on disk." }),
        el("dl", {}, ...keys.flatMap(([k, d]) => [el("dt", {}, el("kbd", { text: k })), el("dd", { text: d })])),
      ),
    );
  }

  async open(path: string) {
    const token = ++this.token;
    this.dispose();
    const type = classify(path);
    const tools = el("span", { class: "tool-group" });
    this.els.tools.replaceChildren(tools);
    const host = el("div", { class: `host kind-${type.kind}` });
    this.els.view.replaceChildren(host);
    this.els.view.scrollTop = 0;
    this.els.view.classList.remove("stale");
    this.setCrumbs(path);
    this.els.kind.textContent = kindLabel[type.kind];

    const current: Current = { path, type, version: Date.now(), view: null, dirty: false, failed: false };
    this.current = current;
    const ctx: Ctx = {
      path,
      type,
      session: this.session,
      url: () => assetUrl(path, current.version),
      version: () => current.version,
      text: (limit) => api.readText(path, limit),
      bytes: async () => {
        const res = await fetch(assetUrl(path, current.version));
        if (!res.ok) throw new Error(`could not read file (HTTP ${res.status})`);
        return res.arrayBuffer();
      },
      tools,
      open: this.navigate,
      external: (url) => void openUrl(url),
    };

    const loading = window.setTimeout(() => this.els.view.classList.add("loading"), 120);
    try {
      const renderer = (await renderers[type.kind]()).default;
      const view = await renderer(host, ctx);
      if (token !== this.token) {
        view.dispose();
        return;
      }
      current.view = view;
      if (current.dirty) {
        current.dirty = false;
        void this.reload();
      }
    } catch (e) {
      if (token === this.token) {
        current.failed = true;
        host.replaceChildren(messageBox("error", "Could not render this file", e instanceof Error ? e.message : String(e)));
      }
    } finally {
      clearTimeout(loading);
      if (token === this.token) this.els.view.classList.remove("loading");
    }
    if (token !== this.token) return;
    // It failed (say, half-written) but has changed since: try the new version.
    if (current.failed && current.dirty) void this.open(path);
    else void this.refreshStatus();
  }

  /** Paths changed on disk; reload if they concern the open file. */
  onFsChanged(paths: string[]) {
    const cur = this.current;
    if (!cur) return;
    const dir = dirname(cur.path);
    const hit =
      paths.includes(cur.path) ||
      // A renamed or replaced ancestor directory is reported as itself.
      paths.some((p) => cur.path.startsWith(`${p}/`)) ||
      (COMPOUND.includes(cur.type.kind) && paths.some((p) => dirname(p) === dir));
    if (hit) void this.reload();
  }

  /** Re-render the open file in place (live update or `r`). */
  async reload() {
    const cur = this.current;
    if (!cur) return;
    if (!cur.view) {
      // A failed mount has nothing to update, so mount afresh. Otherwise it is
      // still mounting: re-render once the first render lands.
      if (cur.failed) void this.open(cur.path);
      else cur.dirty = true;
      return;
    }
    if (this.updating) {
      this.again = true;
      return;
    }
    this.updating = true;
    try {
      let gone = false;
      await api.stat(cur.path).catch(() => (gone = true));
      // Every await is a chance for the user to have opened another file.
      if (cur !== this.current) return;
      if (gone) {
        this.els.view.classList.add("stale");
        this.els.live.textContent = "deleted";
        return;
      }
      this.els.view.classList.remove("stale");
      cur.version = Date.now();
      const { scrollTop, scrollLeft } = this.els.view;
      await cur.view.update();
      if (cur !== this.current) return;
      this.els.view.scrollTop = scrollTop;
      this.els.view.scrollLeft = scrollLeft;
      this.flash();
      await this.refreshStatus();
    } catch (e) {
      if (cur === this.current) this.els.live.textContent = `update failed: ${e instanceof Error ? e.message : e}`;
    } finally {
      this.updating = false;
      if (this.again) {
        this.again = false;
        void this.reload();
      }
    }
  }

  retheme() {
    this.current?.view?.retheme?.();
  }

  private dispose() {
    try {
      this.current?.view?.dispose();
    } catch {
      /* best effort */
    }
    this.current = null;
  }

  private setCrumbs(path: string) {
    const rel = relativeTo(this.session.root, path);
    const cut = rel.lastIndexOf("/");
    this.els.crumbs.replaceChildren(
      ...(cut >= 0 ? [el("span", { class: "crumb-dir", text: rel.slice(0, cut + 1) })] : []),
      el("span", { class: "crumb-file", text: rel.slice(cut + 1) }),
    );
    this.els.crumbs.title = path;
  }

  private async refreshStatus() {
    const cur = this.current;
    if (!cur) return;
    try {
      const entry = await api.stat(cur.path);
      if (cur !== this.current) return;
      this.els.size.textContent = formatSize(entry.size);
      this.els.time.textContent = formatTime(entry.modified);
      this.els.live.textContent = "live";
    } catch {
      /* the next fs event will tell */
    }
  }

  private flash() {
    const live = this.els.live;
    live.classList.remove("flash");
    void live.offsetWidth;
    live.classList.add("flash");
  }

  private onLinkClick(e: MouseEvent) {
    const a = (e.target as Element).closest?.("a[href]");
    if (!a || !this.current) return;
    const href = a.getAttribute("href") ?? "";
    if (/^(https?|mailto):/i.test(href)) {
      e.preventDefault();
      void openUrl(href);
      return;
    }
    // pdf.js handles its own internal (#page) links.
    if (a.closest(".pdfViewer")) return;
    e.preventDefault();
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      this.els.view.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    let ref = href.split(/[?#]/)[0];
    try {
      ref = decodeURI(ref);
    } catch {
      /* keep as written */
    }
    if (ref) this.navigate(resolvePath(dirname(this.current.path), ref));
  }
}
