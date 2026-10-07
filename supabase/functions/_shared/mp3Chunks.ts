// Splits an MP3 into pieces no larger than maxBytes, cutting only at an MPEG
// audio frame header so every piece decodes on its own. Used by
// transcribe-assessment-recording: the speech-to-text API takes at most 25 MB
// per request, the Final Assessment allows up to 50 MB. Pure, no Deno APIs,
// so it is unit-tested from src/lib/__tests__/mp3Chunks.test.ts.

/** True when bytes[i..i+3] is a plausible MPEG audio frame header. */
export function isFrameHeader(bytes: Uint8Array, i: number): boolean {
  if (i + 3 >= bytes.length) return false;
  const b1 = bytes[i + 1];
  const b2 = bytes[i + 2];
  if (bytes[i] !== 0xff || (b1 & 0xe0) !== 0xe0) return false;
  if (((b1 >> 3) & 0x03) === 0x01) return false; // reserved MPEG version
  if (((b1 >> 1) & 0x03) === 0x00) return false; // reserved layer
  const bitrate = b2 >> 4;
  if (bitrate === 0x0f || bitrate === 0x00) return false; // bad / free-format bitrate
  if (((b2 >> 2) & 0x03) === 0x03) return false; // reserved sample rate
  return true;
}

/**
 * Byte ranges [start, end) covering the whole file, each at most maxBytes.
 * Each cut is the last frame header at or before start + maxBytes; with no
 * header in that window (not really MP3) it cuts at the byte limit.
 */
export function mp3ChunkRanges(bytes: Uint8Array, maxBytes: number): Array<[number, number]> {
  if (maxBytes < 4) throw new Error("maxBytes too small");
  const ranges: Array<[number, number]> = [];
  let start = 0;
  while (bytes.length - start > maxBytes) {
    const limit = start + maxBytes;
    let cut = -1;
    for (let i = limit; i > start; i--) {
      if (isFrameHeader(bytes, i)) {
        cut = i;
        break;
      }
    }
    if (cut <= start) cut = limit;
    ranges.push([start, cut]);
    start = cut;
  }
  if (start < bytes.length) ranges.push([start, bytes.length]);
  return ranges;
}
