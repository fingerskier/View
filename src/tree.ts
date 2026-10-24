import { api, type Entry } from "./api";
import { iconClass } from "./filetypes";
import { dirname, el, prefs } from "./util";

interface Row {
  entry: Entry;
  depth: number;
}

export interface TreeHandlers {
  /** A file was chosen (click, Enter, or the cursor resting on it). */
  open(entry: Entry): void;
  /** The set of directories currently on screen changed. */
  visibleDirs(dirs: string[]): void;
}

/** Lazily-loaded file tree. Only expanded directories are listed (and watched). */
export class Tree {
  private children = new Map<string, Entry[]>();
  private expanded = new Set<string>();
  private rows: Row[] = [];
  private rowEls: HTMLElement[] = [];
  private cursor = -1;
  private selected: string | null = null;
  private previewTimer = 0;
  private refreshTimer = 0;
  private pendingRefresh = new Set<string>();
  showAll = prefs.get("tree:showAll", false);

  constructor(
    private host: HTMLElement,
    readonly root: string,
    private handlers: TreeHandlers,
  ) {
    host.addEventListener("click", (e) => this.onClick(e));
    host.addEventListener("keydown", (e) => this.onKey(e));
  }

  async init() {
    await this.load(this.root);
    this.render();
    this.announce();
  }

  focus() {
    this.host.focus();
  }

  /** Expand every ancestor of `path` and put the cursor on it. */
  async reveal(path: string): Promise<boolean> {
    if (!path.startsWith(`${this.root}/`)) return false;
    const chain: string[] = [];
    for (let dir = dirname(path); dir !== this.root && dir.startsWith(this.root); dir = dirname(dir)) chain.unshift(dir);
    // Hidden directories are unwatched, so their cached listings may be stale.
    await Promise.all(chain.map((dir) => this.load(dir)));
    for (const dir of chain) this.expanded.add(dir);
    this.selected = path;
    this.render();
    this.moveTo(this.rows.findIndex((r) => r.entry.path === path), false);
    this.announce();
    return this.rows.some((r) => r.entry.path === path);
  }

  setSelected(path: string | null) {
    this.selected = path;
    for (const [i, row] of this.rows.entries()) this.rowEls[i]?.classList.toggle("selected", row.entry.path === path);
    this.announce();
  }

  async toggleShowAll() {
    this.showAll = !this.showAll;
    prefs.set("tree:showAll", this.showAll);
    await Promise.all([...this.children.keys()].map((d) => this.load(d)));
    this.render();
    return this.showAll;
  }

  collapseAll() {
    this.expanded.clear();
    this.render();
    this.announce();
  }

  /** Re-list loaded directories touched by these paths (debounced). */
  onFsChanged(paths: string[]) {
    for (const p of paths) {
      const parent = dirname(p);
      if (this.children.has(parent)) this.pendingRefresh.add(parent);
      if (this.children.has(p)) this.pendingRefresh.add(p);
    }
    if (!this.pendingRefresh.size) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(async () => {
      const dirs = [...this.pendingRefresh];
      this.pendingRefresh.clear();
      await Promise.all(dirs.map((d) => this.load(d)));
      this.render();
      this.announce();
    }, 60);
  }

  private async load(dir: string) {
    try {
      this.children.set(dir, await api.listDir(dir, this.showAll));
    } catch {
      // Gone or unreadable: forget it and everything below it.
      for (const key of [...this.children.keys()]) {
        if (key === dir || key.startsWith(`${dir}/`)) this.children.delete(key);
      }
      this.expanded.delete(dir);
      if (dir === this.root) this.children.set(dir, []);
    }
  }

  private visible(): string[] {
    const dirs = [this.root];
    for (const row of this.rows) if (row.entry.isDir && this.expanded.has(row.entry.path)) dirs.push(row.entry.path);
    return dirs;
  }

  private announce() {
    const dirs = new Set(this.visible());
    if (this.selected) dirs.add(dirname(this.selected));
    this.handlers.visibleDirs([...dirs]);
  }

