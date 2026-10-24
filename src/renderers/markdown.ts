import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { highlight } from "../highlight";
import { cssVar, themeMode } from "../theme";
import { assetUrl, dirname, el, resolvePath } from "../util";
import { withSource } from "./source";
import type { Ctx, Renderer } from "./types";

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

function splitFrontMatter(text: string): { front: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/.exec(text);
  return m ? { front: m[1], body: text.slice(m[0].length) } : { front: null, body: text };
}

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
}

let mermaidSeq = 0;

async function renderMermaid(blocks: HTMLElement[]) {
  if (!blocks.length) return;
  const { default: mermaid } = await import("mermaid");
  const v = (name: string) => cssVar(name);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    darkMode: themeMode() === "dark",
    fontFamily: "var(--font-ui)",
    themeVariables: {
      background: v("--bg"),
      primaryColor: v("--bg-light"),
      primaryTextColor: v("--fg"),
      primaryBorderColor: v("--accent"),
      secondaryColor: v("--bg-dark"),
      tertiaryColor: v("--bg-darker"),
      lineColor: v("--fg-dim"),
      textColor: v("--fg"),
      mainBkg: v("--bg-light"),
      nodeBorder: v("--accent"),
      clusterBkg: v("--bg-dark"),
      noteBkgColor: v("--bg-light"),
      noteTextColor: v("--fg"),
    },
  });
  for (const block of blocks) {
    const src = block.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`mermaid-${++mermaidSeq}`, src);
      const fig = el("figure", { class: "mermaid" });
      fig.innerHTML = svg;
      block.replaceWith(fig);
    } catch (e) {
      block.replaceWith(el("pre", { class: "mermaid-error", text: `mermaid: ${e instanceof Error ? e.message : e}\n\n${src}` }));
    }
  }
}

async function build(article: HTMLElement, ctx: Ctx) {
  const file = await ctx.text();
  const { front, body } = splitFrontMatter(file.text);
  const html = DOMPurify.sanitize(md.render(body), { ADD_ATTR: ["start"], FORBID_TAGS: ["form", "style"] });
  const next = el("div");
  next.innerHTML = html;

  const dir = dirname(ctx.path);
  const v = ctx.version();
  for (const node of next.querySelectorAll<HTMLElement>("img[src], video[src], audio[src], source[src]")) {
    const src = node.getAttribute("src")!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) continue;
    let ref = src;
    try {
      ref = decodeURI(src);
    } catch {
      /* keep as written */
    }
    node.setAttribute("src", assetUrl(resolvePath(dir, ref.split(/[?#]/)[0]), v));
  }

  for (const h of next.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")) {
    if (!h.id) h.id = slugify(h.textContent ?? "");
  }

  for (const li of next.querySelectorAll("li")) {
    const first = li.firstChild?.nodeType === Node.TEXT_NODE ? li.firstChild : li.firstElementChild?.tagName === "P" ? li.firstElementChild.firstChild : null;
    const m = first?.nodeType === Node.TEXT_NODE ? /^\[([ xX])\]\s/.exec(first.textContent ?? "") : null;
    if (m && first) {
      first.textContent = (first.textContent ?? "").slice(m[0].length);
      const box = el("input", { type: "checkbox", disabled: "" });
      (box as HTMLInputElement).checked = m[1] !== " ";
      first.parentNode!.insertBefore(box, first);
      li.classList.add("task");
    }
  }

  const mermaidBlocks: HTMLElement[] = [];
  for (const code of next.querySelectorAll<HTMLElement>("pre > code")) {
    const lang = /language-([\w+#.-]+)/.exec(code.className)?.[1];
    const pre = code.parentElement!;
    if (lang === "mermaid") {
      mermaidBlocks.push(pre);
      continue;
    }
    const wrapper = el("div", { class: "code-block" });
    wrapper.innerHTML = await highlight(code.textContent ?? "", lang ?? "text");
    if (lang) wrapper.dataset.lang = lang;
    pre.replaceWith(wrapper);
  }

  // After the code-block pass, which would otherwise re-wrap this one.
  if (front) {
    const box = el("div", { class: "code-block front-matter", "data-lang": "front matter" });
    box.innerHTML = await highlight(front, "yaml");
    next.prepend(box);
  }

  // Swap in one step so live reloads don't flash or lose scroll position.
  article.replaceChildren(...next.childNodes);
  await renderMermaid(mermaidBlocks);
}

const markdown: Renderer = async (host, ctx) => {
  const article = el("article", { class: "markdown-body" });
  host.append(article);
  await build(article, ctx);
  return {
    update: () => build(article, ctx),
    retheme: () => {
      if (article.querySelector("figure.mermaid")) void build(article, ctx);
    },
    dispose: () => article.remove(),
  };
};

export default withSource(markdown);
