import { api } from "../api";
import { assetUrl, el, messageBox } from "../util";
import { mountPdf } from "./pdf";
import type { Renderer, View } from "./types";

/** Converted to PDF by a headless LibreOffice (no window), cached by mtime. */
export const officeAsPdf: Renderer = async (host, ctx) => {
  if (!ctx.session.hasOffice) {
    host.append(
      messageBox(
        "info",
        `No previewer for .${ctx.type.ext} without LibreOffice`,
        "Install libreoffice-fresh (or libreoffice-still); it is only ever run headless to convert to PDF.",
      ),
    );
    return { update: async () => {}, dispose: () => host.replaceChildren() };
  }

  const busy = el("div", { class: "busy", text: "Converting with LibreOffice…" });
  host.append(busy);
  let view: View | null = null;
  try {
    view = await mountPdf(host, ctx.tools, async () => {
      busy.hidden = false;
      try {
        return assetUrl(await api.officePdf(ctx.path), ctx.version());
      } finally {
        busy.hidden = true;
      }
    });
  } catch (e) {
    busy.remove();
    host.append(messageBox("error", "Conversion failed", e instanceof Error ? e.message : String(e)));
    return { update: async () => {}, dispose: () => host.replaceChildren() };
  }
  return {
    update: () => view!.update(),
    dispose: () => {
      view?.dispose();
      busy.remove();
    },
  };
};

export default officeAsPdf;
