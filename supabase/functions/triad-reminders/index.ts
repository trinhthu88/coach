import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Daily cron sweep (CRON_SECRET-gated, same shape as send-daily-prompt /
// send-programme-reminders) driven off triad_rounds.completion_deadline:
//   - 3 days out, session not confirmed  -> remind the group's members
//   - 1 day out, session not confirmed   -> escalate to admin
//   - past deadline, session not completed -> overdue notice to admin + members
// This is distinct from send-programme-reminders' existing triad_reminder
// checks (which watch individual session times/reflections) — this one is
// purely about the round's completion_deadline.

const DAY_MS = 24 * 60 * 60 * 1000;

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Two ways in: the daily cron sweep (x-cron-secret, processes every
    // round) or an admin manually re-sending reminders for one round from
    // the admin triads page (bearer token, requires a round_id so a manual
    // trigger can't fan out to every round in the system).
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    const providedSecret = req.headers.get("x-cron-secret");
    const isCron = !!CRON_SECRET && providedSecret === CRON_SECRET;

    let scopedRoundId: string | null = null;
    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.replace(/^Bearer\s+/i, "");
      const { data: userData } = token ? await admin.auth.getUser(token) : { data: null };
      if (!userData?.user) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userData.user.id);
      const isAdmin = (roleRows ?? []).some((r: { role: string }) => r.role === "admin");
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const body = await req.json().catch(() => ({}));
      scopedRoundId = body.round_id ?? null;
      if (!scopedRoundId) {
        return new Response(JSON.stringify({ error: "round_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const dedupeWindowStart = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const { data: existingNotifs } = await admin
      .from("notifications")
      .select("user_id, link")
      .in("notification_type", ["triad_round_reminder", "triad_admin_alert"])
      .gte("created_at", dedupeWindowStart);
    const alreadyNotified = new Set((existingNotifs ?? []).map((n) => `${n.user_id}|${n.link}`));

    async function notifyOnce(
      userId: string,
      link: string,
      type: string,
      title: string,
      body: string,
      titleVi?: string,
      bodyVi?: string,
    ) {
      const key = `${userId}|${link}`;
      if (alreadyNotified.has(key)) return false;
      alreadyNotified.add(key);
      const { error } = await admin.from("notifications").insert({
        user_id: userId,
        notification_type: type,
        title,
        title_vi: titleVi ?? null,
        body,
        body_vi: bodyVi ?? null,
        link,
      });
      if (error) {
        console.error("Failed to insert triad round reminder", { userId, error });
        return false;
      }
      return true;
    }

    const today = todayISO();
    const in3Days = todayISO(3);
    const in1Day = todayISO(1);

    let allRounds: { id: string; title: string; title_vi: string | null; completion_deadline: string }[];
    if (scopedRoundId) {
      const { data: round } = await admin
        .from("triad_rounds")
        .select("id, title, title_vi, completion_deadline")
        .eq("id", scopedRoundId)
        .maybeSingle();
      allRounds = round ? [round] : [];
    } else {
      const { data: exactRounds } = await admin
        .from("triad_rounds")
        .select("id, title, title_vi, completion_deadline")
        .in("completion_deadline", [in3Days, in1Day]);

      const { data: overdueRounds } = await admin
        .from("triad_rounds")
        .select("id, title, title_vi, completion_deadline")
        .lt("completion_deadline", today);

      allRounds = [...(exactRounds ?? []), ...(overdueRounds ?? [])];
    }
    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const adminIds = (admins ?? []).map((a) => a.user_id as string);

    let remindersSent = 0;
    let escalationsSent = 0;
    let overdueSent = 0;

    for (const round of allRounds) {
      const { data: groups } = await admin
        .from("triad_groups")
        .select("id, member_1_id, member_2_id, member_3_id, triad_sessions(status)")
        .eq("triad_round_id", round.id)
        .eq("is_active", true);

      interface GroupWithSessions {
        id: string;
        member_1_id: string;
        member_2_id: string;
        member_3_id: string | null;
        triad_sessions: { status: string }[];
      }
      for (const g of (groups ?? []) as unknown as GroupWithSessions[]) {
        const sessions = g.triad_sessions ?? [];
        const isDone = sessions.some((s) => s.status === "completed");
        if (isDone) continue;
        const isConfirmed = sessions.some((s) => s.status === "confirmed");
        const members = [g.member_1_id, g.member_2_id, g.member_3_id].filter(Boolean) as string[];
        const deadline = round.completion_deadline as string;

        if (deadline < today) {
          for (const userId of members) {
            const sent = await notifyOnce(
              userId,
              "/triads",
              "triad_round_reminder",
              `Your triad practice for "${round.title}" is overdue`,
              "The completion deadline has passed. Schedule or complete your session as soon as possible.",
              `Buổi luyện tập triad cho "${round.title_vi || round.title}" đã quá hạn`,
              "Hạn hoàn thành đã qua. Hãy đặt lịch hoặc hoàn thành session của bạn càng sớm càng tốt.",
            );
            if (sent) overdueSent++;
          }
          for (const userId of adminIds) {
            const sent = await notifyOnce(
              userId,
              "/admin/triads",
              "triad_admin_alert",
              `Overdue triad group for "${round.title}"`,
              `A triad group is past its ${deadline} deadline and hasn't completed its session.`,
            );
            if (sent) overdueSent++;
          }
        } else if (deadline === in1Day && !isConfirmed) {
          for (const userId of adminIds) {
            const sent = await notifyOnce(
              userId,
              "/admin/triads",
              "triad_admin_alert",
              `Triad group for "${round.title}" still not confirmed`,
              `Deadline is tomorrow (${deadline}) and this group hasn't confirmed a session time.`,
            );
            if (sent) escalationsSent++;
          }
        } else if (deadline === in3Days && !isConfirmed) {
          for (const userId of members) {
            const sent = await notifyOnce(
              userId,
              "/triads",
              "triad_round_reminder",
              `Confirm your triad session for "${round.title}"`,
              "Your triad session isn't confirmed yet and the deadline is in 3 days. Accept a time or propose an alternative.",
              `Xác nhận session triad của bạn cho "${round.title_vi || round.title}"`,
              "Session triad của bạn chưa được xác nhận và hạn chót còn 3 ngày. Hãy chấp nhận thời gian đề xuất hoặc đề xuất thời gian khác.",
            );
            if (sent) remindersSent++;
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, remindersSent, escalationsSent, overdueSent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("triad-reminders failed", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
