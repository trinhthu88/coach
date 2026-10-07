import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { httpStatusForRpcError } from "../_shared/sessionTransitionRules.ts";
import {
  deleteGoogleCalendarEvent,
  makeAdminClient,
  requestUser,
  syncGoogleCalendarEvent,
} from "../_shared/googleCalendar.ts";
import {
  adminSessionCalendarColumns,
  syncAdminEditedCalendarSession,
  type AdminSessionCalendarRow,
} from "../_shared/adminSessionCalendarSync.ts";

type AdminEditFunction = "admin_reschedule_session" | "admin_reopen_session";
type SessionKind = "coaching" | "peer";

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

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const user = await requestUser(req);
    if (!user) return respond({ error: "Authentication required" }, 401);
    const authHeader = req.headers.get("Authorization");
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = makeAdminClient();
    const { data: roles, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (roleError) throw new Error("Could not verify Admin access");
    if (!(roles ?? []).some((row: { role: string }) => row.role === "admin")) {
      return respond({ error: "Admin access required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { function_name, args } = body as {
      function_name?: unknown;
      args?: unknown;
    };
    if (
      (function_name !== "admin_reschedule_session" && function_name !== "admin_reopen_session") ||
      !args || typeof args !== "object" || Array.isArray(args)
    ) {
      return respond({ error: "Unsupported Admin session edit" }, 400);
    }
    const rpcArgs = args as Record<string, unknown>;
    const kind = rpcArgs.p_kind;
    const sessionId = rpcArgs.p_session_id;
    if (
      (kind !== "coaching" && kind !== "peer") ||
      typeof sessionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
    ) {
      return respond({ error: "A valid session kind and ID are required" }, 400);
    }

    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader! } },
    });
    const { error: rpcError } = await asCaller.rpc(function_name as AdminEditFunction, rpcArgs as never);
    if (rpcError) return respond({ error: rpcError.message }, httpStatusForRpcError(rpcError.code));

    const table = kind === "peer" ? "peer_sessions" : "sessions";
    const coachField = kind === "peer" ? "peer_coach_id" : "coach_id";
    const source = kind as SessionKind;
    let calendarSync: "not_connected" | "synced" | "removed" | "failed" = "not_connected";
    try {
      const { data: row, error: rowError } = await admin
        .from(table)
        .select(adminSessionCalendarColumns(coachField))
        .eq("id", sessionId)
        .maybeSingle();
      if (rowError || !row) throw new Error("Could not load the edited session for Calendar sync");

      calendarSync = await syncAdminEditedCalendarSession(
        source,
        sessionId,
        row as AdminSessionCalendarRow,
        {
          syncEvent: (input) => syncGoogleCalendarEvent(admin, input),
          removeEvent: (coachId, eventSource, eventSessionId) =>
            deleteGoogleCalendarEvent(admin, coachId, eventSource, eventSessionId),
        },
      );
    } catch (error) {
      calendarSync = "failed";
      console.error(
        "Admin session Google Calendar update failed",
        error instanceof Error ? error.message : "unknown error",
      );
    }

    return respond({ ok: true, calendar_sync: calendarSync });
  } catch (error) {
    console.error("Admin session edit failed", error instanceof Error ? error.message : "unknown error");
    return respond({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
