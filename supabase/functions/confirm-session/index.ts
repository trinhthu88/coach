import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { formatSessionWhen, PROGRAMME_TIME_ZONE } from "../_shared/programmeTime.ts";
import { sendEmail } from "../_shared/send-email.ts";
import { SessionConfirmedEmail } from "../_shared/email-templates/session-confirmed.tsx";
import { decideTransition, httpStatusForRpcError, transitionRpc } from "../_shared/sessionTransitionRules.ts";
import { getGoogleBusyIntervals, syncGoogleCalendarEvent } from "../_shared/googleCalendar.ts";
import { tryGoogleCalendarCheck } from "../_shared/googleCalendarPolicy.ts";

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
      timezone: PROGRAMME_TIME_ZONE,
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

async function syncCalendarForSession(
  admin: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
  coachId: string,
  isPeer: boolean,
  sessionId: string,
): Promise<"not_connected" | "synced" | "failed"> {
  try {
    const result = await syncGoogleCalendarEvent(admin, {
      coachId,
      source: isPeer ? "peer" : "coaching",
      sessionId,
      topic: typeof row.topic === "string" ? row.topic : null,
      startTime: String(row.start_time),
      durationMinutes: Number(row.duration_minutes) || 45,
      meetingUrl: typeof row.meeting_url === "string" ? row.meeting_url : null,
    });
    return result.connected && result.synced ? "synced" : "not_connected";
  } catch (error) {
    console.error("Confirmed session Google Calendar sync failed", error instanceof Error ? error.message : "unknown error");
    return "failed";
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
    // Authorisation belongs to the RPC below; this only spares a Zoom meeting
    // for a caller who could never confirm.
    if (!isAdmin && !isOwningCoach) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refuse a session that can no longer be confirmed BEFORE creating a Zoom
    // meeting. The RPC below enforces the same rule; this only avoids the side
    // effect.
    const decision = decideTransition("confirm", row.status);
    if (decision.kind === "refuse") {
      return new Response(JSON.stringify({ error: decision.error }), {
        status: decision.httpStatus,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (decision.kind === "already_confirmed") {
      const calendarSync = await syncCalendarForSession(admin, row, row[coachField] as string, !!is_peer, session_id);
      return new Response(
        JSON.stringify({
          ok: true,
          meeting_url: row.meeting_url,
          already_confirmed: true,
          calendar_sync: calendarSync,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Recheck the coach's live Google busy intervals immediately before
    // confirmation. The learner booking check is only a snapshot and may have
    // gone stale while the request was pending.
    const calendarWindowStart = new Date(row.start_time as string);
    const sessionEnd = new Date(
      calendarWindowStart.getTime() + (Number(row.duration_minutes) || 45) * 60_000,
    );
    // Calendar availability is advisory: a provider outage, revoked token, or
    // invalid API response must not prevent a valid database confirmation.
    // Admins can confirm despite a real Google busy interval as well.
    const calendarAvailability = isAdmin
      ? null
      : await tryGoogleCalendarCheck(
          () => getGoogleBusyIntervals(
            admin,
            row[coachField] as string,
            calendarWindowStart.toISOString(),
            sessionEnd.toISOString(),
          ),
          (error) => console.error(
            "Could not check Google Calendar before confirmation",
            error instanceof Error ? error.message : "unknown error",
          ),
        );
    if (
      calendarAvailability?.connected &&
      calendarAvailability.busy.some((interval) =>
        new Date(interval.start).getTime() < sessionEnd.getTime() &&
        new Date(interval.end).getTime() > calendarWindowStart.getTime()
      )
    ) {
      return new Response(JSON.stringify({ ok: false, calendar_conflict: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    // The database owns the transition: confirm_coaching_session() /
    // confirm_peer_session() run AS THE CALLER, so their own authorisation and
    // pending -> confirmed rule apply, and set status, confirmed_at and the
    // meeting link in one step. The service role never writes a status.
    const asCaller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const rpc = transitionRpc("confirm", !!is_peer, session_id, { meetingUrl });
    const { error: rpcErr } = await asCaller.rpc(rpc.fn, rpc.args);
    if (rpcErr) {
      return new Response(JSON.stringify({ error: rpcErr.message }), {
        status: httpStatusForRpcError(rpcErr.code),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rowForCalendar = { ...row, meeting_url: meetingUrl } as Record<string, unknown>;
    const calendarSync = await syncCalendarForSession(
      admin,
      rowForCalendar,
      row[coachField] as string,
      !!is_peer,
      session_id,
    );

    // Coaching slots are reserved the moment the learner requests them, by
    // sync_coaching_slot_reservation() on `sessions` -- not here. Re-reserving
    // at confirmation was the old model, where the slot stayed available until
    // the Coach acted and two learners could hold the same time. Writing it
    // again would be a second ownership action over state the database
    // already owns.
    //
    // Peer sessions never reserved availability here either -- book_peer_session()
    // does it at booking time -- so there is nothing left for this function to
    // write. Confirmation now only sets the session's own status and meeting URL.

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
        React.createElement(SessionConfirmedEmail, {
          recipientName: recipient.full_name || "there",
          counterpartName: counterpart?.full_name || "your session partner",
          topic: row.topic,
          whenFormatted,
          meetingUrl,
        })
      );
      const text = await renderAsync(
        React.createElement(SessionConfirmedEmail, {
          recipientName: recipient.full_name || "there",
          counterpartName: counterpart?.full_name || "your session partner",
          topic: row.topic,
          whenFormatted,
          meetingUrl,
        }),
        { plainText: true }
      );
      const result = await sendEmail({
        to: recipient.email,
        subject: "Your session is confirmed",
        html,
        text,
      });
      if (!result.ok) {
        console.error("Failed to send session-confirmed email", { error: result.error, email: recipient.email });
      }
    }

    return new Response(JSON.stringify({ ok: true, meeting_url: meetingUrl, calendar_sync: calendarSync }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
