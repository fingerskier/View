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

    async function mount() {
      view?.dispose();
      pane?.remove();
      childTools.replaceChildren();
      pane = el("div", { class: "pane" });
      host.append(pane);
      const child = { ...ctx, tools: childTools };
      view = source ? await code(pane, child) : await rendered(pane, child);
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
        view?.dispose();
        pane?.remove();
      },
    };
  };
}
