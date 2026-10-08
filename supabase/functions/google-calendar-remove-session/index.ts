import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  deleteGoogleCalendarEvent,
  makeAdminClient,
  requestUser,
  type CalendarSource,
} from "../_shared/googleCalendar.ts";

const sourceInfo: Record<CalendarSource, {
  table: string;
  coachField: string;
  learnerField: string;
}> = {
  coaching: { table: "sessions", coachField: "coach_id", learnerField: "coachee_id" },
  peer: { table: "peer_sessions", coachField: "peer_coach_id", learnerField: "peer_coachee_id" },
  mentoring: { table: "mentoring_sessions", coachField: "mentor_id", learnerField: "mentee_id" },
};

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
    const body = await req.json().catch(() => ({}));
    const source = body?.source as CalendarSource | undefined;
    const sessionId = body?.session_id;
    if (!source || !sourceInfo[source] || typeof sessionId !== "string") {
      return new Response(JSON.stringify({ error: "A valid session and type are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = makeAdminClient();
    const info = sourceInfo[source];
    const { data: row, error: rowError } = await admin
      .from(info.table)
      .select(`id, status, ${info.coachField}, ${info.learnerField}`)
      .eq("id", sessionId)
      .maybeSingle();
    if (rowError || !row) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (roleError) throw new Error("Could not verify session access");
    const isAdmin = (roles ?? []).some((role: { role: string }) => role.role === "admin");
    if (
      !isAdmin &&
      row[info.coachField] !== user.id &&
      row[info.learnerField] !== user.id
    ) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["cancelled", "rescheduled"].includes(row.status)) {
      return new Response(JSON.stringify({ error: "The session is not cancelled" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await deleteGoogleCalendarEvent(
      admin,
      row[info.coachField] as string,
      source,
      sessionId,
    );
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Google Calendar event removal failed", error instanceof Error ? error.message : "unknown error");
    return new Response(JSON.stringify({ error: "Could not remove the session from Google Calendar" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
