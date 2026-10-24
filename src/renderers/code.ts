import { HIGHLIGHT_LIMIT, highlight } from "../highlight";
import { el, formatSize, messageBox, prefs, toggleButton } from "../util";
import { hexView } from "./hex";
import type { Renderer } from "./types";

/** Source code and plain text; binary content falls back to a hex dump. */
const code: Renderer = async (host, ctx) => {
  const box = el("div", { class: "code-view" });
  host.append(box);
  let wrap = prefs.get("code:wrap", false);
  box.classList.toggle("wrap", wrap);
  toggleButton(ctx.tools, "Wrap", wrap, (on) => {
    wrap = on;
    prefs.set("code:wrap", on);
    box.classList.toggle("wrap", on);
  }, { key: "w" });

  async function draw() {
    const file = await ctx.text();
    if (file.binary) {
      box.replaceChildren(await hexView(ctx.path, file.size));
      return;
    }
    const html = await highlight(file.text, ctx.type.lang);
    box.innerHTML = html;
    box.classList.toggle("numbered", file.text.length <= HIGHLIGHT_LIMIT);
    if (file.truncated) {
      box.prepend(messageBox("info", `Showing the first ${formatSize(file.text.length)} of ${formatSize(file.size)}`));
    }
  }

  await draw();
  return { update: draw, dispose: () => box.remove() };
};

export default code;
