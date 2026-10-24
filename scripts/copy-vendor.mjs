// Copy decoder/data files that libraries fetch at runtime by URL into public/vendor.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");
const out = join(root, "public", "vendor");

const copies = [
  ["three/examples/jsm/libs/draco/gltf", "draco"],
  ["pdfjs-dist/cmaps", "pdfjs/cmaps"],
  ["pdfjs-dist/standard_fonts", "pdfjs/standard_fonts"],
  ["pdfjs-dist/wasm", "pdfjs/wasm"],
  ["pdfjs-dist/iccs", "pdfjs/iccs"],
];

for (const [from, to] of copies) {
  const src = join(nm, from);
  if (!existsSync(src)) {
    console.warn(`copy-vendor: missing ${from}`);
    continue;
  }
  mkdirSync(join(out, to), { recursive: true });
  cpSync(src, join(out, to), { recursive: true });
}
