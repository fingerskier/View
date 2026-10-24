import type { Session, TextFile } from "../api";
import type { FileType } from "../filetypes";

export interface Ctx {
  path: string;
  type: FileType;
  session: Session;
  /** Asset URL for the file, cache-busted per on-disk version. */
  url(): string;
  /** Changes every time the file changed on disk; use to cache-bust dependents. */
  version(): number;
  text(limit?: number): Promise<TextFile>;
  bytes(): Promise<ArrayBuffer>;
  /** Toolbar area this renderer owns; cleared when the view is disposed. */
  tools: HTMLElement;
  /** Open another file in the viewer (relative links). */
  open(path: string): void;
  /** Open a URL in the default browser. */
  external(url: string): void;
}

export interface View {
  /** The file changed on disk: re-render in place, keeping scroll/camera/page. */
  update(): Promise<void>;
  /** The Omarchy theme changed. CSS variables already follow; this is for canvases etc. */
  retheme?(): void;
  dispose(): void;
}

export type Renderer = (host: HTMLElement, ctx: Ctx) => Promise<View>;
