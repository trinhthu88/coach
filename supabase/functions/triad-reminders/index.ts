import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Daily cron sweep (CRON_SECRET-gated, same shape as send-daily-prompt /
// send-programme-reminders) driven by each cohort Triad requirement unit's
// canonical due date (cohort_requirement_dates) and canonical unit state
// (triad_reminder_targets_internal -> canonical module progress):
//   - 3 days out, group session not confirmed  -> remind the group's members
//   - 1 day out, session not confirmed          -> escalate to admin
//   - unit overdue (canonical)                  -> overdue notice to member + admin
//   - eligible learner with no group, due soon / overdue -> admin
// This is distinct from send-programme-reminders' triad_reminder checks
// (which watch individual session times/reflections).
//
// Overdue units are swept for OVERDUE_WINDOW_DAYS after the due date (the
// 30-day notification dedupe keeps that to one notice per unit).

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_WINDOW_DAYS = 60;

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface Target {
  cohort_requirement_date_id: string;
  cohort_id: string;
  unit_number: number;
  due_on: string;
  days_until_due: number;
  enrollment_id: string;
  user_id: string;
  triad_group_id: string | null;
  session_status: string | null;
  unit_completed: boolean;
  unit_overdue: boolean;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Two ways in: the daily cron sweep (x-cron-secret, every unit in a due
    // window) or an admin re-sending reminders for one cohort Triad unit
    // (bearer token + cohort_requirement_date_id, so a manual trigger can't
    // fan out to every cohort).
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    const isCron = !!CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;

    let scopedRequirementId: string | null = null;
    if (!isCron) {
      const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      const { data: userData } = token ? await admin.auth.getUser(token) : { data: null };
      if (!userData?.user) return json({ error: "Forbidden" }, 403);
      const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userData.user.id);
      if (!(roleRows ?? []).some((r: { role: string }) => r.role === "admin")) return json({ error: "Forbidden" }, 403);
      const body = await req.json().catch(() => ({}));
      scopedRequirementId = body.cohort_requirement_date_id ?? null;
      if (!scopedRequirementId) return json({ error: "cohort_requirement_date_id is required" }, 400);
    }

    const dedupeWindowStart = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const { data: existingNotifs } = await admin
      .from("notifications")
      .select("user_id, link")
      .in("notification_type", ["triad_round_reminder", "triad_admin_alert"])
      .gte("created_at", dedupeWindowStart);
    const alreadyNotified = new Set((existingNotifs ?? []).map((n) => `${n.user_id}|${n.link}`));

    async function notifyOnce(userId: string, link: string, type: string, title: string, body: string, titleVi?: string, bodyVi?: string) {
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
        console.error("Failed to insert triad reminder", { userId, error });
        return false;
      }
      return true;
    }

    // Which cohort Triad units to look at (canonical dates only).
    let requirementIds: string[];
    if (scopedRequirementId) {
      requirementIds = [scopedRequirementId];
    } else {
      const { data: due } = await admin
        .from("cohort_requirement_dates")
        .select("id, due_on")
        .eq("module", "triads")
        .or(`due_on.in.(${todayISO(3)},${todayISO(1)}),and(due_on.lt.${todayISO()},due_on.gte.${todayISO(-OVERDUE_WINDOW_DAYS)})`);
      requirementIds = (due ?? []).map((r) => r.id as string);
    }

    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const adminIds = (admins ?? []).map((a) => a.user_id as string);

    let remindersSent = 0;
    let escalationsSent = 0;
    let overdueSent = 0;

    for (const requirementId of requirementIds) {
      const { data, error } = await admin.rpc("triad_reminder_targets_internal", { p_cohort_requirement_date_id: requirementId });
      if (error) {
        console.error("Triad reminder targets failed", { requirementId, error });
        continue;
      }
      const targets = (data ?? []) as Target[];
      if (targets.length === 0) continue;
      const { cohort_id: cohortId, unit_number: unit, due_on: dueOn, days_until_due: daysUntilDue } = targets[0];
      const title = `Triad round ${unit}`;
      const titleVi = `Vòng triad ${unit}`;
      const memberLink = `/triads?requirement=${requirementId}`;
      const adminLink = `/admin/cohorts/${cohortId}/triads?requirement=${requirementId}`;
      const open = targets.filter((t) => !t.unit_completed);
      const ungrouped = open.filter((t) => !t.triad_group_id);

      for (const t of open) {
        if (t.unit_overdue) {
          if (await notifyOnce(t.user_id, memberLink, "triad_round_reminder",
            `Your triad practice for "${title}" is overdue`,
            "The due date has passed. Schedule or complete your session as soon as possible.",
            `Buổi luyện tập triad cho "${titleVi}" đã quá hạn`,
            "Hạn hoàn thành đã qua. Hãy đặt lịch hoặc hoàn thành session của bạn càng sớm càng tốt.")) overdueSent++;
        } else if (daysUntilDue === 3 && t.triad_group_id && t.session_status !== "confirmed") {
          if (await notifyOnce(t.user_id, memberLink, "triad_round_reminder",
            `Confirm your triad session for "${title}"`,
            "Your triad session isn't confirmed yet and the due date is in 3 days. Accept a time or propose an alternative.",
            `Xác nhận session triad của bạn cho "${titleVi}"`,
            "Session triad của bạn chưa được xác nhận và hạn chót còn 3 ngày. Hãy chấp nhận thời gian đề xuất hoặc đề xuất thời gian khác.")) remindersSent++;
        }
      }

      const overdueCount = open.filter((t) => t.unit_overdue).length;
      const unconfirmedGroups = new Set(open.filter((t) => t.triad_group_id && t.session_status !== "confirmed").map((t) => t.triad_group_id)).size;
      for (const userId of adminIds) {
        if (overdueCount > 0) {
          if (await notifyOnce(userId, adminLink, "triad_admin_alert", `Overdue: "${title}"`,
            `${overdueCount} learner(s) have not completed ${title} (due ${dueOn}).`)) overdueSent++;
        } else if (daysUntilDue === 1 && (unconfirmedGroups > 0 || ungrouped.length > 0)) {
          if (await notifyOnce(userId, adminLink, "triad_admin_alert", `"${title}" is due tomorrow`,
            `${unconfirmedGroups} group(s) without a confirmed session and ${ungrouped.length} learner(s) without a group (due ${dueOn}).`)) escalationsSent++;
        }
      }
    }

    return json({ ok: true, remindersSent, escalationsSent, overdueSent });
  } catch (err) {
    console.error("triad-reminders failed", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
