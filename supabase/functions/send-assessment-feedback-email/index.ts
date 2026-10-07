import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/send-email.ts";
import {
  AssessmentFeedbackReleasedEmail,
  assessmentFeedbackSubject,
} from "../_shared/email-templates/assessment-feedback-released.tsx";

// Scheduled (an external cron, like send-programme-reminders): a POST with the
// CRON_SECRET shared secret, verify_jwt = false. Each run takes the released
// submissions whose email has not gone, leased for 15 minutes so two runs never
// send the same one (assessment_release_emails_due_internal), sends each
// learner one email, EN or VI by their preferred_language, and stamps
// release_emailed_at only after Resend accepted it
// (assessment_mark_release_emailed_internal). A failed send stays due and is
// retried by a later run; the Admin queue shows "email not sent" until then.

const SITE_URL = "https://clariva.club";

interface DueEmail {
  submission_id: string;
  email: string | null;
  full_name: string | null;
  preferred_language: string | null;
  kind: string;
  requirement_ordinal: number | null;
  link: string;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "Forbidden" }, 403);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: due, error: dueErr } = await admin.rpc("assessment_release_emails_due_internal", { p_limit: 50 });
    if (dueErr) throw dueErr;

    let sent = 0;
    let failed = 0;
    let noEmail = 0;
    for (const recipient of (due ?? []) as DueEmail[]) {
      if (!recipient.email) {
        noEmail++;
        continue;
      }
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
        // Not stamped: the next run after the lease retries it.
        failed++;
        console.error("Failed to send assessment feedback email", { error: result.error, submission_id: recipient.submission_id });
        continue;
      }
      const { error: markErr } = await admin.rpc("assessment_mark_release_emailed_internal", {
        p_submission_id: recipient.submission_id,
      });
      if (markErr) console.error("Sent but not stamped", { error: markErr, submission_id: recipient.submission_id });
      sent++;
    }
    return json({ ok: true, sent, failed, noEmail });
  } catch (e) {
    console.error("send-assessment-feedback-email failed", e);
    return json({ error: "Internal error" }, 500);
  }
});
