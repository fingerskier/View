import { el, prefs, toggleButton } from "../util";
import type { Renderer } from "./types";

export const image: Renderer = async (host, ctx) => {
  const frame = el("div", { class: "image-view" });
  const img = el("img", { alt: ctx.type.ext, draggable: "false" });
  const info = el("span", { class: "tool-info" });
  frame.append(img);
  host.append(frame);

  let actual = prefs.get("image:actual", false);
  frame.classList.toggle("actual", actual);
  toggleButton(ctx.tools, "1:1", actual, (on) => {
    actual = on;
    prefs.set("image:actual", on);
    frame.classList.toggle("actual", on);
  }, { key: "1", title: "Actual size (1)" });
  ctx.tools.append(info);

  function load(): Promise<void> {
    return new Promise((resolve) => {
      const next = new Image();
      next.onload = () => {
        img.src = next.src;
        info.textContent = `${next.naturalWidth} × ${next.naturalHeight}`;
        frame.querySelector(".message")?.remove();
        resolve();
      };
      next.onerror = () => {
        info.textContent = "";
        if (!frame.querySelector(".message")) {
          frame.append(el("div", { class: "message error" }, el("strong", { text: "This image could not be decoded." })));
        }
        resolve();
      };
      next.src = ctx.url();
    });
  }

  await load();
  return { update: load, dispose: () => frame.remove() };
};

export default image;
