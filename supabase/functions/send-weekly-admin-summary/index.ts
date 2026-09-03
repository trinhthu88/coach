import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/send-email.ts";
import { WeeklyAdminSummaryEmail, type ProgrammeStatRow } from "../_shared/email-templates/weekly-admin-summary.tsx";

// Phase 3 (programme management completion): a weekly rollup emailed to
// every admin, triggered by an external cron (Monday 08:00) the same way
// send-daily-prompt / send-programme-reminders are — a POST with the
// CRON_SECRET shared secret, verify_jwt = false.
//
// Every stat here is computed fresh per run rather than read back from
// admin_alerts (which send-programme-reminders also writes to) — the two
// functions are on independent schedules and this one shouldn't depend on
// the daily job having just run.

const SITE_URL = "https://clariva.club";
const DAY_MS = 24 * 60 * 60 * 1000;

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
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

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);
    const weekAgoISO = weekAgo.toISOString();
    const twoWeeksAgoISO = twoWeeksAgo.toISOString();
    const weekOf = weekAgo.toISOString().slice(0, 10);

    // ------------------------------------------------------------------
    // Per-programme engagement
    // ------------------------------------------------------------------
    const { data: programmes } = await admin.from("programmes").select("id, name");
    const programmeStats: ProgrammeStatRow[] = [];

    for (const programme of programmes || []) {
      const { data: enrollments } = await admin
        .from("programme_enrollments")
        .select("user_id")
        .eq("programme_id", programme.id)
        .eq("status", "active");
      const enrolledIds = [...new Set((enrollments || []).map((e) => e.user_id as string))];
      if (enrolledIds.length === 0) continue;

      const { data: weeks } = await admin.from("training_weeks").select("id").eq("programme_id", programme.id);
      const weekIds = (weeks || []).map((w) => w.id as string);

      let quizCompletionPct: number | null = null;
      let reflectionCompletionPct: number | null = null;
      if (weekIds.length > 0) {
        const { data: assignments } = await admin
          .from("assignments")
          .select("id, assignment_type")
          .eq("is_visible", true)
          .in("training_week_id", weekIds);
        const quizAssignmentIds = (assignments || []).filter((a) => a.assignment_type === "quiz").map((a) => a.id as string);
        const reflectionAssignmentIds = (assignments || []).filter((a) => a.assignment_type === "reflection").map((a) => a.id as string);

        if (quizAssignmentIds.length > 0) {
          const { count } = await admin
            .from("assignment_submissions")
            .select("id", { count: "exact", head: true })
            .in("assignment_id", quizAssignmentIds)
            .in("user_id", enrolledIds);
          quizCompletionPct = ratio(count || 0, quizAssignmentIds.length * enrolledIds.length);
        }
        if (reflectionAssignmentIds.length > 0) {
          const { count } = await admin
            .from("assignment_submissions")
            .select("id", { count: "exact", head: true })
            .in("assignment_id", reflectionAssignmentIds)
            .in("user_id", enrolledIds);
          reflectionCompletionPct = ratio(count || 0, reflectionAssignmentIds.length * enrolledIds.length);
        }
      }

      const { data: groups } = await admin.from("triad_groups").select("id").eq("programme_id", programme.id).eq("is_active", true);
      const groupIds = (groups || []).map((g) => g.id as string);
      let triadCompletionPct: number | null = null;
      if (groupIds.length > 0) {
        const { data: sessions } = await admin
          .from("triad_sessions")
          .select("id")
          .in("triad_group_id", groupIds)
          .gte("session_date", weekAgoISO.slice(0, 10));
        const sessionIds = (sessions || []).map((s) => s.id as string);
        if (sessionIds.length > 0) {
          const { count } = await admin
            .from("triad_reflections")
            .select("id", { count: "exact", head: true })
            .in("triad_session_id", sessionIds);
          triadCompletionPct = ratio(count || 0, sessionIds.length * 3);
        }
      }

      let promptResponseRatePct: number | null = null;
      if (weekIds.length > 0) {
        const { data: prompts } = await admin.from("daily_prompts").select("id").in("training_week_id", weekIds);
        const promptIds = (prompts || []).map((p) => p.id as string);
        if (promptIds.length > 0) {
          const [{ count: opened }, { count: responded }] = await Promise.all([
            admin
              .from("daily_prompt_responses")
              .select("id", { count: "exact", head: true })
              .in("daily_prompt_id", promptIds)
              .in("user_id", enrolledIds)
              .gte("created_at", weekAgoISO),
            admin
              .from("daily_prompt_responses")
              .select("id", { count: "exact", head: true })
              .in("daily_prompt_id", promptIds)
              .in("user_id", enrolledIds)
              .not("responded_at", "is", null)
              .gte("created_at", weekAgoISO),
          ]);
          promptResponseRatePct = ratio(responded || 0, opened || 0);
        }
      }

      programmeStats.push({
        programmeName: programme.name as string,
        enrolledCount: enrolledIds.length,
        quizCompletionPct,
        reflectionCompletionPct,
        triadCompletionPct,
        promptResponseRatePct,
      });
    }

    // ------------------------------------------------------------------
    // Red flags (reuses the same admin_alerts rows send-programme-reminders
    // writes — this just reports on them rather than recomputing them)
    // ------------------------------------------------------------------
    const { data: staleAlerts } = await admin
      .from("admin_alerts")
      .select("related_coachee_id")
      .eq("alert_type", "stale_participant")
      .eq("resolved", false)
      .gte("created_at", weekAgoISO);
    const staleIds = [...new Set((staleAlerts || []).map((a) => a.related_coachee_id as string).filter(Boolean))];
    let redFlagNames: string[] = [];
    if (staleIds.length > 0) {
      const { data: staleProfiles } = await admin.from("profiles").select("full_name").in("id", staleIds.slice(0, 20));
      redFlagNames = (staleProfiles || []).map((p) => p.full_name as string).filter(Boolean);
    }

    // ------------------------------------------------------------------
    // Confidence trend
    // ------------------------------------------------------------------
    const [{ data: thisWeekScores }, { data: lastWeekScores }] = await Promise.all([
      admin.from("daily_prompt_responses").select("confidence_score").gte("responded_at", weekAgoISO).not("confidence_score", "is", null),
      admin
        .from("daily_prompt_responses")
        .select("confidence_score")
        .gte("responded_at", twoWeeksAgoISO)
        .lt("responded_at", weekAgoISO)
        .not("confidence_score", "is", null),
    ]);
    const avg = (rows: { confidence_score: number | null }[] | null) => {
      const scores = (rows || []).map((r) => r.confidence_score as number).filter((n) => n != null);
      return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    };
    const confidenceThisWeek = avg(thisWeekScores);
    const confidenceLastWeek = avg(lastWeekScores);

    // ------------------------------------------------------------------
    // Top reflection quotes (anonymized — text only, no participant name)
    // ------------------------------------------------------------------
    const { data: recentReflections } = await admin
      .from("assignment_submissions")
      .select("reflection_text")
      .not("reflection_text", "is", null)
      .gte("submitted_at", weekAgoISO)
      .order("submitted_at", { ascending: false })
      .limit(20);
    const topQuotes = (recentReflections || [])
      .map((r) => (r.reflection_text as string)?.trim())
      .filter((t): t is string => !!t && t.length > 0)
      .slice(0, 3)
      .map((t) => (t.length > 220 ? `${t.slice(0, 220)}…` : t));

    // ------------------------------------------------------------------
    // Send to every admin
    // ------------------------------------------------------------------
    const { data: adminRoles } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const adminIds = [...new Set((adminRoles || []).map((r) => r.user_id as string))];
    const { data: adminProfiles } = adminIds.length
      ? await admin.from("profiles").select("id, email, full_name").in("id", adminIds)
      : { data: [] };

    let sent = 0;
    for (const profile of adminProfiles || []) {
      if (!profile.email) continue;
      const props = {
        weekOf,
        programmeStats,
        redFlagNames,
        redFlagTotal: staleIds.length,
        confidenceThisWeek,
        confidenceLastWeek,
        topQuotes,
        dashboardUrl: `${SITE_URL}/admin`,
      };
      const html = await renderAsync(React.createElement(WeeklyAdminSummaryEmail, props));
      const text = await renderAsync(React.createElement(WeeklyAdminSummaryEmail, props), { plainText: true });
      const result = await sendEmail({
        to: profile.email,
        subject: `Weekly programme summary — ${weekOf}`,
        html,
        text,
      });
      if (result.ok) sent++;
      else console.error("Failed to send weekly admin summary", { error: result.error, email: profile.email });
    }

    return new Response(JSON.stringify({ ok: true, sent, programmeCount: programmeStats.length, redFlagCount: staleIds.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-weekly-admin-summary failed", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
