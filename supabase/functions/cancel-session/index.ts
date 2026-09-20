import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/send-email.ts";
import { SessionCancelledEmail } from "../_shared/email-templates/session-cancelled.tsx";

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
    const authClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user } } = await authClient.auth.getUser(token);
    const callerId = user?.id ?? null;
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

    // The database owns the state transition. For Coaching this function calls
    // cancel_coaching_session(), which records the actor, time and reason,
    // releases the availability slot and frees the Coaching requirement for
    // rebooking -- all in one transaction.
    //
    // It previously wrote sessions.status and coach_availability itself. That
    // made it a second lifecycle writer alongside the canonical RPC and the
    // slot-reservation trigger, and it bypassed the authorisation and
    // late-cancellation rules the RPC enforces. Notification failures below
    // can no longer corrupt session state, because the state is already
    // committed by the time they run.
    if (is_peer) {
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
    } else {
      // Run as the caller so the RPC's own authorisation applies, rather than
      // the service role silently passing every check.
      const asCaller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { error: rpcErr } = await asCaller.rpc("cancel_coaching_session", {
        p_session_id: session_id,
        p_reason: reason || null,
      });
      if (rpcErr) {
        return new Response(JSON.stringify({ error: rpcErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
