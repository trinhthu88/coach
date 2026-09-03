import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProgrammeOption {
  id: string;
  name: string;
}

export interface ProgrammeWeekEngagement {
  weekId: string;
  weekNumber: number;
  title: string;
  enrolledCount: number;
  completedCount: number;
  skillCardCompletionPct: number | null;
  quizAvgScore: number | null;
  quizCompletionPct: number | null;
  triadCompletionPct: number | null;
  promptResponseRate: number | null;
  avgConfidence: number | null;
}

export interface ProgrammeRedFlag {
  userId: string;
  fullName: string;
  daysSinceLastActivity: number | null;
}

export interface ConfidenceTrendPoint {
  weekNumber: number;
  cohortName: string;
  avgConfidence: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function useAdminProgrammes() {
  const [programmes, setProgrammes] = useState<ProgrammeOption[]>([]);
  useEffect(() => {
    supabase.from("programmes").select("id, name").order("name").then(({ data }) => setProgrammes(data ?? []));
  }, []);
  return programmes;
}

/**
 * Direct-table version of the sponsor_programme_engagement() /
 * sponsor_engagement_red_flags() SECURITY DEFINER functions, scoped to admin
 * instead of a sponsor's org — admin already has "view all" RLS on every
 * table touched here, so there's no need for a privilege-escalation-prone
 * server function the way the sponsor-facing equivalent needs one.
 */
export function useAdminProgrammeEngagement(programmeId: string | null) {
  const [weeks, setWeeks] = useState<ProgrammeWeekEngagement[]>([]);
  const [redFlags, setRedFlags] = useState<ProgrammeRedFlag[]>([]);
  const [confidenceTrend, setConfidenceTrend] = useState<ConfidenceTrendPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!programmeId) {
      setWeeks([]);
      setRedFlags([]);
      setConfidenceTrend([]);
      return;
    }
    let mounted = true;
    (async () => {
      setLoading(true);

      const [{ data: enrollments }, { data: cohorts }, { data: trainingWeeks }] = await Promise.all([
        supabase.from("programme_enrollments").select("user_id, cohort_id").eq("programme_id", programmeId).eq("status", "active"),
        supabase.from("cohorts").select("id, name").eq("programme_id", programmeId),
        supabase.from("training_weeks").select("id, week_number, title").eq("programme_id", programmeId).eq("is_visible", true).order("week_number"),
      ]);
      if (!mounted) return;

      const enrolledIds = [...new Set((enrollments ?? []).map((e) => e.user_id as string))];
      const cohortNameById = new Map((cohorts ?? []).map((c) => [c.id as string, c.name as string]));
      const cohortByUser = new Map((enrollments ?? []).map((e) => [e.user_id as string, e.cohort_id as string | null]));
      const weekIds = (trainingWeeks ?? []).map((w) => w.id as string);

      if (enrolledIds.length === 0 || weekIds.length === 0) {
        setWeeks([]);
        setRedFlags([]);
        setConfidenceTrend([]);
        setLoading(false);
        return;
      }

      const [{ data: progress }, { data: assignments }, { data: groups }, { data: profiles }] = await Promise.all([
        supabase.from("training_progress").select("user_id, training_week_id, completed_at").in("training_week_id", weekIds).in("user_id", enrolledIds),
        supabase.from("assignments").select("id, training_week_id, assignment_type").eq("is_visible", true).in("training_week_id", weekIds),
        supabase.from("triad_groups").select("id").eq("programme_id", programmeId).eq("is_active", true),
        supabase.from("profiles").select("id, full_name").in("id", enrolledIds),
      ]);
      if (!mounted) return;

      const quizAssignments = (assignments ?? []).filter((a) => a.assignment_type === "quiz");
      const quizAssignmentIds = quizAssignments.map((a) => a.id as string);
      const groupIds = (groups ?? []).map((g) => g.id as string);

      const [{ data: submissions }, { data: triadSessions }, { data: prompts }] = await Promise.all([
        quizAssignmentIds.length
          ? supabase.from("assignment_submissions").select("user_id, assignment_id, score_pct, submitted_at").in("assignment_id", quizAssignmentIds).in("user_id", enrolledIds)
          : Promise.resolve({ data: [] as { user_id: string; assignment_id: string; score_pct: number | null; submitted_at: string }[] }),
        groupIds.length
          ? supabase.from("triad_sessions").select("id, training_week_id").in("triad_group_id", groupIds)
          : Promise.resolve({ data: [] as { id: string; training_week_id: string | null }[] }),
        supabase.from("daily_prompts").select("id, training_week_id").in("training_week_id", weekIds),
      ]);
      if (!mounted) return;

      const sessionIds = (triadSessions ?? []).map((s) => s.id as string);
      const promptIds = (prompts ?? []).map((p) => p.id as string);

      const [{ data: reflections }, { data: promptResponses }] = await Promise.all([
        sessionIds.length
          ? supabase.from("triad_reflections").select("participant_id, triad_session_id, submitted_at").in("triad_session_id", sessionIds)
          : Promise.resolve({ data: [] as { participant_id: string; triad_session_id: string; submitted_at: string }[] }),
        promptIds.length
          ? supabase.from("daily_prompt_responses").select("user_id, daily_prompt_id, responded_at, confidence_score").in("daily_prompt_id", promptIds).in("user_id", enrolledIds)
          : Promise.resolve({ data: [] as { user_id: string; daily_prompt_id: string; responded_at: string | null; confidence_score: number | null }[] }),
      ]);
      if (!mounted) return;

      const promptToWeek = new Map((prompts ?? []).map((p) => [p.id as string, p.training_week_id as string]));
      const sessionToWeek = new Map((triadSessions ?? []).map((s) => [s.id as string, s.training_week_id as string | null]));
      const weekNumberById = new Map((trainingWeeks ?? []).map((w) => [w.id as string, w.week_number as number]));
      const enrolledCount = enrolledIds.length;

      const weeksOut: ProgrammeWeekEngagement[] = (trainingWeeks ?? []).map((w) => {
        const weekId = w.id as string;
        const completedUsers = new Set((progress ?? []).filter((p) => p.training_week_id === weekId && p.completed_at).map((p) => p.user_id));

        const weekQuizIds = new Set(quizAssignments.filter((a) => a.training_week_id === weekId).map((a) => a.id));
        const weekSubs = (submissions ?? []).filter((s) => weekQuizIds.has(s.assignment_id));
        const quizAvgScore = weekSubs.length > 0 ? weekSubs.reduce((sum, s) => sum + (s.score_pct ?? 0), 0) / weekSubs.length : null;
        const quizSubmittedUsers = new Set(weekSubs.map((s) => s.user_id));

        const weekSessionIds = new Set([...sessionToWeek.entries()].filter(([, tw]) => tw === weekId).map(([id]) => id));
        const weekReflectedUsers = new Set((reflections ?? []).filter((r) => weekSessionIds.has(r.triad_session_id)).map((r) => r.participant_id));

        const weekPromptIds = new Set([...promptToWeek.entries()].filter(([, tw]) => tw === weekId).map(([id]) => id));
        const weekResponses = (promptResponses ?? []).filter((r) => weekPromptIds.has(r.daily_prompt_id) && r.responded_at);
        const respondedUsers = new Set(weekResponses.map((r) => r.user_id));
        const confidenceScores = weekResponses.map((r) => r.confidence_score).filter((n): n is number => n != null);

        return {
          weekId,
          weekNumber: w.week_number as number,
          title: w.title as string,
          enrolledCount,
          completedCount: completedUsers.size,
          skillCardCompletionPct: enrolledCount > 0 ? (completedUsers.size * 100) / enrolledCount : null,
          quizAvgScore,
          quizCompletionPct: weekQuizIds.size > 0 && enrolledCount > 0 ? (quizSubmittedUsers.size * 100) / enrolledCount : null,
          triadCompletionPct: weekSessionIds.size > 0 && enrolledCount > 0 ? (weekReflectedUsers.size * 100) / enrolledCount : null,
          promptResponseRate: weekPromptIds.size > 0 && enrolledCount > 0 ? (respondedUsers.size * 100) / enrolledCount : null,
          avgConfidence: confidenceScores.length > 0 ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length : null,
        };
      });

      // Confidence trend, one line per cohort
      const cohortWeekScores = new Map<string, number[]>();
      (promptResponses ?? []).forEach((r) => {
        if (r.confidence_score == null || !r.responded_at) return;
        const weekId = promptToWeek.get(r.daily_prompt_id);
        const weekNumber = weekId ? weekNumberById.get(weekId) : undefined;
        if (weekNumber == null) return;
        const cohortId = cohortByUser.get(r.user_id) || "__none__";
        const key = `${cohortId} ${weekNumber}`;
        const arr = cohortWeekScores.get(key) ?? [];
        arr.push(r.confidence_score);
        cohortWeekScores.set(key, arr);
      });
      const trend: ConfidenceTrendPoint[] = [];
      cohortWeekScores.forEach((scores, key) => {
        const [cohortId, weekNumberStr] = key.split(" ");
        trend.push({
          weekNumber: Number(weekNumberStr),
          cohortName: cohortId === "__none__" ? "Unassigned" : cohortNameById.get(cohortId) || "Unassigned",
          avgConfidence: scores.reduce((a, b) => a + b, 0) / scores.length,
        });
      });
      trend.sort((a, b) => a.weekNumber - b.weekNumber);

      // Red flags: enrolled participants with no recorded activity in the
      // past 7 days (or ever) — same 4 signals send-programme-reminders
      // checks server-side, computed here client-side since admin already
      // has direct RLS access to every table involved.
      const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string | null]));
      const lastActiveByUser = new Map<string, number>();
      const bump = (userId: string, ts: string | null) => {
        if (!ts) return;
        const t = new Date(ts).getTime();
        if (!lastActiveByUser.has(userId) || t > (lastActiveByUser.get(userId) ?? 0)) lastActiveByUser.set(userId, t);
      };
      (progress ?? []).forEach((p) => bump(p.user_id as string, p.completed_at as string | null));
      (submissions ?? []).forEach((s) => bump(s.user_id, s.submitted_at));
      (reflections ?? []).forEach((r) => bump(r.participant_id, r.submitted_at));
      (promptResponses ?? []).forEach((r) => bump(r.user_id, r.responded_at));

      const cutoff = Date.now() - 7 * DAY_MS;
      const flags: ProgrammeRedFlag[] = enrolledIds
        .filter((id) => !lastActiveByUser.has(id) || (lastActiveByUser.get(id) ?? 0) < cutoff)
        .map((id) => ({
          userId: id,
          fullName: nameById.get(id) || "—",
          daysSinceLastActivity: lastActiveByUser.has(id) ? Math.floor((Date.now() - lastActiveByUser.get(id)!) / DAY_MS) : null,
        }))
        .sort((a, b) => (b.daysSinceLastActivity ?? 999) - (a.daysSinceLastActivity ?? 999));

      setWeeks(weeksOut);
      setRedFlags(flags);
      setConfidenceTrend(trend);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [programmeId]);

  return { weeks, redFlags, confidenceTrend, loading };
}
