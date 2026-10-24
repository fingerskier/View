import { api } from "../api";
import { el, formatSize, messageBox } from "../util";

const HEAD = 64 * 1024;

export async function hexView(path: string, size: number): Promise<HTMLElement> {
  const bytes = new Uint8Array(await api.readHead(path, HEAD));
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const row = bytes.subarray(off, off + 16);
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, "0"));
    const left = hex.slice(0, 8).join(" ").padEnd(23);
    const right = hex.slice(8).join(" ").padEnd(23);
    const ascii = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "·")).join("");
    lines.push(`${off.toString(16).padStart(8, "0")}  ${left}  ${right}  │${ascii}│`);
  }
  const note = size > bytes.length
    ? `Binary file · ${formatSize(size)} · first ${formatSize(bytes.length)} shown`
    : `Binary file · ${formatSize(size)}`;
  return el("div", { class: "hex-view" }, messageBox("info", note), el("pre", { text: lines.join("\n") }));
}
