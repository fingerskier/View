import { openPath } from "@tauri-apps/plugin-opener";
import { actionButton, el, previewUrl, toggleButton } from "../util";
import { withSource } from "./source";
import type { Renderer } from "./types";

/** HTML in a sandboxed frame served over `preview://`: relative assets load,
 * scripts stay off unless enabled for this file, and the protocol's CSP keeps
 * the page off the network either way. */
const html: Renderer = async (host, ctx) => {
  const frame = el("iframe", { class: "html-view", title: ctx.path, referrerpolicy: "no-referrer" });
  let scripts = false;
  const load = () => {
    frame.setAttribute("sandbox", scripts ? "allow-same-origin allow-scripts" : "allow-same-origin");
    frame.src = `${previewUrl(ctx.path, scripts)}${scripts ? "&" : "?"}v=${ctx.version()}`;
  };
  toggleButton(ctx.tools, "Scripts", scripts, (on) => {
    scripts = on;
    load();
  }, { key: "x", title: "Allow scripts in this page (x); the network stays blocked" });
  actionButton(ctx.tools, "Browser", () => void openPath(ctx.path), { key: "b", title: "Open in the default browser (b)" });
  host.append(frame);
  load();
  return {
    update: async () => load(),
    dispose: () => frame.remove(),
  };
};

export default withSource(html);
