import { describe, expect, it } from "vitest";
import { classify } from "./filetypes";
import { assetUrl, extname, previewUrl, relativeTo, resolvePath } from "./util";

describe("assetUrl", () => {
  it("keeps separators so relative references resolve beside the file", () => {
    const url = assetUrl("/home/me/models/ship.gltf", 7);
    expect(url).toBe("asset://localhost/%2Fhome/me/models/ship.gltf?v=7");
    expect(new URL("ship.bin", url).href).toBe("asset://localhost/%2Fhome/me/models/ship.bin");
    expect(new URL("../tex/a.png", url).href).toBe("asset://localhost/%2Fhome/me/tex/a.png");
  });

  it("has a preview twin that carries the scripts flag", () => {
    expect(previewUrl("/r/site/index.html", false)).toBe("preview://localhost/%2Fr/site/index.html");
    expect(previewUrl("/r/site/index.html", true)).toBe("preview://localhost/%2Fr/site/index.html?scripts=1");
    expect(new URL("css/app.css", previewUrl("/r/site/index.html", true)).href).toBe("preview://localhost/%2Fr/site/css/app.css");
  });

  it("percent-encodes each segment", () => {
    expect(assetUrl("/a b/c#d?.md")).toBe("asset://localhost/%2Fa%20b/c%23d%3F.md");
  });
});

describe("paths", () => {
  it("resolves relative refs lexically", () => {
    expect(resolvePath("/r/docs", "../img/x.png")).toBe("/r/img/x.png");
    expect(resolvePath("/r/docs", "./a/./b.md")).toBe("/r/docs/a/b.md");
    expect(resolvePath("/r/docs", "/abs/file")).toBe("/abs/file");
  });

  it("makes paths relative to the root", () => {
    expect(relativeTo("/r", "/r/a/b.md")).toBe("a/b.md");
    expect(relativeTo("/r", "/rr/a")).toBe("/rr/a");
  });

  it("finds extensions, ignoring dotfiles", () => {
    expect(extname("/x/Model.GLB")).toBe("glb");
    expect(extname("/x/.bashrc")).toBe("");
    expect(extname("/x/archive.tar.gz")).toBe("gz");
  });
});

describe("classify", () => {
  const kind = (p: string) => classify(p).kind;

  it("routes by extension", () => {
    expect(kind("/a/README.md")).toBe("markdown");
    expect(kind("/a/part.STL")).toBe("mesh");
    expect(kind("/a/scene.glb")).toBe("mesh");
    expect(kind("/a/report.docx")).toBe("docx");
    expect(kind("/a/budget.xlsx")).toBe("sheet");
    expect(kind("/a/legacy.xls")).toBe("sheet");
    expect(kind("/a/calc.ods")).toBe("sheet");
    expect(kind("/a/letter.odt")).toBe("office");
    expect(kind("/a/deck.pptx")).toBe("office");
    expect(kind("/a/paper.pdf")).toBe("pdf");
    expect(kind("/a/data.tsv")).toBe("table");
    expect(kind("/a/logo.svg")).toBe("svg");
    expect(kind("/a/clip.webm")).toBe("video");
  });

  it("falls back to code with a language hint", () => {
    expect(classify("/a/main.rs")).toMatchObject({ kind: "code", lang: "rs" });
    expect(classify("/a/Dockerfile")).toMatchObject({ kind: "code", lang: "docker" });
    expect(classify("/a/config.yml")).toMatchObject({ kind: "code", lang: "yaml" });
    expect(classify("/a/.env.local")).toMatchObject({ kind: "code", lang: "dotenv" });
    expect(classify("/a/noext")).toMatchObject({ kind: "code", lang: "text" });
  });
});
