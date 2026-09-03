import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/send-email.ts";
import { ProgrammeReminderEmail } from "../_shared/email-templates/programme-reminder.tsx";

// Phase 3 (programme management completion): the daily 09:00 sweep that
// covers the 4 reminder/alert kinds the task calls for. Triggered the same
// way send-daily-prompt is — an external cron (or pg_cron -> pg_net) POST
// with the CRON_SECRET shared secret, hence verify_jwt = false.
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

    // ------------------------------------------------------------------
    // 2. Missed triad reflections (sessions in the past 7 days)
    // ------------------------------------------------------------------
    const weekAgo = todayISO(-7);
    const today = todayISO();
    const { data: pastSessions } = await admin
      .from("triad_sessions")
      .select("id, coach_role_id, coachee_role_id, observer_role_id, session_date")
      .gte("session_date", weekAgo)
      .lt("session_date", today);

    if (pastSessions && pastSessions.length > 0) {
      const sessionIds = pastSessions.map((s) => s.id as string);
      const { data: reflections } = await admin
        .from("triad_reflections")
        .select("triad_session_id, participant_id")
        .in("triad_session_id", sessionIds);
      const submittedBySession = new Map<string, Set<string>>();
      for (const r of reflections || []) {
        const set = submittedBySession.get(r.triad_session_id as string) || new Set<string>();
        set.add(r.participant_id as string);
        submittedBySession.set(r.triad_session_id as string, set);
      }

      for (const s of pastSessions) {
        const roleHolders = [s.coach_role_id, s.coachee_role_id, s.observer_role_id] as string[];
        const submitted = submittedBySession.get(s.id as string) || new Set<string>();
        const missing = roleHolders.filter((id) => !submitted.has(id));
        const link = `/triads/${s.id}/reflect`;
        for (const userId of missing) {
          const sent = await notifyOnce({
            userId,
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
    const { data: upcomingSessions } = await admin
      .from("triad_sessions")
      .select("id, coach_role_id, coachee_role_id, observer_role_id")
      .eq("session_date", tomorrow)
      .neq("status", "cancelled");

    for (const s of upcomingSessions || []) {
      const roleHolders = [s.coach_role_id, s.coachee_role_id, s.observer_role_id] as string[];
      // Query-string suffix keeps this dedupe key per-session while still
      // landing the user on the real /triads route (query is ignored there).
      const link = `/triads?upcoming=${s.id}`;
      for (const userId of roleHolders) {
        const sent = await notifyOnce({
          userId,
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

    // ------------------------------------------------------------------
    // 4. Stale participants (no activity in the past 7 days)
    // ------------------------------------------------------------------
    const { data: activeEnrollments } = await admin
      .from("programme_enrollments")
      .select("user_id, start_date")
      .eq("status", "active")
      .lte("start_date", weekAgo); // skip anyone enrolled less than 7 days ago
    const activeUserIds = [...new Set((activeEnrollments || []).map((e) => e.user_id as string))];

    if (activeUserIds.length > 0) {
      const cutoffISO = new Date(Date.now() - 7 * DAY_MS).toISOString();
      const [{ data: subs }, { data: prompts }, { data: reflections }, { data: recentAlerts }] = await Promise.all([
        admin.from("assignment_submissions").select("user_id").in("user_id", activeUserIds).gte("submitted_at", cutoffISO),
        admin.from("daily_prompt_responses").select("user_id").in("user_id", activeUserIds).gte("responded_at", cutoffISO).not("responded_at", "is", null),
        admin.from("triad_reflections").select("participant_id").in("participant_id", activeUserIds).gte("submitted_at", cutoffISO),
        admin
          .from("admin_alerts")
          .select("related_coachee_id")
          .eq("alert_type", "stale_participant")
          .eq("resolved", false)
          .gte("created_at", cutoffISO),
      ]);

      const activeIds = new Set<string>([
        ...(subs || []).map((r) => r.user_id as string),
        ...(prompts || []).map((r) => r.user_id as string),
        ...(reflections || []).map((r) => r.participant_id as string),
      ]);
      const alreadyAlerted = new Set((recentAlerts || []).map((r) => r.related_coachee_id as string));

      const staleIds = activeUserIds.filter((id) => !activeIds.has(id) && !alreadyAlerted.has(id));
      if (staleIds.length > 0) {
        const profiles = await getProfiles(staleIds);
        const rows = staleIds.map((id) => {
          const p = profiles.get(id);
          const name = p?.full_name || "A participant";
          const email = p?.email ? ` (${p.email})` : "";
          return {
            severity: "warning" as const,
            alert_type: "stale_participant",
            title: `${name} — no activity in 7 days`,
            message: `${name}${email} hasn't submitted an assignment, responded to a daily prompt, or completed a triad reflection in the past 7 days.`,
            related_coachee_id: id,
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

    return new Response(
      JSON.stringify({ ok: true, overdueSent, triadReflectionSent, triadUpcomingSent, staleAlerts }),
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
