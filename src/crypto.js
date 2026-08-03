import crypto from "crypto";

export const ENC_SUFFIX = ".enc";
export const ALGORITHM = "aes-256-ctr";
export const KEY_LENGTH = 32; // bytes, AES-256
export const IV_LENGTH = 16; // bytes, one AES block

/** Parses and validates a hex-encoded 256-bit key. Throws on any problem. */
export function parseKeyHex(hex) {
  const key = Buffer.from((hex || "").trim(), "hex");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `Encryption key must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes); got ${key.length} bytes`
    );
  }
  return key;
}

/**
 * Advances a 16-byte AES-CTR counter/IV by `blocks` whole AES blocks.
 * Matches OpenSSL's CTR mode, which treats the full 16-byte IV as a single
 * big-endian 128-bit counter and increments it once per block.
 */
export function advanceIV(iv, blocks) {
  const high = iv.readBigUInt64BE(0);
  const low = iv.readBigUInt64BE(8);
  let counter = (high << 64n) | low;
  counter = (counter + BigInt(blocks)) & ((1n << 128n) - 1n);

  const out = Buffer.alloc(16);
  out.writeBigUInt64BE((counter >> 64n) & 0xffffffffffffffffn, 0);
  out.writeBigUInt64BE(counter & 0xffffffffffffffffn, 8);
  return out;
}

/**
 * Everything needed to stream-decrypt plaintext byte range [start, end]
 * (inclusive) from a file stored as [16-byte IV][ciphertext].
 *
 * AES-CTR can start decrypting at any block boundary without processing
 * prior blocks, so seeking means jumping the ciphertext read to the block
 * containing `start` and trimming the few leading bytes that overshoot it,
 * rather than decrypting from byte zero every time.
 */
export function planRangeDecrypt(fileIv, start, end) {
  const blockIndex = Math.floor(start / IV_LENGTH);
  const blockOffset = blockIndex * IV_LENGTH;

  return {
    iv: advanceIV(fileIv, blockIndex),
    ciphertextStart: IV_LENGTH + blockOffset,
    ciphertextEnd: IV_LENGTH + end, // inclusive
    leadingTrim: start - blockOffset,
  };
}

export function createDecipher(key, iv) {
  return crypto.createDecipheriv(ALGORITHM, key, iv);
}

export function createCipher(key, iv) {
  return crypto.createCipheriv(ALGORITHM, key, iv);
}
