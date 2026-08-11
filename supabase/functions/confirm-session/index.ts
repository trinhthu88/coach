import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

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

async function getZoomAccessToken(): Promise<string> {
  const accountId = Deno.env.get("ZOOM_ACCOUNT_ID")!;
  const clientId = Deno.env.get("ZOOM_CLIENT_ID")!;
  const clientSecret = Deno.env.get("ZOOM_CLIENT_SECRET")!;
  const basic = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } }
  );
  if (!res.ok) {
    throw new Error(`Zoom auth failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

async function createZoomMeeting(opts: {
  accessToken: string;
  topic: string;
  startTimeISO: string;
  durationMinutes: number;
}): Promise<{ join_url: string; id: number }> {
  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: opts.topic,
      type: 2, // scheduled meeting
      start_time: opts.startTimeISO,
      duration: opts.durationMinutes,
      timezone: "UTC",
      settings: {
        join_before_host: true,
        waiting_room: false,
        approval_type: 2,
        mute_upon_entry: true,
        host_video: true,
        participant_video: true,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Zoom meeting creation failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
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
    const { session_id, is_peer } = body as { session_id?: string; is_peer?: boolean };
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const tableName = is_peer ? "peer_sessions" : "sessions";
    const coachField = is_peer ? "peer_coach_id" : "coach_id";

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
    if (!isAdmin && !isOwningCoach) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (row.status === "confirmed" && row.meeting_url) {
      return new Response(
        JSON.stringify({ ok: true, meeting_url: row.meeting_url, already_confirmed: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let meetingUrl = row.meeting_url as string | null;
    if (!meetingUrl) {
      const accessToken = await getZoomAccessToken();
      const meeting = await createZoomMeeting({
        accessToken,
        topic: row.topic || "Coaching session",
        startTimeISO: row.start_time,
        durationMinutes: row.duration_minutes || 45,
      });
      meetingUrl = meeting.join_url;
    }

    const { error: updateErr } = await admin
      .from(tableName)
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        meeting_url: meetingUrl,
      })
      .eq("id", session_id);
    if (updateErr) throw updateErr;

    if (!is_peer && row.slot_id) {
      await admin
        .from("coach_availability")
        .update({ is_booked: true, session_id })
        .eq("id", row.slot_id);
    }

    return new Response(JSON.stringify({ ok: true, meeting_url: meetingUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
