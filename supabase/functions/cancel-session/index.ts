import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/send-email.ts";
import { SessionCancelledEmail } from "../_shared/email-templates/session-cancelled.tsx";

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

function formatWhen(startTimeISO: string, durationMinutes: number): string {
  const start = new Date(startTimeISO);
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  });
  return `${dateFmt.format(start)} · ${durationMinutes} min`;
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
    const { session_id, is_peer, reason } = body as { session_id?: string; is_peer?: boolean; reason?: string };
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const tableName = is_peer ? "peer_sessions" : "sessions";
    const coachField = is_peer ? "peer_coach_id" : "coach_id";
    const coacheeField = is_peer ? "peer_coachee_id" : "coachee_id";

    const { data: row, error: rowErr } = await admin
      .from(tableName)
      .select("*")
      .eq("id", session_id)
      .maybeSingle();
    if (rowErr || !row) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
    const isOwningCoach = row[coachField] === callerId;
    const isOwningCoachee = row[coacheeField] === callerId;
    if (!isAdmin && !isOwningCoach && !isOwningCoachee) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (row.status === "cancelled") {
      return new Response(
        JSON.stringify({ ok: true, already_cancelled: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateErr } = await admin
      .from(tableName)
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: callerId,
        cancel_reason: reason || null,
      })
      .eq("id", session_id);
    if (updateErr) throw updateErr;

    if (!is_peer && row.slot_id) {
      await admin
        .from("coach_availability")
        .update({ is_booked: false, session_id: null })
        .eq("id", row.slot_id);
    }

    const { data: participants } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [row[coachField], row[coacheeField]]);
    const byId = new Map((participants ?? []).map((p) => [p.id, p]));
    const coachProfile = byId.get(row[coachField]);
    const coacheeProfile = byId.get(row[coacheeField]);
    const whenFormatted = formatWhen(row.start_time, row.duration_minutes || 45);

    for (const [recipient, counterpart] of [
      [coacheeProfile, coachProfile],
      [coachProfile, coacheeProfile],
    ] as const) {
      if (!recipient?.email) continue;
      const html = await renderAsync(
        React.createElement(SessionCancelledEmail, {
          recipientName: recipient.full_name || "there",
          counterpartName: counterpart?.full_name || "your session partner",
          topic: row.topic,
          whenFormatted,
          reason: reason || undefined,
        })
      );
      const text = await renderAsync(
        React.createElement(SessionCancelledEmail, {
          recipientName: recipient.full_name || "there",
          counterpartName: counterpart?.full_name || "your session partner",
          topic: row.topic,
          whenFormatted,
          reason: reason || undefined,
        }),
        { plainText: true }
      );
      const result = await sendEmail({
        to: recipient.email,
        subject: "Your session was cancelled",
        html,
        text,
      });
      if (!result.ok) {
        console.error("Failed to send session-cancelled email", { error: result.error, email: recipient.email });
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
