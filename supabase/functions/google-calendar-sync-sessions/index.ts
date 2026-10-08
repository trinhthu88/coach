import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  deleteGoogleCalendarEvent,
  getCalendarConnectionStatus,
  makeAdminClient,
  requestUser,
  syncGoogleCalendarEvent,
  userHasCoachRole,
  type CalendarSource,
} from "../_shared/googleCalendar.ts";

const sourceInfo: Array<{ table: string; coachField: string; source: CalendarSource }> = [
  { table: "sessions", coachField: "coach_id", source: "coaching" },
  { table: "peer_sessions", coachField: "peer_coach_id", source: "peer" },
  { table: "mentoring_sessions", coachField: "mentor_id", source: "mentoring" },
];

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
    const admin = makeAdminClient();
    if (!(await userHasCoachRole(admin, user.id))) {
      return new Response(JSON.stringify({ error: "Coach access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const connection = await getCalendarConnectionStatus(admin, user.id);
    if (!connection.connected) {
      return new Response(JSON.stringify({ error: "Connect Google Calendar before syncing sessions" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    const lowerBound = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
    const upperBound = new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString();
    let synced = 0;
    let removed = 0;
    let failed = 0;

    for (const info of sourceInfo) {
      const { data: rows, error } = await admin
        .from(info.table)
        .select("id, status, topic, start_time, duration_minutes, meeting_url")
        .eq(info.coachField, user.id)
        .in("status", ["confirmed", "cancelled", "rescheduled"])
        .gte("start_time", lowerBound)
        .lte("start_time", upperBound);
      if (error) throw new Error("Could not load sessions for calendar sync");

      for (const row of rows ?? []) {
        try {
          if (row.status === "confirmed") {
            if (new Date(row.start_time).getTime() < now) continue;
            const result = await syncGoogleCalendarEvent(admin, {
              coachId: user.id,
              source: info.source,
              sessionId: row.id,
              topic: row.topic,
              startTime: row.start_time,
              durationMinutes: row.duration_minutes || 45,
              meetingUrl: row.meeting_url,
            });
            if (result.synced) synced += 1;
          } else {
            const result = await deleteGoogleCalendarEvent(admin, user.id, info.source, row.id);
            if (result.removed) removed += 1;
          }
        } catch (error) {
          failed += 1;
          console.error("Google Calendar session reconciliation failed", {
            source: info.source,
            sessionId: row.id,
            message: error instanceof Error ? error.message : "unknown error",
          });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, synced, removed, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Google Calendar session reconciliation failed", error instanceof Error ? error.message : "unknown error");
    return new Response(JSON.stringify({ error: "Could not sync Clariva sessions to Google Calendar" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
