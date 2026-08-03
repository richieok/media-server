import path from "path";
import fs from "fs";
import { Transform } from "stream";
import { fileURLToPath } from "url";
import express from "express";
import mime from "mime-types";
import { ENC_SUFFIX, IV_LENGTH, parseKeyHex, planRangeDecrypt, createDecipher } from "./crypto.js";

const fsp = fs.promises;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const MEDIA_ROOT = path.resolve(process.env.MEDIA_DIR || path.join(__dirname, "..", "media"));

// Scrub-preview sprite sheets ("<name>-spritesh.jpg", generated externally)
// are an implementation detail of the video player, not browsable content —
// hidden from listings the same way dotfiles are. Must match web/src/lib/
// format.js's spriteSheetPath, which derives this filename from a video path.
const SPRITE_SHEET_RE = /-spritesh\.jpg$/i;

// Optional: enables transparent decryption of "<name>.enc" files. Files
// stored under this suffix are AES-256-CTR encrypted at rest and only ever
// decrypted in memory, while streaming, for the duration of a request.
let ENCRYPTION_KEY = null;
if (process.env.ENCRYPTION_KEY) {
  try {
    ENCRYPTION_KEY = parseKeyHex(process.env.ENCRYPTION_KEY);
  } catch (err) {
    console.error(`Invalid ENCRYPTION_KEY: ${err.message}`);
    process.exit(1);
  }
}

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
        .filter((entry) => !entry.name.startsWith(".") && !SPRITE_SHEET_RE.test(entry.name))
        .map(async (entry) => {
          if (entry.isDirectory()) {
            const entryRelPath = path.join(relDir, entry.name);
            return {
              name: entry.name,
              path: entryRelPath.split(path.sep).join("/"),
              type: "directory",
            };
          }

          // An "<name>.enc" file is presented under its original name; the
          // library can otherwise contain a mix of plain and encrypted
          // files side by side. If a plain file and its own "<name>.enc"
          // both exist in the same folder, both are listed under the same
          // display name — an unusual layout this doesn't try to resolve.
          const isEncrypted = Boolean(ENCRYPTION_KEY) && entry.name.endsWith(ENC_SUFFIX);
          const displayName = isEncrypted ? entry.name.slice(0, -ENC_SUFFIX.length) : entry.name;
          const entryRelPath = path.join(relDir, displayName);
          const relPath = entryRelPath.split(path.sep).join("/");

          const diskStat = await fsp.stat(path.join(targetPath, entry.name));

          return {
            name: displayName,
            path: relPath,
            type: "file",
            size: isEncrypted ? diskStat.size - IV_LENGTH : diskStat.size,
            mimeType: mime.lookup(displayName) || "application/octet-stream",
            url: `/media/${relPath}`,
            encrypted: isEncrypted,
          };
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

function parseRange(rangeHeader, size) {
  const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
  const start = parseInt(startStr, 10);
  const end = endStr ? parseInt(endStr, 10) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
    return null;
  }
  return { start, end };
}

async function streamPlain(req, res, filePath, stat) {
  const mimeType = mime.lookup(filePath) || "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const parsed = parseRange(range, stat.size);
    if (!parsed) {
      res.set("Content-Range", `bytes */${stat.size}`);
      return res.status(416).end();
    }
    const { start, end } = parsed;
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
}

async function readIV(filePath) {
  const fd = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.alloc(IV_LENGTH);
    await fd.read(buf, 0, IV_LENGTH, 0);
    return buf;
  } finally {
    await fd.close();
  }
}

// Decrypts on the fly while streaming: only the bytes being sent right now
// are ever in plaintext, and only in memory. A Range request decrypts just
// the requested slice, using planRangeDecrypt to start at the containing
// AES block rather than decrypting the file from byte zero every time.
async function streamEncrypted(req, res, encPath, encStat, relPath) {
  const plainSize = encStat.size - IV_LENGTH;
  const mimeType = mime.lookup(relPath) || "application/octet-stream";
  const range = req.headers.range;

  let start = 0;
  let end = plainSize - 1;

  if (range) {
    const parsed = parseRange(range, plainSize);
    if (!parsed) {
      res.set("Content-Range", `bytes */${plainSize}`);
      return res.status(416).end();
    }
    ({ start, end } = parsed);
  }

  const fileIv = await readIV(encPath);
  const plan = planRangeDecrypt(fileIv, start, end);
  const decipher = createDecipher(ENCRYPTION_KEY, plan.iv);

  if (range) {
    res.status(206);
    res.set({
      "Content-Range": `bytes ${start}-${end}/${plainSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": mimeType,
    });
  } else {
    res.set({
      "Content-Length": plainSize,
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
    });
  }

  let bytesToTrim = plan.leadingTrim;
  const trimLeading = new Transform({
    transform(chunk, _enc, callback) {
      if (bytesToTrim > 0) {
        if (chunk.length <= bytesToTrim) {
          bytesToTrim -= chunk.length;
          return callback();
        }
        chunk = chunk.subarray(bytesToTrim);
        bytesToTrim = 0;
      }
      callback(null, chunk);
    },
  });

  const cipherStream = fs.createReadStream(encPath, {
    start: plan.ciphertextStart,
    end: plan.ciphertextEnd,
  });
  cipherStream.on("error", (err) => res.destroy(err));

  cipherStream.pipe(decipher).pipe(trimLeading).pipe(res);
}

// Stream a media file, with HTTP Range support for seeking in audio/video.
// If ENCRYPTION_KEY is set, "<path>.enc" is preferred and decrypted
// transparently; otherwise the plain file at <path> is served as-is.
app.get("/media/*", async (req, res) => {
  const relPath = req.params[0];
  const plainPath = resolveSafePath(relPath);

  if (!plainPath) {
    return res.status(400).json({ error: "Invalid path" });
  }

  try {
    if (ENCRYPTION_KEY) {
      const encPath = resolveSafePath(relPath + ENC_SUFFIX);
      const encStat = encPath ? await fsp.stat(encPath).catch(() => null) : null;
      if (encStat && encStat.isFile()) {
        return await streamEncrypted(req, res, encPath, encStat, relPath);
      }
    }

    const stat = await fsp.stat(plainPath);
    if (!stat.isFile()) {
      return res.status(404).json({ error: "File not found" });
    }
    await streamPlain(req, res, plainPath, stat);
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(404).json({ error: "File not found" });
    }
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`m-server listening on port ${PORT}`);
  console.log(`Serving media from ${MEDIA_ROOT}`);
  console.log(`Media encryption: ${ENCRYPTION_KEY ? "enabled" : "disabled"}`);
});
