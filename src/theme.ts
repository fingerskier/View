import type { Theme } from "./api";

/** Omarchy colors.toml keys → CSS custom properties used throughout styles.css. */
const mapping: [string, string, string][] = [
  ["--bg", "background", "#1e1e2e"],
  ["--bg-dark", "dark_background", "#181825"],
  ["--bg-darker", "darker_background", "#11111b"],
  ["--bg-light", "lighter_background", "#313244"],
  ["--fg", "foreground", "#cdd6f4"],
  ["--fg-dim", "dark_foreground", "#6c7086"],
  ["--fg-light", "light_foreground", "#bac2de"],
  ["--accent", "accent", "#89b4fa"],
  ["--selection", "selection", "#45475a"],
  ["--muted", "muted", "#585b70"],
  ["--red", "red", "#f38ba8"],
  ["--green", "green", "#a6e3a1"],
  ["--yellow", "yellow", "#f9e2af"],
  ["--orange", "orange", "#fab387"],
  ["--blue", "blue", "#89b4fa"],
  ["--magenta", "magenta", "#f5c2e7"],
  ["--cyan", "cyan", "#94e2d5"],
];

export function applyTheme(theme: Theme | null) {
  const root = document.documentElement;
  for (const [prop, key, fallback] of mapping) {
    root.style.setProperty(prop, theme?.colors[key] ?? fallback);
  }
  const mode = theme?.mode === "light" ? "light" : "dark";
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
  if (theme?.font) {
    root.style.setProperty("--font-mono", `"${theme.font.replace(/"/g, "")}", monospace`);
  }
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function themeMode(): "light" | "dark" {
  return document.documentElement.dataset.mode === "light" ? "light" : "dark";
}
