const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatSize(bytes) {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return "";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0);
  return `${rounded} ${UNITS[unit]}`;
}

/** Buckets a mime type into how the UI should present it. */
export function kindOf(item) {
  if (item.type === "directory") return "directory";
  const mime = item.mimeType || "";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "file";
}

export const ICONS = {
  directory: "📁",
  video: "🎬",
  audio: "🎵",
  image: "🖼️",
  file: "📄",
};

/** Splits "a/b/c" into cumulative breadcrumb segments. */
export function breadcrumbs(dir) {
  if (!dir) return [];
  const parts = dir.split("/").filter(Boolean);
  return parts.map((name, i) => ({
    name,
    path: parts.slice(0, i + 1).join("/"),
  }));
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Scrub-preview sprite sheet path for a video item, following the
 * "<name>.mp4" -> "<name>-spritesh.jpg" convention (generated externally,
 * not by this app). Not every video has one; callers must handle a 404.
 */
export function spriteSheetPath(item) {
  return item.path.replace(/\.[^./]+$/, "") + "-spritesh.jpg";
}
