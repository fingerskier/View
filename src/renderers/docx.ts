import { renderAsync } from "docx-preview";
import { el, prefs, toggleButton } from "../util";
import { officeAsPdf } from "./office";
import type { Renderer, View } from "./types";

/** Word documents rendered in-page by docx-preview; "Print" switches to
 * LibreOffice's exact pagination when it is installed. */
const docx: Renderer = async (host, ctx) => {
  const childTools = el("span", { class: "tool-group" });
  ctx.tools.append(childTools);
  let print = ctx.session.hasOffice && prefs.get<boolean>("docx:print", false);
  let invert = prefs.get("docx:invert", false);
  let view: View | null = null;
  let pane: HTMLElement | null = null;
  let seq = 0;

  const quick: Renderer = async (paneHost) => {
    const styles = el("div");
    const body = el("div", { class: "docx-view" });
    paneHost.append(styles, body);
    const draw = async () => {
      const top = body.scrollTop;
      const next = el("div");
      const nextStyles = el("div");
      await renderAsync(await ctx.bytes(), next, nextStyles, {
        className: "docx",
        inWrapper: true,
        breakPages: true,
        experimental: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
      });
      styles.replaceChildren(...nextStyles.childNodes);
      body.replaceChildren(...next.childNodes);
      body.scrollTop = top;
    };
    await draw();
    return { update: draw, dispose: () => paneHost.replaceChildren() };
  };

  async function mount() {
    const mine = ++seq;
    view?.dispose();
    view = null;
    pane?.remove();
    childTools.replaceChildren();
    const myPane = el("div", { class: "pane" });
    pane = myPane;
    myPane.classList.toggle("invert-pages", invert);
    host.append(myPane);
    const next = await (print ? officeAsPdf : quick)(myPane, { ...ctx, tools: childTools });
    if (mine !== seq) next.dispose();
    else view = next;
  }

  toggleButton(ctx.tools, "Invert", invert, (on) => {
    invert = on;
    prefs.set("docx:invert", on);
    pane?.classList.toggle("invert-pages", on);
  }, { key: "i", title: "Dark pages (i)" });
  if (ctx.session.hasOffice) {
    toggleButton(ctx.tools, "Print", print, async (on) => {
      print = on;
      prefs.set("docx:print", on);
      await mount();
    }, { key: "o", title: "Exact print layout via LibreOffice (o)" });
  }

  await mount();
  return {
    update: () => view?.update() ?? Promise.resolve(),
    dispose: () => {
      seq++;
      view?.dispose();
      pane?.remove();
    },
  };
};

export default docx;
