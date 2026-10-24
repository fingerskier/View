import { el, prefs, toggleButton } from "../util";
import code from "./code";
import type { Renderer, View } from "./types";

/** Wrap a rendered view with a Rendered/Source toggle (key `s`), remembered per kind. */
export function withSource(rendered: Renderer): Renderer {
  return async (host, ctx) => {
    const key = `source:${ctx.type.kind}`;
    let source = prefs.get(key, false);
    const childTools = el("span", { class: "tool-group" });
    ctx.tools.append(childTools);
    let view: View | null = null;
    let pane: HTMLElement | null = null;
    let seq = 0;

    async function mount() {
      const mine = ++seq;
      view?.dispose();
      view = null;
      pane?.remove();
      childTools.replaceChildren();
      const myPane = el("div", { class: "pane" });
      pane = myPane;
      host.append(myPane);
      const child = { ...ctx, tools: childTools };
      const next = source ? await code(myPane, child) : await rendered(myPane, child);
      // A later toggle (or disposal) superseded this mount while it rendered.
      if (mine !== seq) next.dispose();
      else view = next;
    }

    toggleButton(ctx.tools, "Source", source, async (on) => {
      source = on;
      prefs.set(key, on);
      await mount();
    }, { key: "s" });

    await mount();
    return {
      update: () => view?.update() ?? Promise.resolve(),
      retheme: () => view?.retheme?.(),
      dispose: () => {
        seq++;
        view?.dispose();
        pane?.remove();
      },
    };
  };
}
