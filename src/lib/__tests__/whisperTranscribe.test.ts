import { describe, expect, it, vi } from "vitest";
import {
  WHISPER_MAX_CHUNK_BYTES,
  WHISPER_MODEL,
  WHISPER_URL,
  transcribeMp3,
} from "../../../supabase/functions/_shared/whisperTranscribe";
import { isFrameHeader } from "../../../supabase/functions/_shared/mp3Chunks";

// MPEG-1 Layer III, 64 kbps, 44.1 kHz frame header; 64 kbps frames are 208/209 bytes.
const HEADER = [0xff, 0xfb, 0x50, 0xc4];
const FRAME = 209;
const MB = 1024 * 1024;

// jsdom's Blob has no arrayBuffer(); FileReader reads it.
function readBlob(blob: Blob) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function fakeMp3(bytes: number) {
  const out = new Uint8Array(bytes);
  for (let at = 0; at + HEADER.length <= bytes; at += FRAME) out.set(HEADER, at);
  return out;
}

/** A mocked Whisper: answers verbose_json and records what each request sent. */
function mockWhisper(answers: Array<{ text: string; duration: number }>) {
  const sent: { url: string; auth: string | null; model: unknown; format: unknown; file: Uint8Array }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const form = init!.body as FormData;
    const file = form.get("file") as Blob;
    sent.push({
      url: String(url),
      auth: new Headers(init!.headers).get("Authorization"),
      model: form.get("model"),
      format: form.get("response_format"),
      file: await readBlob(file),
    });
    const answer = answers[sent.length - 1];
    return new Response(JSON.stringify({ text: answer.text, duration: answer.duration, language: "vietnamese" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, sent };
}

describe("transcribeMp3 (mocked Whisper)", () => {
  it("sends a file under the limit in one request", async () => {
    const { fetchFn, sent } = mockWhisper([{ text: "Xin chào.", duration: 61.5 }]);
    const result = await transcribeMp3(fakeMp3(2 * MB), { apiKey: "sk-test", fetchFn });
    expect(result).toEqual({ text: "Xin chào.", seconds: 61.5, chunks: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: WHISPER_URL, auth: "Bearer sk-test", model: WHISPER_MODEL, format: "verbose_json" });
  });

  it("splits a file over 25 MB at frame headers, each part within the limit, and joins text and minutes", async () => {
    const bytes = fakeMp3(30 * MB); // a 60-minute session at 64 kbps
    const { fetchFn, sent } = mockWhisper([
      { text: "Coach: Hôm nay bạn muốn đạt được gì?", duration: 1572.9 },
      { text: "Coachee: Tôi muốn rõ ràng hơn.", duration: 393.2 },
    ]);
    const result = await transcribeMp3(bytes, { apiKey: "sk-test", fetchFn });

    expect(sent).toHaveLength(2);
    expect(result.chunks).toBe(2);
    for (const part of sent) {
      expect(part.file.length).toBeLessThanOrEqual(WHISPER_MAX_CHUNK_BYTES);
      expect(part.file.length).toBeLessThan(25 * MB);
      expect(isFrameHeader(part.file, 0)).toBe(true);
    }
    // Nothing lost or duplicated: the parts are the file, in order.
    expect(sent[0].file.length + sent[1].file.length).toBe(bytes.length);
    expect(Buffer.from(sent[1].file).equals(Buffer.from(bytes.subarray(sent[0].file.length)))).toBe(true);
    expect(result.text).toBe("Coach: Hôm nay bạn muốn đạt được gì?\n\nCoachee: Tôi muốn rõ ràng hơn.");
    expect(result.seconds).toBeCloseTo(1966.1);
  });

  it("fails the whole draft when any part fails", async () => {
    const fetchFn = vi.fn(async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    await expect(transcribeMp3(fakeMp3(1 * MB), { apiKey: "sk-test", fetchFn })).rejects.toThrow(/Whisper 429/);
  });
});
