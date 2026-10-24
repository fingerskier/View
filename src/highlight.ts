import { bundledLanguages, bundledLanguagesAlias, createCssVariablesTheme, createHighlighter, type BundledLanguage } from "shiki";
import { escapeHtml } from "./util";

// Token colors come from CSS variables mapped onto the Omarchy palette in
// styles.css, so a theme switch recolors code without re-highlighting.
const theme = createCssVariablesTheme({
  name: "omarchy",
  variablePrefix: "--shiki-",
  variableDefaults: {},
  fontStyle: true,
});

/** Above this, highlighting gets slow enough to notice; show plain text. */
export const HIGHLIGHT_LIMIT = 512 * 1024;

let highlighter: ReturnType<typeof createHighlighter> | null = null;

function getHighlighter() {
  highlighter ??= createHighlighter({ themes: [theme], langs: [] });
  return highlighter;
}

export function resolveLang(hint: string | undefined): string {
  const lang = (hint ?? "").toLowerCase();
  if (lang in bundledLanguages) return lang;
  const alias = (bundledLanguagesAlias as Record<string, unknown>)[lang];
  return alias ? lang : "text";
}

export async function highlight(code: string, hint: string | undefined): Promise<string> {
  const lang = resolveLang(hint);
  if (code.length > HIGHLIGHT_LIMIT) return plain(code);
  const hl = await getHighlighter();
  if (lang !== "text" && !hl.getLoadedLanguages().includes(lang)) {
    try {
      await hl.loadLanguage(lang as BundledLanguage);
    } catch {
      return hl.codeToHtml(code, { lang: "text", theme: "omarchy" });
    }
  }
  return hl.codeToHtml(code, { lang: lang as BundledLanguage, theme: "omarchy" });
}

/** Same markup shape as Shiki's, without tokens. */
export function plain(code: string): string {
  const lines = code.split("\n").map((l) => `<span class="line">${escapeHtml(l)}</span>`);
  return `<pre class="shiki plain"><code>${lines.join("\n")}</code></pre>`;
}
