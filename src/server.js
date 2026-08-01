import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import express from "express";
import mime from "mime-types";

const fsp = fs.promises;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const MEDIA_ROOT = path.resolve(process.env.MEDIA_DIR || path.join(__dirname, "..", "media"));

const app = express();
app.disable("x-powered-by");

/**
 * Resolves a user-supplied relative path against MEDIA_ROOT and guarantees
 * the result cannot escape MEDIA_ROOT (blocks "../" traversal).
 */
function resolveSafePath(relativePath = "") {
  const normalized = path.normalize(path.join(MEDIA_ROOT, relativePath));
  if (normalized !== MEDIA_ROOT && !normalized.startsWith(MEDIA_ROOT + path.sep)) {
    return null;
  }
  return normalized;
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// List files/directories under MEDIA_ROOT. ?dir=sub/folder for a subdirectory.
app.get("/api/files", async (req, res) => {
  const relDir = typeof req.query.dir === "string" ? req.query.dir : "";
  const targetPath = resolveSafePath(relDir);

  if (!targetPath) {
    return res.status(400).json({ error: "Invalid path" });
  }

  try {
    const stat = await fsp.stat(targetPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "Not a directory" });
    }

    const entries = await fsp.readdir(targetPath, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .map(async (entry) => {
          const entryRelPath = path.join(relDir, entry.name);
          const isDirectory = entry.isDirectory();
          const result = {
            name: entry.name,
            path: entryRelPath.split(path.sep).join("/"),
            type: isDirectory ? "directory" : "file",
          };
          if (!isDirectory) {
            const entryStat = await fsp.stat(path.join(targetPath, entry.name));
            result.size = entryStat.size;
            result.mimeType = mime.lookup(entry.name) || "application/octet-stream";
            result.url = `/media/${result.path}`;
          }
          return result;
        })
    );

    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ dir: relDir, items });
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(404).json({ error: "Directory not found" });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Stream a media file, with HTTP Range support for seeking in audio/video.
app.get("/media/*", async (req, res) => {
  const relPath = req.params[0];
  const filePath = resolveSafePath(relPath);

  if (!filePath) {
    return res.status(400).json({ error: "Invalid path" });
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      return res.status(404).json({ error: "File not found" });
    }

    const mimeType = mime.lookup(filePath) || "application/octet-stream";
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
        res.set("Content-Range", `bytes */${stat.size}`);
        return res.status(416).end();
      }

      res.status(206);
      res.set({
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": mimeType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.set({
        "Content-Length": stat.size,
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(404).json({ error: "File not found" });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`m-server listening on port ${PORT}`);
  console.log(`Serving media from ${MEDIA_ROOT}`);
});
