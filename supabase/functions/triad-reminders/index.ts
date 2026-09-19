import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Daily cron sweep (CRON_SECRET-gated, same shape as send-daily-prompt /
// send-programme-reminders) driven by each cohort's Triad REQUIREMENTS
// (cohort_requirement_dates: "Triad N", each with its own deadline) and each
// learner's fulfilment of THAT requirement (triad_reminder_targets_internal
// -> canonical_triad_requirement_fulfilment). Every required Triad has its
// own group assignment, so each reminder names one Triad:
//   - Triad N due in 3 days, not fulfilled, no confirmed session -> member
//   - Triad N due tomorrow, learners unfulfilled / ungrouped     -> admin
//   - Triad N overdue (its deadline passed, not fulfilled)        -> member + admin
// This is distinct from send-programme-reminders' triad_reminder checks
// (which watch individual session times / reflections).
//
// Overdue requirements are swept for OVERDUE_WINDOW_DAYS after their date (the
// 30-day notification dedupe keeps that to one notice per requirement).

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_WINDOW_DAYS = 60;

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface Target {
  cohort_id: string;
  programme_id: string;
  cohort_requirement_date_id: string;
  milestone_number: number;
  due_on: string;
  days_until_due: number;
  enrollment_id: string;
  user_id: string;
  triad_group_id: string | null;
  open_session_status: string | null;
  milestone_met: boolean;
  milestone_overdue: boolean;
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

    // Two ways in: the daily cron sweep (x-cron-secret, every cohort with a
    // Triad deadline in a reminder window) or an admin re-sending reminders
    // for one cohort (bearer token + cohort_id, so a manual trigger can't
    // fan out to every cohort).
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    const isCron = !!CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;

    let scopedCohortId: string | null = null;
    let scopedRequirementId: string | null = null;
    if (!isCron) {
      const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      const { data: userData } = token ? await admin.auth.getUser(token) : { data: null };
      if (!userData?.user) return json({ error: "Forbidden" }, 403);
      const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userData.user.id);
      if (!(roleRows ?? []).some((r: { role: string }) => r.role === "admin")) return json({ error: "Forbidden" }, 403);
      const body = await req.json().catch(() => ({}));
      scopedCohortId = body.cohort_id ?? null;
      // Optional: one Triad requirement of that cohort (Admin "Send reminder" on a Triad N card).
      scopedRequirementId = body.cohort_requirement_date_id ?? null;
      if (!scopedCohortId) return json({ error: "cohort_id is required" }, 400);
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

    // Which cohorts to look at: the scoped one, or every cohort with a Triad
    // deadline in a reminder window (canonical dates only).
    let cohortIds: string[];
    if (scopedCohortId) {
      cohortIds = [scopedCohortId];
    } else {
      const { data: due } = await admin
        .from("cohort_requirement_dates")
        .select("cohort_id, due_on")
        .eq("module", "triads")
        .or(`due_on.in.(${todayISO(3)},${todayISO(1)}),and(due_on.lt.${todayISO()},due_on.gte.${todayISO(-OVERDUE_WINDOW_DAYS)})`);
      cohortIds = [...new Set((due ?? []).map((r) => r.cohort_id as string))];
    }

    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const adminIds = (admins ?? []).map((a) => a.user_id as string);

    let remindersSent = 0;
    let escalationsSent = 0;
    let overdueSent = 0;

    for (const cohortId of cohortIds) {
      const { data, error } = await admin.rpc("triad_reminder_targets_internal", { p_cohort_id: cohortId });
      if (error) {
        console.error("Triad reminder targets failed", { cohortId, error });
        continue;
      }
      const targets = (data ?? []) as Target[];
      // One pass per requirement ("Triad N") of the cohort.
      const requirements = [...new Set(targets.map((t) => t.cohort_requirement_date_id))];
      for (const requirementId of requirements) {
        if (scopedRequirementId && requirementId !== scopedRequirementId) continue;
        const rows = targets.filter((t) => t.cohort_requirement_date_id === requirementId);
        const { milestone_number: unit, due_on: dueOn, days_until_due: daysUntilDue } = rows[0];
        // Scheduled sweep: only requirements in a reminder window.
        if (!scopedCohortId && !(daysUntilDue === 3 || daysUntilDue === 1 || (daysUntilDue < 0 && daysUntilDue >= -OVERDUE_WINDOW_DAYS))) continue;
        const title = `Triad ${unit} due ${dueOn}`;
        const titleVi = `Triad ${unit} hạn ${dueOn}`;
        // The 30-day dedupe is per (user, link), so each notice kind gets its
        // own link: a pre-due reminder must never suppress the overdue notice.
        const memberLink = (notice: "reminder" | "overdue") => `/triads?triad=${unit}&due=${dueOn}&notice=${notice}`;
        const adminLink = (notice: "due_tomorrow" | "overdue") =>
          `/admin/cohorts/${cohortId}/triads?triad=${unit}&due=${dueOn}&notice=${notice}`;
        const open = rows.filter((t) => !t.milestone_met);
        const ungrouped = open.filter((t) => !t.triad_group_id);

        for (const t of open) {
          if (t.milestone_overdue) {
            if (await notifyOnce(t.user_id, memberLink("overdue"), "triad_round_reminder",
              `Triad deadline passed: ${title}`,
              t.triad_group_id
                ? `Your Triad ${unit} session was due by ${dueOn}. Schedule and complete it with your Triad ${unit} group as soon as possible.`
                : `Triad ${unit} was due by ${dueOn} and your group assignment is still pending. An admin will follow up.`,
              `Đã quá hạn Triad: ${titleVi}`,
              t.triad_group_id
                ? `Session Triad ${unit} của bạn cần hoàn thành trước ${dueOn}. Hãy lên lịch và hoàn thành cùng nhóm Triad ${unit} càng sớm càng tốt.`
                : `Triad ${unit} cần hoàn thành trước ${dueOn} và bạn chưa được xếp nhóm. Quản trị viên sẽ liên hệ.`)) overdueSent++;
          } else if (daysUntilDue === 3 && t.triad_group_id && t.open_session_status !== "confirmed") {
            if (await notifyOnce(t.user_id, memberLink("reminder"), "triad_round_reminder",
              `Triad deadline in 3 days: ${title}`,
              `You don't have a confirmed Triad ${unit} session yet. Accept a proposed time or propose one to your Triad ${unit} group.`,
              `Còn 3 ngày đến hạn Triad: ${titleVi}`,
              `Bạn chưa có session Triad ${unit} nào được xác nhận. Hãy chấp nhận thời gian đã đề xuất hoặc đề xuất thời gian cho nhóm Triad ${unit}.`)) remindersSent++;
          }
        }

        const overdueCount = open.filter((t) => t.milestone_overdue).length;
        const unconfirmed = open.filter((t) => t.triad_group_id && t.open_session_status !== "confirmed").length;
        for (const userId of adminIds) {
          if (overdueCount > 0) {
            if (await notifyOnce(userId, adminLink("overdue"), "triad_admin_alert", `Triad overdue: ${title}`,
              `${overdueCount} learner(s) have not completed Triad ${unit} (due ${dueOn}); ${ungrouped.length} of them have no Triad ${unit} group.`)) overdueSent++;
          } else if (daysUntilDue === 1 && (unconfirmed > 0 || ungrouped.length > 0)) {
            if (await notifyOnce(userId, adminLink("due_tomorrow"), "triad_admin_alert", `Triad deadline tomorrow: ${title}`,
              `${unconfirmed} learner(s) without a confirmed Triad ${unit} session and ${ungrouped.length} learner(s) without a Triad ${unit} group (due ${dueOn}).`)) escalationsSent++;
          }
        }
      }
    }

    return json({ ok: true, remindersSent, escalationsSent, overdueSent });
  } catch (err) {
    console.error("triad-reminders failed", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
