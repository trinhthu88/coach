import { describe, expect, it } from "vitest";
import { isFrameHeader, mp3ChunkRanges } from "../../../supabase/functions/_shared/mp3Chunks";

// MPEG-1 Layer III, 64 kbps, 44.1 kHz: FF FB 50 xx.
const HEADER = [0xff, 0xfb, 0x50, 0xc4];

/** A fake MP3: `frames` frames of `frameLen` bytes, each starting with a valid header. */
function fakeMp3(frames: number, frameLen: number) {
  const bytes = new Uint8Array(frames * frameLen);
  for (let f = 0; f < frames; f++) bytes.set(HEADER, f * frameLen);
  return bytes;
}

describe("mp3ChunkRanges", () => {
  it("keeps a file under the limit whole", () => {
    expect(mp3ChunkRanges(fakeMp3(10, 100), 2000)).toEqual([[0, 1000]]);
  });

  it("cuts only at frame headers, every piece within the limit, covering the whole file", () => {
    const bytes = fakeMp3(100, 417);
    const ranges = mp3ChunkRanges(bytes, 10_000);
    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges[0][0]).toBe(0);
    expect(ranges[ranges.length - 1][1]).toBe(bytes.length);
    ranges.forEach(([s, e], i) => {
      expect(e - s).toBeLessThanOrEqual(10_000);
      expect(isFrameHeader(bytes, s) || s === 0).toBe(true);
      if (i > 0) expect(s).toBe(ranges[i - 1][1]);
    });
  });

  it("falls back to the byte limit when there is no frame header", () => {
    expect(mp3ChunkRanges(new Uint8Array(25), 10)).toEqual([[0, 10], [10, 20], [20, 25]]);
  });

  it("rejects reserved / invalid headers", () => {
    expect(isFrameHeader(new Uint8Array([0xff, 0xfb, 0xf0, 0x00]), 0)).toBe(false); // bitrate 1111
    expect(isFrameHeader(new Uint8Array([0xff, 0xfb, 0x5c, 0x00]), 0)).toBe(false); // sample rate 11
    expect(isFrameHeader(new Uint8Array([0xff, 0xe9, 0x50, 0x00]), 0)).toBe(false); // reserved layer
    expect(isFrameHeader(new Uint8Array(HEADER), 0)).toBe(true);
  });
});
