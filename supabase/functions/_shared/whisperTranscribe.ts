// Transcribes an MP3 with OpenAI Whisper, splitting it first when it is over
// the API's per-request limit. Pure apart from the injected fetch, so it is
// unit-tested from src/lib/__tests__/whisperTranscribe.test.ts with a mocked
// Whisper; used by transcribe-assessment-recording.
import { mp3ChunkRanges } from "./mp3Chunks.ts";

export const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
export const WHISPER_MODEL = "whisper-1";
// The API's limit is 25 MB; stay under it.
export const WHISPER_MAX_CHUNK_BYTES = 24 * 1024 * 1024;

export interface WhisperResult {
  text: string;
  /** Total audio length Whisper reports (the cost basis). */
  seconds: number;
  chunks: number;
}

export async function transcribeMp3(
  bytes: Uint8Array,
  opts: { apiKey: string; fetchFn?: typeof fetch; maxChunkBytes?: number },
): Promise<WhisperResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const ranges = mp3ChunkRanges(bytes, opts.maxChunkBytes ?? WHISPER_MAX_CHUNK_BYTES);
  const parts = await Promise.all(
    ranges.map(async ([start, end], i) => {
      const form = new FormData();
      // A copy with its own ArrayBuffer (a subarray view is not a BlobPart).
      form.append("file", new Blob([bytes.slice(start, end)], { type: "audio/mpeg" }), `recording-${i + 1}.mp3`);
      form.append("model", WHISPER_MODEL);
      form.append("response_format", "verbose_json");
      const res = await fetchFn(WHISPER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        throw new Error(`Whisper ${res.status} on part ${i + 1}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
      }
      const body = (await res.json()) as { text?: string; duration?: number };
      return { text: (body.text ?? "").trim(), seconds: Number(body.duration) || 0 };
    }),
  );
  return {
    text: parts.map((p) => p.text).filter(Boolean).join("\n\n"),
    seconds: parts.reduce((sum, p) => sum + p.seconds, 0),
    chunks: ranges.length,
  };
}
