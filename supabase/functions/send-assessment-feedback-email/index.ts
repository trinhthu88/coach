import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/send-email.ts";
import {
  AssessmentFeedbackReleasedEmail,
  assessmentFeedbackSubject,
} from "../_shared/email-templates/assessment-feedback-released.tsx";

// Invoked by the Admin queue right after admin_validate_review approves a
// review (the in-app notification is written by that function, in the same
// transaction as the release). Sends the learner one email, EN or VI by
// their preferred_language. assessment_claim_release_email_internal stamps
// the submission when it hands out the recipient, so a retry or a double
// click never sends twice, and a submission that is not released sends
// nothing.

const SITE_URL = "https://clariva.club";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const callerId = (() => {
      const sub = decodeJwtPayload(token)?.sub;
      return typeof sub === "string" ? sub : null;
    })();
    if (!callerId) return json({ error: "Invalid session" }, 401);

    const { submission_id } = (await req.json().catch(() => ({}))) as { submission_id?: string };
    if (!submission_id) return json({ error: "submission_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    if (!(roleRows ?? []).some((r: { role: string }) => r.role === "admin")) return json({ error: "Forbidden" }, 403);

    const { data: claimed, error: claimErr } = await admin.rpc("assessment_claim_release_email_internal", {
      p_submission_id: submission_id,
    });
    if (claimErr) throw claimErr;
    const recipient = (claimed ?? [])[0] as
      | { email: string | null; full_name: string | null; preferred_language: string | null; kind: string; requirement_ordinal: number | null; link: string }
      | undefined;
    // Not released, or already emailed: nothing to do.
    if (!recipient) return json({ sent: false, reason: "not_released_or_already_sent" });
    if (!recipient.email) return json({ sent: false, reason: "no_email" });

    const isVi = recipient.preferred_language === "vi";
    const props = {
      fullName: recipient.full_name || (isVi ? "bạn" : "there"),
      kind: recipient.kind,
      triadNumber: recipient.requirement_ordinal,
      ctaUrl: `${SITE_URL}${recipient.link}`,
      isVi,
    };
    const html = await renderAsync(React.createElement(AssessmentFeedbackReleasedEmail, props));
    const text = await renderAsync(React.createElement(AssessmentFeedbackReleasedEmail, props), { plainText: true });
    const result = await sendEmail({
      to: recipient.email,
      subject: assessmentFeedbackSubject({ kind: recipient.kind, triadNumber: recipient.requirement_ordinal, isVi }),
      html,
      text,
    });
    if (!result.ok) {
      console.error("Failed to send assessment feedback email", { error: result.error, submission_id });
      return json({ sent: false, reason: "send_failed" }, 502);
    }
    return json({ sent: true });
  } catch (e) {
    console.error("send-assessment-feedback-email failed", e);
    return json({ error: "Internal error" }, 500);
  }
});
