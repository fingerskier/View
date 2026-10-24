import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, onFsChanged, onThemeChanged } from "./api";
import { applyTheme } from "./theme";
import { Tree } from "./tree";
import { prefs } from "./util";
import { Viewer } from "./viewer";
import "./styles.css";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  const [session, theme] = await Promise.all([api.session(), api.theme().catch(() => null)]);
  applyTheme(theme);

  const app = $("app");
  const rootLabel = $("root-label");
  rootLabel.textContent = session.root === "/" ? "/" : session.root.slice(session.root.lastIndexOf("/") + 1);
  rootLabel.title = session.rootLabel;
  app.style.setProperty("--sidebar-w", `${prefs.get("sidebar:width", 280)}px`);
  app.classList.toggle("no-sidebar", prefs.get("sidebar:hidden", false));

  let tree: Tree;
  const viewer = new Viewer(
    {
      view: $("view"),
      tools: $("tools"),
      crumbs: $("crumbs"),
      kind: $("status-kind"),
      size: $("status-size"),
      time: $("status-time"),
      live: $("status-live"),
    },
    session,
    (path) => void navigate(path),
  );

  async function navigate(path: string) {
    if (!(await tree.reveal(path))) {
      try {
        await api.stat(path);
      } catch {
        $("status-live").textContent = `not found: ${path}`;
        return;
      }
    }
    tree.setSelected(path);
    await viewer.open(path);
  }

  tree = new Tree($("tree"), session.root, {
    open: (entry) => void viewer.open(entry.path),
    visibleDirs: (dirs) => void api.watchDirs(dirs).catch(() => {}),
  });
  await tree.init();

  const hiddenBtn = $("toggle-hidden");
  hiddenBtn.setAttribute("aria-pressed", String(tree.showAll));
  const toggleHidden = async () => hiddenBtn.setAttribute("aria-pressed", String(await tree.toggleShowAll()));
  hiddenBtn.addEventListener("click", () => void toggleHidden());
  $("collapse-all").addEventListener("click", () => tree.collapseAll());

  await onFsChanged((paths) => {
    tree.onFsChanged(paths);
    viewer.onFsChanged(paths);
  });
  await onThemeChanged((t) => {
    applyTheme(t);
    viewer.retheme();
  });

  if (session.initial) await navigate(session.initial);
  else viewer.welcome();
  tree.focus();

  const toggleSidebar = () => {
    const hidden = app.classList.toggle("no-sidebar");
    prefs.set("sidebar:hidden", hidden);
    if (!hidden) tree.focus();
  };

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable=true]")) return;
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.key === "b") toggleSidebar();
      else if (e.key === "q" || e.key === "w") void getCurrentWindow().close();
      else return;
      e.preventDefault();
      return;
    }
    if (e.altKey || e.metaKey) return;
    switch (e.key) {
      case "q":
        void getCurrentWindow().close();
        break;
      case ".":
        void toggleHidden();
        break;
      case "r":
      case "F5":
        void viewer.reload();
        break;
      default: {
        const btn = document.querySelector<HTMLButtonElement>(`#tools button[data-key="${CSS.escape(e.key)}"]`);
        if (!btn) return;
        btn.click();
      }
    }
    e.preventDefault();
  });

  // Drag to resize the sidebar.
  const resizer = $("resizer");
  resizer.addEventListener("pointerdown", (down) => {
    resizer.setPointerCapture(down.pointerId);
    resizer.classList.add("dragging");
    const move = (e: PointerEvent) => {
      const w = Math.max(160, Math.min(window.innerWidth - 240, e.clientX));
      app.style.setProperty("--sidebar-w", `${w}px`);
    };
    const up = (e: PointerEvent) => {
      resizer.releasePointerCapture(e.pointerId);
      resizer.classList.remove("dragging");
      resizer.removeEventListener("pointermove", move);
      prefs.set("sidebar:width", parseInt(app.style.getPropertyValue("--sidebar-w"), 10));
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", up, { once: true });
  });
}

main().catch((e) => {
  document.body.textContent = `view failed to start: ${e instanceof Error ? e.message : e}`;
});
