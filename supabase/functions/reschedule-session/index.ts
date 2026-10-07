import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { httpStatusForRpcError } from "../_shared/sessionTransitionRules.ts";
import {
  deleteGoogleCalendarEvent,
  makeAdminClient,
  requestUser,
} from "../_shared/googleCalendar.ts";

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const user = await requestUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authHeader = req.headers.get("Authorization");
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const body = await req.json().catch(() => ({}));
    const { session_id, new_slot_id, reason } = body as {
      session_id?: string;
      new_slot_id?: string;
      reason?: string | null;
    };
    if (!session_id || !new_slot_id) {
      return new Response(JSON.stringify({ error: "session_id and new_slot_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader! } },
    });
    const { data: replacementId, error: rescheduleError } = await asCaller.rpc(
      "reschedule_coaching_session",
      {
        p_session_id: session_id,
        p_new_slot_id: new_slot_id,
        p_reason: reason ?? undefined,
      },
    );
    if (rescheduleError) {
      return new Response(JSON.stringify({ error: rescheduleError.message }), {
        status: httpStatusForRpcError(rescheduleError.code),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The transaction has already moved the booking. Calendar cleanup is
    // best-effort and uses the coach's stored connection, not the learner's.
    let calendarSync: "not_connected" | "removed" | "failed" = "not_connected";
    try {
      const admin = makeAdminClient();
      const { data: oldSession, error: lookupError } = await admin
        .from("sessions")
        .select("coach_id")
        .eq("id", session_id)
        .maybeSingle();
      if (lookupError || !oldSession) {
        throw new Error("Could not load the rescheduled session's coach");
      }
      const result = await deleteGoogleCalendarEvent(
        admin,
        oldSession.coach_id,
        "coaching",
        session_id,
      );
      if (result.connected && result.removed) calendarSync = "removed";
    } catch (error) {
      calendarSync = "failed";
      console.error(
        "Rescheduled session Google Calendar cleanup failed",
        error instanceof Error ? error.message : "unknown error",
      );
    }

    return new Response(JSON.stringify({
      ok: true,
      session_id: replacementId,
      calendar_sync: calendarSync,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
