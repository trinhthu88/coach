import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { mp3ChunkRanges } from "../_shared/mp3Chunks.ts";

// Final Assessment, optional automatic transcription (Prompt A7). The learner
// has uploaded their MP3 under {enrollment}/{submission}/ but not submitted
// yet; this sends it to OpenAI Whisper (Vietnamese and English, language
// auto-detected) and returns a draft. The page puts the draft in the
// transcript box for the learner to correct, and learner_submit_assessment
// stores it in transcript_text with transcript_source = 'auto'.
//
// Everything is read AS THE LEARNER (their JWT, so RLS and the learner
// wrappers apply): learner_final_assessment must show an open attempt that
// takes a transcript, and the recording must be readable by them under that
// enrollment. The API key is the OPENAI_API_KEY Supabase secret, never sent
// to the browser.
//
// Errors are { error: <code> } so the page can show its own EN / VI text:
// invalid_request, not_open, not_found, not_configured, transcription_failed.

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-1";
// The API's limit is 25 MB; stay under it.
const MAX_CHUNK_BYTES = 24 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function transcribeChunk(apiKey: string, chunk: Uint8Array, index: number): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([chunk], { type: "audio/mpeg" }), `recording-${index + 1}.mp3`);
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "text");
  const res = await fetch(WHISPER_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  if (!res.ok) {
    throw new Error(`Whisper ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  return (await res.text()).trim();
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "not_configured" }, 503);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!/^Bearer\s+\S+/i.test(authHeader)) return json({ error: "invalid_request" }, 401);

    const { enrollment_id, storage_path } = (await req.json().catch(() => ({}))) as {
      enrollment_id?: string;
      storage_path?: string;
    };
    if (!enrollment_id || !UUID.test(enrollment_id) || !storage_path) return json({ error: "invalid_request" }, 400);
    const parts = storage_path.split("/");
    if (parts.length !== 3 || parts[0] !== enrollment_id || !UUID.test(parts[1]) || !parts[2].toLowerCase().endsWith(".mp3")) {
      return json({ error: "invalid_request" }, 400);
    }

    const asLearner = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // Only the learner's own, still open attempt, and only when it takes a transcript.
    const { data: rows, error: faErr } = await asLearner.rpc("learner_final_assessment", { p_enrollment_id: enrollment_id });
    if (faErr) throw faErr;
    const fa = (rows ?? [])[0] as { state: string; transcript_mode: string } | undefined;
    if (!fa || !["not_submitted", "resubmit_requested"].includes(fa.state) || fa.transcript_mode === "none") {
      return json({ error: "not_open" }, 409);
    }

    const { data: file, error: dlErr } = await asLearner.storage.from("assessment-files").download(storage_path);
    if (dlErr || !file) return json({ error: "not_found" }, 404);
    const bytes = new Uint8Array(await file.arrayBuffer());

    let text: string;
    try {
      const pieces = mp3ChunkRanges(bytes, MAX_CHUNK_BYTES);
      const texts = await Promise.all(pieces.map(([s, e], i) => transcribeChunk(apiKey, bytes.subarray(s, e), i)));
      text = texts.filter(Boolean).join("\n\n");
    } catch (e) {
      console.error("transcribe-assessment-recording: Whisper failed", { enrollment_id, error: String(e) });
      return json({ error: "transcription_failed" }, 502);
    }
    return json({ text, source: "auto" });
  } catch (e) {
    console.error("transcribe-assessment-recording failed", e);
    return json({ error: "Internal error" }, 500);
  }
});
