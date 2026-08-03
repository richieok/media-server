#!/usr/bin/env node
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { ENC_SUFFIX, IV_LENGTH, parseKeyHex, createCipher, createDecipher } from "../src/crypto.js";

function usage() {
  console.error(`Usage:
  node scripts/media-crypto.mjs encrypt <file-or-dir> [--delete-original]
  node scripts/media-crypto.mjs decrypt <file-or-dir> [--delete-original]

Recurses into directories. encrypt skips files already ending in ${ENC_SUFFIX};
decrypt only processes files ending in ${ENC_SUFFIX}.

Reads the 256-bit key (64 hex chars) from the ENCRYPTION_KEY env var.
Generate one with: openssl rand -hex 32`);
  process.exit(1);
}

function loadKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    console.error("ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32");
    process.exit(1);
  }
  try {
    return parseKeyHex(hex);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

async function collectFiles(target, predicate) {
  const stat = await fsp.stat(target);
  if (stat.isFile()) {
    return predicate(target) ? [target] : [];
  }

  const out = [];
  const entries = await fsp.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full, predicate)));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

// Writes to a ".partial" temp file and only renames it into place once the
// stream finishes cleanly, so a crash mid-run never leaves a half-written
// file at the final name.
async function pipeThroughCipher(srcPath, destPath, cipher, srcOptions) {
  const tmpPath = `${destPath}.partial`;
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(srcPath, srcOptions);
    const output = fs.createWriteStream(tmpPath);
    input.on("error", reject);
    cipher.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
    input.pipe(cipher).pipe(output);
  });
  await fsp.rename(tmpPath, destPath);
}

async function encryptFile(key, srcPath) {
  const destPath = srcPath + ENC_SUFFIX;
  const iv = crypto.randomBytes(IV_LENGTH);
  const tmpPath = `${destPath}.partial`;

  await fsp.writeFile(tmpPath, iv);
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(srcPath);
    const cipher = createCipher(key, iv);
    const output = fs.createWriteStream(tmpPath, { flags: "a" });
    input.on("error", reject);
    cipher.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
    input.pipe(cipher).pipe(output);
  });
  await fsp.rename(tmpPath, destPath);

  console.log(`encrypted: ${srcPath} -> ${destPath}`);
  return destPath;
}

async function decryptFile(key, srcPath) {
  const destPath = srcPath.slice(0, -ENC_SUFFIX.length);

  const fd = await fsp.open(srcPath, "r");
  const iv = Buffer.alloc(IV_LENGTH);
  await fd.read(iv, 0, IV_LENGTH, 0);
  await fd.close();

  const decipher = createDecipher(key, iv);
  await pipeThroughCipher(srcPath, destPath, decipher, { start: IV_LENGTH });

  console.log(`decrypted: ${srcPath} -> ${destPath}`);
  return destPath;
}

async function main() {
  const [, , mode, target, ...flags] = process.argv;
  if (!mode || !target || !["encrypt", "decrypt"].includes(mode)) usage();

  const deleteOriginal = flags.includes("--delete-original");
  const key = loadKey();

  const predicate =
    mode === "encrypt" ? (p) => !p.endsWith(ENC_SUFFIX) : (p) => p.endsWith(ENC_SUFFIX);

  const files = await collectFiles(target, predicate);
  if (files.length === 0) {
    console.log("No matching files found.");
    return;
  }

  const action = mode === "encrypt" ? encryptFile : decryptFile;
  for (const file of files) {
    const result = await action(key, file);
    if (deleteOriginal) {
      await fsp.unlink(file);
      console.log(`removed original: ${file}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
