import { el, messageBox } from "../util";
import type { Renderer } from "./types";

const media: Renderer = async (host, ctx) => {
  if (!ctx.session.hasMedia) {
    // WebKitGTK's web process crashes on <audio>/<video> without these sinks.
    host.append(
      messageBox(
        "info",
        "Audio and video playback needs GStreamer's plugins",
        "Install them with: sudo pacman -S gst-plugins-good gst-libav",
      ),
    );
    return { update: async () => {}, dispose: () => host.replaceChildren() };
  }
  const isVideo = ctx.type.kind === "video";
  const player = el(isVideo ? "video" : "audio", { controls: "", preload: "metadata" }) as HTMLMediaElement;
  const frame = el("div", { class: `media-view ${ctx.type.kind}` }, player);
  host.append(frame);

  player.addEventListener("error", () => {
    if (frame.querySelector(".message")) return;
    frame.append(
      messageBox(
        "error",
        "This file could not be played.",
        "WebKitGTK plays media through GStreamer. Most formats need gst-plugins-good, and H.264/AAC also need gst-libav.",
      ),
    );
  });

  const load = () => {
    // Keep the playhead across live reloads.
    const time = player.currentTime;
    const paused = player.paused;
    frame.querySelector(".message")?.remove();
    player.src = ctx.url();
    if (time > 0) {
      player.addEventListener("loadedmetadata", () => {
        player.currentTime = Math.min(time, player.duration || time);
        if (!paused) void player.play().catch(() => {});
      }, { once: true });
    }
  };
  load();
  return {
    update: async () => load(),
    dispose: () => {
      player.pause();
      player.removeAttribute("src");
      player.load();
      frame.remove();
    },
  };
};

export default media;
