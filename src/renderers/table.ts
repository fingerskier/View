import Papa from "papaparse";
import { el, formatSize, messageBox, prefs, toggleButton } from "../util";
import { withSource } from "./source";
import type { Renderer } from "./types";

const MAX_ROWS = 5000;

const delimiters: Record<string, string> = { tsv: "\t", tab: "\t", psv: "|" };

const table: Renderer = async (host, ctx) => {
  const wrap = el("div", { class: "table-view" });
  const info = el("span", { class: "tool-info" });
  host.append(wrap);

  let header = prefs.get("table:header", true);
  let rows: string[][] = [];
  let note: HTMLElement | null = null;

  toggleButton(ctx.tools, "Header", header, (on) => {
    header = on;
    prefs.set("table:header", on);
    draw();
  }, { key: "t", title: "First row is a header (t)" });
  ctx.tools.append(info);

  function draw() {
    const t = el("table", { class: "grid" });
    const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
    const body = header ? rows.slice(1) : rows;
    if (header && rows.length) {
      const tr = el("tr", {}, el("th", { class: "rownum" }));
      for (let c = 0; c < cols; c++) tr.append(el("th", { text: rows[0][c] ?? "" }));
      t.append(el("thead", {}, tr));
    }
    const tbody = el("tbody");
    body.slice(0, MAX_ROWS).forEach((row, i) => {
      const tr = el("tr", {}, el("td", { class: "rownum", text: String(i + 1) }));
      for (let c = 0; c < cols; c++) {
        const v = row[c] ?? "";
        tr.append(el("td", { text: v, class: v !== "" && !Number.isNaN(Number(v)) ? "num" : "" }));
      }
      tbody.append(tr);
    });
    t.append(tbody);
    info.textContent = `${body.length.toLocaleString()} rows × ${cols} cols`;
    wrap.replaceChildren(...(note ? [note] : []), t);
    if (body.length > MAX_ROWS) {
      wrap.append(messageBox("info", `Showing the first ${MAX_ROWS.toLocaleString()} of ${body.length.toLocaleString()} rows`));
    }
  }

  async function load() {
    const file = await ctx.text();
    const parsed = Papa.parse<string[]>(file.text, {
      delimiter: delimiters[ctx.type.ext] ?? "",
      skipEmptyLines: "greedy",
    });
    rows = parsed.data;
    note = file.truncated
      ? messageBox("info", `Showing the first ${formatSize(file.text.length)} of ${formatSize(file.size)}`)
      : null;
    const top = wrap.scrollTop;
    draw();
    wrap.scrollTop = top;
  }

  await load();
  return { update: load, dispose: () => wrap.remove() };
};

export default withSource(table);
