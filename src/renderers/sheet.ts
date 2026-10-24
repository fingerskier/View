import * as XLSX from "xlsx";
import { el, messageBox } from "../util";
import type { Renderer } from "./types";

const MAX_ROWS = 5000;
const MAX_COLS = 200;

function renderSheet(ws: XLSX.WorkSheet): HTMLElement {
  const ref = ws["!ref"];
  if (!ref) return messageBox("info", "This sheet is empty.");
  const range = XLSX.utils.decode_range(ref);
  const lastRow = Math.min(range.e.r, range.s.r + MAX_ROWS - 1);
  const lastCol = Math.min(range.e.c, range.s.c + MAX_COLS - 1);

  // Merged regions: the top-left cell spans, the rest are skipped.
  const spans = new Map<string, { rows: number; cols: number }>();
  const covered = new Set<string>();
  for (const m of ws["!merges"] ?? []) {
    spans.set(`${m.s.r}:${m.s.c}`, { rows: m.e.r - m.s.r + 1, cols: m.e.c - m.s.c + 1 });
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(`${r}:${c}`);
    }
  }

  const table = el("table", { class: "grid sheet" });
  const head = el("tr", {}, el("th", { class: "rownum" }));
  for (let c = range.s.c; c <= lastCol; c++) head.append(el("th", { text: XLSX.utils.encode_col(c) }));
  table.append(el("thead", {}, head));

  const body = el("tbody");
  for (let r = range.s.r; r <= lastRow; r++) {
    const tr = el("tr", {}, el("td", { class: "rownum", text: String(r + 1) }));
    for (let c = range.s.c; c <= lastCol; c++) {
      const key = `${r}:${c}`;
      if (covered.has(key)) continue;
      const cell: XLSX.CellObject | undefined = ws[XLSX.utils.encode_cell({ r, c })];
      const td = el("td", { text: cell ? XLSX.utils.format_cell(cell) : "" });
      if (cell?.t === "n") td.className = "num";
      if (cell?.f) td.title = `=${cell.f}`;
      const span = spans.get(key);
      if (span) {
        td.rowSpan = span.rows;
        td.colSpan = span.cols;
      }
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);

  const wrap = el("div", { class: "table-view" }, table);
  if (range.e.r > lastRow || range.e.c > lastCol) {
    wrap.append(messageBox("info", `Showing ${lastRow - range.s.r + 1} of ${range.e.r - range.s.r + 1} rows, ${lastCol - range.s.c + 1} of ${range.e.c - range.s.c + 1} columns`));
  }
  return wrap;
}

/** Excel, ODS and legacy .xls via SheetJS, one tab per sheet. */
const sheet: Renderer = async (host, ctx) => {
  const tabs = el("nav", { class: "sheet-tabs" });
  const body = el("div", { class: "sheet-body" });
  host.append(body, tabs);
  let active: string | null = null;
  let book: XLSX.WorkBook | null = null;

  function show(name: string) {
    if (!book) return;
    active = name;
    for (const t of tabs.children) t.classList.toggle("active", (t as HTMLElement).dataset.sheet === name);
    body.replaceChildren(renderSheet(book.Sheets[name]));
  }

  async function load() {
    book = XLSX.read(await ctx.bytes(), { type: "array", cellDates: true, cellFormula: true, dense: false });
    tabs.replaceChildren(
      ...book.SheetNames.map((name) => {
        const b = el("button", { class: "sheet-tab", "data-sheet": name, text: name });
        b.addEventListener("click", () => show(name));
        return b;
      }),
    );
    tabs.hidden = book.SheetNames.length < 2;
    show(active && book.SheetNames.includes(active) ? active : book.SheetNames[0]);
  }

  await load();
  return { update: load, dispose: () => host.replaceChildren() };
};

export default sheet;
