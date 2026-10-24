import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { actionButton, el, messageBox, prefs } from "../util";
import type { Renderer, View } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const vendor = new URL("vendor/pdfjs/", document.baseURI).href;

/** Mount a pdf.js viewer whose document comes from `source()` (an asset URL).
 * `update()` reloads the document and restores page, zoom and scroll. */
export async function mountPdf(host: HTMLElement, tools: HTMLElement, source: () => Promise<string>): Promise<View> {
  const container = el("div", { class: "pdf-view" }, el("div", { class: "pdfViewer" }));
  host.append(container);
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const viewer = new PDFViewer({ container, eventBus, linkService, removePageBorders: false });
  linkService.setViewer(viewer);

  let scale = prefs.get<string>("pdf:scale", "page-width");
  const pageInfo = el("span", { class: "tool-info" });
  const setScale = (value: string) => {
    scale = value;
    viewer.currentScaleValue = value;
    prefs.set("pdf:scale", value);
  };
  actionButton(tools, "−", () => setScale(String(Math.max(0.25, viewer.currentScale / 1.2))), { key: "-", title: "Zoom out (-)" });
  actionButton(tools, "+", () => setScale(String(Math.min(8, viewer.currentScale * 1.2))), { key: "=", title: "Zoom in (=)" });
  actionButton(tools, "Width", () => setScale("page-width"), { key: "f", title: "Fit width (f)" });
  actionButton(tools, "Page", () => setScale("page-fit"), { key: "p", title: "Fit page (p)" });
  tools.append(pageInfo);

  const updateInfo = () => {
    pageInfo.textContent = viewer.pagesCount ? `${viewer.currentPageNumber} / ${viewer.pagesCount}` : "";
  };
  eventBus.on("pagechanging", updateInfo);
  eventBus.on("pagesinit", () => {
    viewer.currentScaleValue = scale;
    updateInfo();
  });
  const onResize = new ResizeObserver(() => {
    if (viewer.pagesCount && Number.isNaN(Number(scale))) viewer.currentScaleValue = scale;
  });
  onResize.observe(container);

  let task: pdfjs.PDFDocumentLoadingTask | null = null;

  async function load() {
    const url = await source();
    const nextTask = pdfjs.getDocument({
      url,
      cMapUrl: `${vendor}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${vendor}standard_fonts/`,
      wasmUrl: `${vendor}wasm/`,
      iccUrl: `${vendor}iccs/`,
    });
    let next: pdfjs.PDFDocumentProxy;
    try {
      next = await nextTask.promise;
    } catch (e) {
      void nextTask.destroy();
      container.querySelector(".message")?.remove();
      container.prepend(messageBox("error", "This PDF could not be opened.", e instanceof Error ? e.message : String(e)));
      return;
    }
    container.querySelector(".message")?.remove();
    const page = viewer.pagesCount ? viewer.currentPageNumber : 1;
    const top = container.scrollTop;
    const left = container.scrollLeft;
    const restore = () => {
      viewer.currentScaleValue = scale;
      if (page > 1) viewer.currentPageNumber = Math.min(page, next.numPages);
      container.scrollTop = top;
      container.scrollLeft = left;
      updateInfo();
    };
    if (task) eventBus.on("pagesinit", restore, { once: true });
    viewer.setDocument(next);
    linkService.setDocument(next, null);
    const old = task;
    task = nextTask;
    await old?.destroy();
  }

  await load();
  return {
    update: load,
    dispose: () => {
      onResize.disconnect();
      viewer.setDocument(null as never);
      void task?.destroy();
      container.remove();
    },
  };
}

const pdf: Renderer = (host, ctx) => mountPdf(host, ctx.tools, async () => ctx.url());

export default pdf;
