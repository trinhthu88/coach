import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/send-email.ts";
import { ProgrammeReminderEmail } from "../_shared/email-templates/programme-reminder.tsx";

// Phase 3 (programme management completion): the daily 09:00 sweep that
// covers the reminder/alert kinds the task calls for — overdue assignments,
// missed/upcoming/unscheduled triad sessions, and stale participants.
// Triggered the same way send-daily-prompt is — an external cron (or
// pg_cron -> pg_net) POST with the CRON_SECRET shared secret, hence
// verify_jwt = false.
//
// Every user-facing reminder here goes through `notifyOnce`, which dedupes
// on (user_id, link) against notifications already sent — required because
// this function runs daily and re-scans the same overdue/at-risk state
// every time it does, unlike send-daily-prompt which naturally stops once a
// daily_prompt_responses row exists.

const SITE_URL = "https://clariva.club";
const DAY_MS = 24 * 60 * 60 * 1000;

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  preferred_language: string | null;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const CRON_SECRET = Deno.env.get("CRON_SECRET");
    const providedSecret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const profileCache = new Map<string, ProfileRow>();
    async function getProfiles(ids: string[]): Promise<Map<string, ProfileRow>> {
      const missing = ids.filter((id) => !profileCache.has(id));
      if (missing.length > 0) {
        const { data } = await admin
          .from("profiles")
          .select("id, full_name, email, preferred_language")
          .in("id", [...new Set(missing)]);
        for (const p of (data || []) as ProfileRow[]) profileCache.set(p.id, p);
      }
      const out = new Map<string, ProfileRow>();
      for (const id of ids) {
        const p = profileCache.get(id);
        if (p) out.set(id, p);
      }
      return out;
    }

    // Existing notifications, used to dedupe every reminder below on
    // (user_id, link) — bounded to the last 30 days so this stays cheap.
    const dedupeWindowStart = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const { data: existingNotifs } = await admin
      .from("notifications")
      .select("user_id, link")
      .in("notification_type", ["assignment_overdue", "triad_reminder"])
      .gte("created_at", dedupeWindowStart);
    const alreadyNotified = new Set((existingNotifs || []).map((n) => `${n.user_id}|${n.link}`));

    let overdueSent = 0;
    let triadReflectionSent = 0;
    let triadUpcomingSent = 0;
    let staleAlerts = 0;

    async function notifyOnce(opts: {
      userId: string;
      link: string;
      type: string;
      title: string;
      titleVi: string;
      body: string;
      bodyVi: string;
      ctaLabel: string;
      ctaLabelVi: string;
    }): Promise<boolean> {
      const key = `${opts.userId}|${opts.link}`;
      if (alreadyNotified.has(key)) return false;
      alreadyNotified.add(key);

      const { error: notifErr } = await admin.from("notifications").insert({
        user_id: opts.userId,
        notification_type: opts.type,
        title: opts.title,
        title_vi: opts.titleVi,
        body: opts.body,
        body_vi: opts.bodyVi,
        link: opts.link,
      });
      if (notifErr) {
        console.error("Failed to insert reminder notification", { userId: opts.userId, error: notifErr });
        return false;
      }

      const [profile] = [...(await getProfiles([opts.userId])).values()];
      if (profile?.email) {
        const isVi = profile.preferred_language === "vi";
        const props = {
          fullName: profile.full_name || "there",
          title: opts.title,
          titleVi: opts.titleVi,
          body: opts.body,
          bodyVi: opts.bodyVi,
          ctaLabel: opts.ctaLabel,
          ctaLabelVi: opts.ctaLabelVi,
          ctaUrl: `${SITE_URL}${opts.link}`,
          isVi,
        };
        const html = await renderAsync(React.createElement(ProgrammeReminderEmail, props));
        const text = await renderAsync(React.createElement(ProgrammeReminderEmail, props), { plainText: true });
        const result = await sendEmail({
          to: profile.email,
          subject: (isVi && opts.titleVi) || opts.title,
          html,
          text,
        });
        if (!result.ok) {
          console.error("Failed to send reminder email", { error: result.error, email: profile.email });
        }
      }
      return true;
    }

    // ------------------------------------------------------------------
    // 1. Overdue assignments
    // ------------------------------------------------------------------
    const { data: quizModules } = await admin
      .from("programme_modules")
      .select("programme_id")
      .eq("module", "quiz")
      .eq("enabled", true);
    const quizProgrammeIds = new Set((quizModules || []).map((m) => m.programme_id as string));

    if (quizProgrammeIds.size > 0) {
      const { data: weeks } = await admin
        .from("training_weeks")
        .select("id, programme_id, unlock_date")
        .in("programme_id", [...quizProgrammeIds])
        .not("unlock_date", "is", null);
      const weekById = new Map((weeks || []).map((w) => [w.id as string, w]));

      const { data: assignments } = await admin
        .from("assignments")
        .select("id, training_week_id, assignment_type, due_offset_days, is_visible")
        .eq("is_visible", true)
        .not("due_offset_days", "is", null)
        .in("training_week_id", [...weekById.keys()]);

      const today = todayISO();
      for (const a of assignments || []) {
        const week = weekById.get(a.training_week_id as string);
        if (!week) continue;
        const dueDate = new Date(`${week.unlock_date}T00:00:00Z`);
        dueDate.setUTCDate(dueDate.getUTCDate() + (a.due_offset_days as number));
        if (dueDate.toISOString().slice(0, 10) >= today) continue; // not yet overdue

        const { data: enrollments } = await admin
          .from("programme_enrollments")
          .select("user_id")
          .eq("programme_id", week.programme_id)
          .eq("status", "active");
        const enrolledIds = [...new Set((enrollments || []).map((e) => e.user_id as string))];
        if (enrolledIds.length === 0) continue;

        const { data: submissions } = await admin
          .from("assignment_submissions")
          .select("user_id")
          .eq("assignment_id", a.id)
          .in("user_id", enrolledIds);
        const submittedIds = new Set((submissions || []).map((s) => s.user_id as string));
        const pendingIds = enrolledIds.filter((id) => !submittedIds.has(id));

        const link =
          a.assignment_type === "quiz"
            ? `/training/${a.training_week_id}/quiz/${a.id}`
            : `/training/${a.training_week_id}/reflect/${a.id}`;

        for (const userId of pendingIds) {
          const sent = await notifyOnce({
            userId,
            link,
            type: "assignment_overdue",
            title: "An assignment is overdue",
            titleVi: "Một bài tập đã quá hạn",
            body: "You have a training assignment that's now overdue. Take a few minutes to complete it.",
            bodyVi: "Bạn có một bài tập đào tạo đã quá hạn. Hãy dành vài phút để hoàn thành.",
            ctaLabel: "Complete assignment",
            ctaLabelVi: "Hoàn thành bài tập",
          });
          if (sent) overdueSent++;
        }
      }
    }

    // Triad participants are the group's member enrollments (canonical
    // membership); the learner is the enrollment's user.
    async function triadMembersByGroup(groupIds: string[]) {
      const byGroup = new Map<string, { enrollmentId: string; userId: string }[]>();
      if (groupIds.length === 0) return byGroup;
      const { data } = await admin
        .from("triad_group_members")
        .select("triad_group_id, enrollment_id, programme_enrollments(user_id)")
        .in("triad_group_id", groupIds);
      for (const row of data || []) {
        const userId = (row.programme_enrollments as { user_id: string } | null)?.user_id;
        if (!userId) continue;
        const list = byGroup.get(row.triad_group_id as string) || [];
        list.push({ enrollmentId: row.enrollment_id as string, userId });
        byGroup.set(row.triad_group_id as string, list);
      }
      return byGroup;
    }

    // ------------------------------------------------------------------
    // 2. Missed triad reflections (sessions completed in the past 7 days;
    //    a reflection follows completion)
    // ------------------------------------------------------------------
    const weekAgo = todayISO(-7);
    const today = todayISO();
    const { data: pastSessions } = await admin
      .from("triad_sessions")
      .select("id, triad_group_id, scheduled_start_time")
      .eq("status", "completed")
      .gte("scheduled_start_time", `${weekAgo}T00:00:00Z`)
      .lt("scheduled_start_time", `${today}T00:00:00Z`);

    if (pastSessions && pastSessions.length > 0) {
      const membersByGroup = await triadMembersByGroup([...new Set(pastSessions.map((s) => s.triad_group_id as string))]);
      const sessionIds = pastSessions.map((s) => s.id as string);
      const { data: reflections } = await admin
        .from("triad_reflections")
        .select("triad_session_id, enrollment_id")
        .in("triad_session_id", sessionIds);
      const submittedBySession = new Map<string, Set<string>>();
      for (const r of reflections || []) {
        const set = submittedBySession.get(r.triad_session_id as string) || new Set<string>();
        if (r.enrollment_id) set.add(r.enrollment_id as string);
        submittedBySession.set(r.triad_session_id as string, set);
      }

      for (const s of pastSessions) {
        const members = membersByGroup.get(s.triad_group_id as string) || [];
        const submitted = submittedBySession.get(s.id as string) || new Set<string>();
        const link = `/triads/${s.id}/reflect`;
        for (const member of members.filter((m) => !submitted.has(m.enrollmentId))) {
          const sent = await notifyOnce({
            userId: member.userId,
            link,
            type: "triad_reminder",
            title: "Your triad reflection is still open",
            titleVi: "Phản hồi triad của bạn vẫn chưa hoàn tất",
            body: "Take a few minutes to reflect on your recent triad practice session.",
            bodyVi: "Hãy dành vài phút để phản hồi về session luyện tập triad gần đây của bạn.",
            ctaLabel: "Write reflection",
            ctaLabelVi: "Viết phản hồi",
          });
          if (sent) triadReflectionSent++;
        }
      }
    }

    // ------------------------------------------------------------------
    // 3. Upcoming triad sessions (tomorrow)
    // ------------------------------------------------------------------
    const tomorrow = todayISO(1);
    const dayAfterTomorrow = todayISO(2);
    const { data: upcomingSessions } = await admin
      .from("triad_sessions")
      .select("id, triad_group_id")
      .gte("scheduled_start_time", `${tomorrow}T00:00:00Z`)
      .lt("scheduled_start_time", `${dayAfterTomorrow}T00:00:00Z`)
      .in("status", ["proposed", "confirmed"]);

    if (upcomingSessions && upcomingSessions.length > 0) {
      const membersByGroup = await triadMembersByGroup([...new Set(upcomingSessions.map((s) => s.triad_group_id as string))]);
      for (const s of upcomingSessions) {
        // Query-string suffix keeps this dedupe key per-session while still
        // landing the user on the real /triads route (query is ignored there).
        const link = `/triads?upcoming=${s.id}`;
        for (const member of membersByGroup.get(s.triad_group_id as string) || []) {
          const sent = await notifyOnce({
            userId: member.userId,
            link,
            type: "triad_reminder",
            title: "Triad session tomorrow",
            titleVi: "Session triad diễn ra vào ngày mai",
            body: "You have a triad practice session scheduled for tomorrow.",
            bodyVi: "Bạn có một session luyện tập triad được đặt lịch vào ngày mai.",
            ctaLabel: "View triad",
            ctaLabelVi: "Xem triad",
          });
          if (sent) triadUpcomingSent++;
        }
      }
    }

    // ------------------------------------------------------------------
    // 4. Stale participants — THE canonical "inactive 7+ days" rule
    //    (canonical_enrollment_inactivity_internal: population, signals and
    //    window live there; Admin Alerts / Analytics read the same rule).
    //    One alert per enrollment, never re-raised while one is unresolved.
    // ------------------------------------------------------------------
    const { data: inactivity, error: inactivityErr } = await admin.rpc("canonical_enrollment_inactivity_internal", {});
    if (inactivityErr) console.error("Inactivity rule failed", inactivityErr);
    const inactive = ((inactivity || []) as { enrollment_id: string; user_id: string; is_inactive: boolean }[]).filter((r) => r.is_inactive);
    if (inactive.length > 0) {
      const { data: openAlerts } = await admin
        .from("admin_alerts")
        .select("related_enrollment_id")
        .eq("alert_type", "stale_programme_participant")
        .eq("resolved", false)
        .in("related_enrollment_id", inactive.map((r) => r.enrollment_id));
      const alreadyAlerted = new Set((openAlerts || []).map((r) => r.related_enrollment_id as string));
      const toAlert = inactive.filter((r) => !alreadyAlerted.has(r.enrollment_id));
      if (toAlert.length > 0) {
        const profiles = await getProfiles([...new Set(toAlert.map((r) => r.user_id))]);
        const rows = toAlert.map((r) => {
          const p = profiles.get(r.user_id);
          const name = p?.full_name || "A participant";
          const email = p?.email ? ` (${p.email})` : "";
          return {
            severity: "warning" as const,
            alert_type: "stale_programme_participant",
            title: `${name} — no programme activity in 7+ days`,
            message: `${name}${email} hasn't completed a training week, quiz, reflection, triad reflection, or daily prompt in over a week.`,
            related_coachee_id: r.user_id,
            related_enrollment_id: r.enrollment_id,
            resolved: false,
          };
        });
        const { error: alertErr } = await admin.from("admin_alerts").insert(rows);
        if (alertErr) {
          console.error("Failed to insert stale-participant alerts", alertErr);
        } else {
          staleAlerts = rows.length;
        }
      }
    }

    // ------------------------------------------------------------------
    // 5. Active triad groups with no open session (none yet, or the last
    //    one was completed / cancelled) whose members still owe required
    //    sessions — canonical completion (triad_cohort_learners_internal),
    //    never a local count.
    // ------------------------------------------------------------------
    const { data: activeGroups } = await admin
      .from("triad_groups")
      .select("id, cohort_id, triad_sessions(status, scheduled_start_time)")
      .eq("is_active", true);

    let triadUnscheduledSent = 0;
    const groupsWithoutOpenSession = ((activeGroups || []) as unknown as {
      id: string;
      cohort_id: string;
      triad_sessions: { status: string; scheduled_start_time: string | null }[];
    }[]).filter((g) => !(g.triad_sessions || []).some((s) => (s.status === "proposed" || s.status === "confirmed") && s.scheduled_start_time !== null));
    const owingEnrollments = new Set<string>();
    for (const cohortId of [...new Set(groupsWithoutOpenSession.map((g) => g.cohort_id))]) {
      const { data: learners, error: learnersErr } = await admin.rpc("triad_cohort_learners_internal", { p_cohort_id: cohortId });
      if (learnersErr) {
        console.error("Triad cohort learners failed", { cohortId, learnersErr });
        continue;
      }
      for (const l of (learners || []) as { enrollment_id: string; completed_units: number; required_units: number }[]) {
        if (l.completed_units < l.required_units) owingEnrollments.add(l.enrollment_id);
      }
    }
    const unscheduledGroupIds = groupsWithoutOpenSession.map((g) => g.id);
    if (unscheduledGroupIds.length > 0) {
      const membersByGroup = await triadMembersByGroup(unscheduledGroupIds);
      for (const groupId of unscheduledGroupIds) {
        for (const member of (membersByGroup.get(groupId) || []).filter((m) => owingEnrollments.has(m.enrollmentId))) {
          const sent = await notifyOnce({
            userId: member.userId,
            link: "/triads",
            type: "triad_reminder",
            title: "Schedule your triad session",
            titleVi: "Đặt lịch session triad của bạn",
            body: "Your triad group has no session scheduled and you still have required triad sessions to complete. Propose a time to your group.",
            bodyVi: "Nhóm triad của bạn chưa có session nào được lên lịch và bạn vẫn còn session triad bắt buộc cần hoàn thành. Hãy đề xuất thời gian cho nhóm.",
            ctaLabel: "Schedule session",
            ctaLabelVi: "Đặt lịch session",
          });
          if (sent) triadUnscheduledSent++;
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, overdueSent, triadReflectionSent, triadUpcomingSent, triadUnscheduledSent, staleAlerts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-programme-reminders failed", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
