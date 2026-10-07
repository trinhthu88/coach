import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { transcribeMp3 } from "../_shared/whisperTranscribe.ts";

// Final Assessment, optional automatic transcription (Prompt A7). The learner
// has uploaded their MP3 under {enrollment}/{submission}/ but not submitted
// yet; this sends it to OpenAI Whisper (Vietnamese and English, language
// auto-detected) and returns a draft for the learner to correct.
//
// Every call goes through the database
// (20261007000300_final_assessment_auto_transcription):
//   - learner_claim_final_assessment_transcription, AS THE LEARNER (their
//     JWT): the attempt is open and takes a transcript, they ticked the
//     consent to the external service, and fewer than 3 automatic
//     transcriptions were used on this attempt. Logs the call.
//   - the recording is downloaded as the learner (storage RLS);
//   - final_assessment_transcription_finish_internal, as the service role:
//     the outcome, Whisper's audio minutes (the cost) and the draft, which
//     the page reloads after a refresh.
// The OPENAI_API_KEY Supabase secret never reaches the browser.
//
// Errors are { error: <code> } so the page shows its own EN / VI text:
// invalid_request, consent_required, not_open, limit_reached, not_found,
// not_configured, transcription_failed.

const CLAIM_ERRORS = ["invalid_request", "consent_required", "not_open", "limit_reached"] as const;
const CLAIM_STATUS: Record<(typeof CLAIM_ERRORS)[number], number> = {
  invalid_request: 400,
  consent_required: 400,
  not_open: 409,
  limit_reached: 429,
};

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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!/^Bearer\s+\S+/i.test(authHeader)) return json({ error: "invalid_request" }, 401);

    const { enrollment_id, storage_path, consent } = (await req.json().catch(() => ({}))) as {
      enrollment_id?: string;
      storage_path?: string;
      consent?: boolean;
    };
    if (!enrollment_id || !storage_path) return json({ error: "invalid_request" }, 400);

    const asLearner = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const { data: claimRows, error: claimErr } = await asLearner.rpc("learner_claim_final_assessment_transcription", {
      p_enrollment_id: enrollment_id,
      p_storage_path: storage_path,
      p_consent: consent === true,
    });
    if (claimErr) {
      const code = CLAIM_ERRORS.find((c) => claimErr.message === c);
      if (code) return json({ error: code }, CLAIM_STATUS[code]);
      throw claimErr;
    }
    const claim = (claimRows ?? [])[0] as { transcription_id: string; remaining: number } | undefined;
    if (!claim) throw new Error("claim returned no row");

    const finish = (succeeded: boolean, text?: string, seconds?: number) =>
      service.rpc("final_assessment_transcription_finish_internal", {
        p_transcription_id: claim.transcription_id,
        p_succeeded: succeeded,
        p_draft_text: text ?? null,
        p_audio_seconds: seconds ?? null,
      });

    const { data: file, error: dlErr } = await asLearner.storage.from("assessment-files").download(storage_path);
    if (dlErr || !file) {
      await finish(false);
      return json({ error: "not_found" }, 404);
    }

    try {
      const result = await transcribeMp3(new Uint8Array(await file.arrayBuffer()), { apiKey });
      const { error: finishErr } = await finish(true, result.text, result.seconds);
      if (finishErr) console.error("transcribe-assessment-recording: finish failed", finishErr);
      return json({ text: result.text, source: "auto", remaining: claim.remaining });
    } catch (e) {
      console.error("transcribe-assessment-recording: Whisper failed", { enrollment_id, error: String(e) });
      await finish(false);
      return json({ error: "transcription_failed" }, 502);
    }
  } catch (e) {
    console.error("transcribe-assessment-recording failed", e);
    return json({ error: "Internal error" }, 500);
  }
});
