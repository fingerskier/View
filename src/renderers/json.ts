import { el, formatSize, messageBox } from "../util";
import { withSource } from "./source";
import type { Renderer } from "./types";

const MAX_CHILDREN = 1000;

function primitive(value: unknown): HTMLElement {
  if (value === null) return el("span", { class: "j-null", text: "null" });
  switch (typeof value) {
    case "string":
      return el("span", { class: "j-str", text: JSON.stringify(value) });
    case "number":
      return el("span", { class: "j-num", text: String(value) });
    case "boolean":
      return el("span", { class: "j-bool", text: String(value) });
    default:
      return el("span", { text: String(value) });
  }
}

function node(key: string | null, value: unknown, path: string, open: Set<string>, depth: number): HTMLElement {
  const label = key === null ? [] : [el("span", { class: "j-key", text: key }), ": "];
  if (value === null || typeof value !== "object") {
    return el("div", { class: "j-row" }, ...label, primitive(value));
  }
  const isArray = Array.isArray(value);
  const entries = isArray ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as object);
  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`;
  const details = el("details", { "data-path": path });
  details.open = open.size ? open.has(path) : depth < 2;
  details.append(el("summary", {}, ...label, el("span", { class: "j-meta", text: summary })));
  // Children are built on first open: huge documents stay cheap.
  const fill = () => {
    if (details.dataset.filled) return;
    details.dataset.filled = "1";
    for (const [k, v] of entries.slice(0, MAX_CHILDREN)) {
      details.append(node(k, v, `${path}/${k}`, open, depth + 1));
    }
    if (entries.length > MAX_CHILDREN) {
      details.append(el("div", { class: "j-row j-meta", text: `… ${entries.length - MAX_CHILDREN} more` }));
    }
  };
  if (details.open) fill();
  details.addEventListener("toggle", fill);
  return details;
}

const json: Renderer = async (host, ctx) => {
  const wrap = el("div", { class: "json-view" });
  host.append(wrap);

  async function load() {
    const file = await ctx.text();
    const open = new Set(Array.from(wrap.querySelectorAll<HTMLDetailsElement>("details[open]"), (d) => d.dataset.path!));
    let value: unknown;
    try {
      value = ["jsonl", "ndjson"].includes(ctx.type.ext)
        ? file.text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
        : JSON.parse(file.text);
    } catch (e) {
      const why = file.truncated ? `the file is larger than ${formatSize(file.text.length)}` : String(e instanceof Error ? e.message : e);
      wrap.replaceChildren(messageBox("error", "Not valid JSON", `${why}. Press s for the source.`));
      return;
    }
    wrap.replaceChildren(node(null, value, "", open, 0));
  }

  await load();
  return { update: load, dispose: () => wrap.remove() };
};

export default withSource(json);
