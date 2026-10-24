import { basename, extname } from "./util";

export type Kind =
  | "markdown"
  | "code"
  | "image"
  | "svg"
  | "pdf"
  | "table"
  | "json"
  | "html"
  | "video"
  | "audio"
  | "mesh"
  | "docx"
  | "sheet"
  | "office";

export interface FileType {
  kind: Kind;
  /** Shiki language hint for code/source views. */
  lang: string;
  ext: string;
}

const groups: Record<Exclude<Kind, "code">, string[]> = {
  markdown: ["md", "markdown", "mdown", "mkd", "mkdn", "mdx"],
  image: ["png", "jpg", "jpeg", "jfif", "pjpeg", "gif", "webp", "avif", "bmp", "ico", "cur", "apng", "jxl"],
  svg: ["svg"],
  pdf: ["pdf"],
  table: ["csv", "tsv", "tab", "psv"],
  json: ["json", "geojson", "topojson", "webmanifest", "jsonl", "ndjson", "har"],
  html: ["html", "htm", "xhtml"],
  video: ["mp4", "m4v", "webm", "mkv", "mov", "ogv", "avi"],
  audio: ["mp3", "wav", "ogg", "oga", "opus", "flac", "m4a", "aac", "weba"],
  mesh: [
    "stl", "obj", "ply", "gltf", "glb", "fbx", "3mf", "dae", "3ds", "amf",
    "vtk", "vtp", "wrl", "vrml", "pcd", "xyz", "off", "usdz", "usda", "usdc", "usd",
  ],
  docx: ["docx", "docm", "dotx", "dotm"],
  sheet: ["xlsx", "xlsm", "xlsb", "xls", "xltx", "xltm", "ods", "fods"],
  office: [
    "odt", "ott", "fodt", "doc", "dot", "rtf", "wpd",
    "pptx", "pptm", "ppt", "pps", "ppsx", "potx", "odp", "otp", "fodp",
    "odg", "otg", "vsd", "vsdx", "pub",
  ],
};

const byExt = new Map<string, Kind>();
for (const [kind, exts] of Object.entries(groups) as [Kind, string[]][]) {
  for (const ext of exts) byExt.set(ext, kind);
}

/** Extensions whose Shiki language id differs from the extension itself
 * (Shiki's own aliases cover the rest at lookup time). */
const langByExt: Record<string, string> = {
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cc: "cpp",
  cxx: "cpp",
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  yml: "yaml",
  zsh: "bash",
  ksh: "bash",
  conf: "ini",
  cfg: "ini",
  service: "ini",
  desktop: "ini",
  lock: "toml",
  plist: "xml",
  xsd: "xml",
  xsl: "xml",
  rss: "xml",
  atom: "xml",
  kml: "xml",
  gpx: "xml",
  csproj: "xml",
  ipynb: "json",
  jsonc: "jsonc",
  json5: "json5",
  txt: "text",
  log: "log",
  pyw: "python",
  pyi: "python",
  gradle: "groovy",
  tf: "hcl",
  tfvars: "hcl",
  gcode: "gcode",
  nc: "gcode",
  ex: "elixir",
  exs: "elixir",
  mk: "make",
  qml: "qml",
};

const langByName: Record<string, string> = {
  dockerfile: "docker",
  containerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
  "cmakelists.txt": "cmake",
  justfile: "just",
  ".bashrc": "bash",
  ".bash_profile": "bash",
  ".zshrc": "bash",
  ".profile": "bash",
  ".gitignore": "text",
  ".gitattributes": "text",
  ".env": "dotenv",
  pkgbuild: "bash",
  "cargo.lock": "toml",
  license: "text",
  readme: "text",
};

export function classify(path: string): FileType {
  const name = basename(path).toLowerCase();
  const ext = extname(name);
  const kind = byExt.get(ext);
  if (kind) {
    const lang = { markdown: "markdown", svg: "xml", html: "html", json: "json", table: "csv" }[kind as string] ?? "text";
    return { kind, lang, ext };
  }
  const lang = langByName[name] ?? (name.startsWith(".env") ? "dotenv" : undefined) ?? langByExt[ext] ?? (ext || "text");
  return { kind: "code", lang, ext };
}

/** A coarse color group for tree icons. */
export function iconClass(path: string, isDir: boolean): string {
  return isDir ? "ic-dir" : `ic-${classify(path).kind}`;
}
