import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { formatSessionWhen } from "../_shared/programmeTime.ts";
import { sendEmail } from "../_shared/send-email.ts";
import { SessionCancelledEmail } from "../_shared/email-templates/session-cancelled.tsx";
import { decideTransition, httpStatusForRpcError, transitionRpc } from "../_shared/sessionTransitionRules.ts";
import { deleteGoogleCalendarEvent } from "../_shared/googleCalendar.ts";

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
    const { session_id, is_peer, is_mentoring, reason } = body as {
      session_id?: string;
      is_peer?: boolean;
      is_mentoring?: boolean;
      reason?: string;
    };
    if (is_peer && is_mentoring) {
      return new Response(JSON.stringify({ error: "A session can have only one type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const tableName = is_mentoring ? "mentoring_sessions" : is_peer ? "peer_sessions" : "sessions";
    const coachField = is_mentoring ? "mentor_id" : is_peer ? "peer_coach_id" : "coach_id";
    const coacheeField = is_mentoring ? "mentee_id" : is_peer ? "peer_coachee_id" : "coachee_id";

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

    const { data: roleRows, error: rolesError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (rolesError) throw new Error("Could not verify session cancellation permissions");
    const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
    const isOwningCoach = row[coachField] === callerId;
    const isOwningCoachee = row[coacheeField] === callerId;
    // Authorisation belongs to the RPC below; this only keeps a stranger from
    // learning the session's status from the 409.
    if (!isAdmin && !isOwningCoach && !isOwningCoachee) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A cancelled, completed or rescheduled session cannot be cancelled. The
    // RPC below enforces the same rule; refusing here keeps the response
    // explicit and sends no email.
    const decision = decideTransition("cancel", row.status);
    if (decision.kind === "refuse") {
      return new Response(JSON.stringify({ error: decision.error }), {
        status: decision.httpStatus,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The database owns the state transition, run AS THE CALLER so the RPC's
    // own authorisation and rules apply: cancel_coaching_session() for Coaching
    // (records actor, time and reason, releases the slot and the requirement,
    // the 24-hour reason rule) and transition_peer_session_status() for Peer.
    // The service role never writes a status. Notification failures below
    // cannot corrupt session state: it is already committed.
    const asCaller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const rpc = is_mentoring
      ? {
          fn: "transition_mentoring_session_status",
          args: {
            p_session_id: session_id,
            p_status: "cancelled",
            p_reason: reason || null,
          },
        }
      : transitionRpc("cancel", !!is_peer, session_id, { reason });
    const { error: rpcErr } = await asCaller.rpc(rpc.fn, rpc.args);
    if (rpcErr) {
      return new Response(JSON.stringify({ error: rpcErr.message }), {
        status: httpStatusForRpcError(rpcErr.code),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let calendarSync: "not_connected" | "removed" | "failed" = "not_connected";
    try {
      const result = await deleteGoogleCalendarEvent(
        admin,
        row[coachField] as string,
        is_mentoring ? "mentoring" : is_peer ? "peer" : "coaching",
        session_id,
      );
      if (result.connected && result.removed) calendarSync = "removed";
    } catch (error) {
      calendarSync = "failed";
      console.error("Cancelled session Google Calendar cleanup failed", error instanceof Error ? error.message : "unknown error");
    }

    const { data: participants } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [row[coachField], row[coacheeField]]);
    const byId = new Map((participants ?? []).map((p) => [p.id, p]));
    const coachProfile = byId.get(row[coachField]);
    const coacheeProfile = byId.get(row[coacheeField]);
    const whenFormatted = formatSessionWhen(row.start_time, row.duration_minutes || 45);

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

    return new Response(JSON.stringify({ ok: true, calendar_sync: calendarSync }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
