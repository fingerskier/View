import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number;
}

export interface TextFile {
  text: string;
  size: number;
  modified: number;
  truncated: boolean;
  binary: boolean;
}

export interface Session {
  root: string;
  rootLabel: string;
  initial: string | null;
  version: string;
  hasOffice: boolean;
  hasMedia: boolean;
}

export interface Theme {
  name: string | null;
  mode: string;
  colors: Record<string, string>;
  font: string | null;
}

export const api = {
  session: () => invoke<Session>("session"),
  listDir: (path: string, showAll: boolean) => invoke<Entry[]>("list_dir", { path, showAll }),
  stat: (path: string) => invoke<Entry>("stat", { path }),
  readText: (path: string, limit?: number) => invoke<TextFile>("read_text", { path, limit }),
  readHead: (path: string, len: number) => invoke<ArrayBuffer>("read_head", { path, len }),
  watchDirs: (dirs: string[]) => invoke<void>("watch_dirs", { dirs }),
  theme: () => invoke<Theme>("get_theme"),
  officePdf: (path: string) => invoke<string>("office_pdf", { path }),
};

export function onFsChanged(cb: (paths: string[]) => void): Promise<UnlistenFn> {
  return listen<string[]>("fs-changed", (e) => cb(e.payload));
}

export function onThemeChanged(cb: (theme: Theme) => void): Promise<UnlistenFn> {
  return listen<Theme>("theme-changed", (e) => cb(e.payload));
}
