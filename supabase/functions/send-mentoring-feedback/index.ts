import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/send-email.ts";
import { MentoringFeedbackSubmittedEmail } from "../_shared/email-templates/mentoring-feedback-submitted.tsx";

// Invoked from useMentoringFeedback.ts right after the mentor submits
// feedback. Sent to both mentor and mentee, per spec — the mentor gets a
// copy of what they submitted, the mentee gets the feedback itself.

const COMPETENCY_LABELS: Record<string, string> = {
  ethical_practice: "Demonstrates Ethical Practice",
  coaching_mindset: "Embodies a Coaching Mindset",
  maintains_agreements: "Establishes & Maintains Agreements",
  trust_safety: "Cultivates Trust and Safety",
  maintains_presence: "Maintains Presence",
  listens_actively: "Listens Actively",
  evokes_awareness: "Evokes Awareness",
  facilitates_growth: "Facilitates Client Growth",
};

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

    const { data: session, error: sessErr } = await admin
      .from("mentoring_sessions")
      .select("*")
      .eq("id", session_id)
      .maybeSingle();
    if (sessErr || !session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin && session.mentor_id !== callerId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fb, error: fbErr } = await admin
      .from("mentoring_feedback")
      .select("*")
      .eq("mentoring_session_id", session_id)
      .maybeSingle();
    if (fbErr || !fb) {
      return new Response(JSON.stringify({ error: "Feedback not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: participants } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [session.mentor_id, session.mentee_id]);
    const byId = new Map((participants ?? []).map((p) => [p.id, p]));
    const mentorProfile = byId.get(session.mentor_id);
    const menteeProfile = byId.get(session.mentee_id);

    const competencies = Object.entries(COMPETENCY_LABELS).map(([key, label]) => ({
      label,
      value: (fb as Record<string, unknown>)[key] as string | null ?? "",
    }));

    for (const [recipient, recipientIsMentor] of [
      [menteeProfile, false],
      [mentorProfile, true],
    ] as const) {
      if (!recipient?.email) continue;
      const props = {
        recipientName: recipient.full_name || "there",
        mentorName: mentorProfile?.full_name || "your mentor",
        topic: session.topic,
        whenFormatted: formatWhen(session.start_time, session.duration_minutes || 45),
        competencies,
        overallNotes: fb.overall_notes,
        recipientIsMentor,
      };
      const html = await renderAsync(React.createElement(MentoringFeedbackSubmittedEmail, props));
      const text = await renderAsync(React.createElement(MentoringFeedbackSubmittedEmail, props), { plainText: true });
      const result = await sendEmail({
        to: recipient.email,
        subject: recipientIsMentor ? "A copy of your mentoring feedback" : "Your mentor shared feedback on your session",
        html,
        text,
      });
      if (!result.ok) {
        console.error("Failed to send mentoring-feedback-submitted email", { error: result.error, email: recipient.email });
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