  private render() {
    const cursorPath = this.rows[this.cursor]?.entry.path;
    this.rows = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of this.children.get(dir) ?? []) {
        this.rows.push({ entry, depth });
        if (entry.isDir && this.expanded.has(entry.path) && this.children.has(entry.path)) walk(entry.path, depth + 1);
      }
    };
    walk(this.root, 0);

    this.rowEls = this.rows.map(({ entry, depth }, i) => {
      const open = entry.isDir && this.expanded.has(entry.path);
      const row = el(
        "div",
        {
          class: `row ${entry.isDir ? "dir" : "file"}${open ? " expanded" : ""}${entry.isSymlink ? " symlink" : ""}`,
          role: "treeitem",
          "data-i": String(i),
          title: entry.name,
          style: `--depth:${depth}`,
        },
        el("span", { class: "twisty" }),
        el("span", { class: `icon ${iconClass(entry.path, entry.isDir)}` }),
        el("span", { class: "name", text: entry.name }),
      );
      if (entry.isDir) row.setAttribute("aria-expanded", String(open));
      if (entry.path === this.selected) row.classList.add("selected");
      return row;
    });
    if (!this.rows.length) {
      this.host.replaceChildren(el("div", { class: "tree-empty", text: this.showAll ? "Empty directory" : "Nothing here (press . to show hidden and ignored files)" }));
    } else {
      this.host.replaceChildren(...this.rowEls);
    }

    const keep = cursorPath ? this.rows.findIndex((r) => r.entry.path === cursorPath) : -1;
    this.cursor = keep >= 0 ? keep : Math.min(this.cursor, this.rows.length - 1);
    this.rowEls[this.cursor]?.classList.add("cursor");
  }

  private moveTo(i: number, preview = true) {
    clearTimeout(this.previewTimer);
    if (!this.rows.length || i < 0) return;
    i = Math.max(0, Math.min(this.rows.length - 1, i));
    this.rowEls[this.cursor]?.classList.remove("cursor");
    this.cursor = i;
    const rowEl = this.rowEls[i];
    rowEl.classList.add("cursor");
    rowEl.scrollIntoView({ block: "nearest" });
    const entry = this.rows[i].entry;
    if (preview && !entry.isDir) {
      this.previewTimer = window.setTimeout(() => this.choose(entry), 70);
    }
  }

  private choose(entry: Entry) {
    clearTimeout(this.previewTimer);
    if (entry.isDir) return;
    this.setSelected(entry.path);
    this.handlers.open(entry);
  }

  private async toggle(entry: Entry, open = !this.expanded.has(entry.path)) {
    if (open) {
      // Collapsed directories are not watched, so re-list rather than trust the
      // cache — including expanded subdirectories that become visible again.
      const prefix = `${entry.path}/`;
      const stale = [...this.children.keys()].filter((d) => d.startsWith(prefix) && this.expanded.has(d));
      await Promise.all([entry.path, ...stale].map((d) => this.load(d)));
      this.expanded.add(entry.path);
    } else {
      this.expanded.delete(entry.path);
    }
    this.render();
    this.announce();
  }

  private onClick(e: MouseEvent) {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>(".row");
    if (!rowEl) return;
    const i = Number(rowEl.dataset.i);
    const entry = this.rows[i].entry;
    this.moveTo(i, false);
    if (entry.isDir) void this.toggle(entry);
    else this.choose(entry);
  }

  private onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const row = this.rows[this.cursor];
    const page = Math.max(1, Math.floor(this.host.clientHeight / 22) - 1);
    switch (e.key) {
      case "ArrowDown":
      case "j":
        this.moveTo(this.cursor < 0 ? 0 : this.cursor + 1);
        break;
      case "ArrowUp":
      case "k":
        this.moveTo(this.cursor < 0 ? 0 : this.cursor - 1);
        break;
      case "PageDown":
        this.moveTo(this.cursor + page);
        break;
      case "PageUp":
        this.moveTo(this.cursor - page);
        break;
      case "Home":
      case "g":
        this.moveTo(0);
        break;
      case "End":
      case "G":
        this.moveTo(this.rows.length - 1);
        break;
      case "ArrowRight":
      case "l":
        if (!row) break;
        if (row.entry.isDir && !this.expanded.has(row.entry.path)) void this.toggle(row.entry, true);
        else if (row.entry.isDir) this.moveTo(this.cursor + 1);
        else this.choose(row.entry);
        break;
      case "ArrowLeft":
      case "h": {
        if (!row) break;
        if (row.entry.isDir && this.expanded.has(row.entry.path)) {
          void this.toggle(row.entry, false);
        } else {
          const parent = dirname(row.entry.path);
          this.moveTo(this.rows.findIndex((r) => r.entry.path === parent), false);
        }
        break;
      }
      case "Enter":
      case " ":
        if (!row) break;
        if (row.entry.isDir) void this.toggle(row.entry);
        else this.choose(row.entry);
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
