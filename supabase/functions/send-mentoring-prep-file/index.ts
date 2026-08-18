import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/send-email.ts";
import { MentoringPrepSubmittedEmail } from "../_shared/email-templates/mentoring-prep-submitted.tsx";

// Invoked from useMentoringPrepFile.ts right after the mentee's upload
// succeeds. sendEmail (_shared/send-email.ts) has no attachment support
// today, so this links to a 7-day signed URL instead of attaching the file —
// simpler than wiring up Resend attachments for a v1, and avoids emailing
// a private document as a raw attachment.

function formatWhen(startTimeISO: string, durationMinutes: number): string {
  const start = new Date(startTimeISO);
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  });
  return `${dateFmt.format(start)} · ${durationMinutes} min`;
}

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

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const claims = decodeJwtPayload(token);
    const callerId = typeof claims?.sub === "string" ? claims.sub : null;
    if (!callerId) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { session_id } = body as { session_id?: string };
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: row, error: rowErr } = await admin
      .from("mentoring_sessions")
      .select("*")
      .eq("id", session_id)
      .maybeSingle();
    if (rowErr || !row) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!row.prep_file_path) {
      return new Response(JSON.stringify({ error: "No preparation file on this session" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
    const isParticipant = row.mentor_id === callerId || row.mentee_id === callerId;
    if (!isAdmin && !isParticipant) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: signed, error: signErr } = await admin.storage
      .from("mentoring-prep-files")
      .createSignedUrl(row.prep_file_path, 60 * 60 * 24 * 7);
    if (signErr || !signed) {
      throw signErr ?? new Error("Failed to create signed URL");
    }

    const { data: participants } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [row.mentor_id, row.mentee_id]);
    const byId = new Map((participants ?? []).map((p) => [p.id, p]));
    const mentorProfile = byId.get(row.mentor_id);
    const menteeProfile = byId.get(row.mentee_id);
    const whenFormatted = formatWhen(row.start_time, row.duration_minutes || 45);

    for (const [recipient, counterpart] of [
      [mentorProfile, menteeProfile],
      [menteeProfile, mentorProfile],
    ] as const) {
      if (!recipient?.email) continue;
      const props = {
        recipientName: recipient.full_name || "there",
        counterpartName: counterpart?.full_name || "your mentoring partner",
        topic: row.topic,
        whenFormatted,
        fileUrl: signed.signedUrl,
        notes: row.prep_file_notes,
      };
      const html = await renderAsync(React.createElement(MentoringPrepSubmittedEmail, props));
      const text = await renderAsync(React.createElement(MentoringPrepSubmittedEmail, props), { plainText: true });
      const result = await sendEmail({
        to: recipient.email,
        subject: "Preparation file submitted for your mentoring session",
        html,
        text,
      });
      if (!result.ok) {
        console.error("Failed to send mentoring-prep-submitted email", { error: result.error, email: recipient.email });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
