import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resolveCurrentEnrollment } from "@/lib/enrollmentResolver";

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
  /** Canonical Triad reflection rate for the week (admin_programme_triad_reflection_rate). Engagement only — never completion. */
  triadReflectionPct: number | null;
  promptResponseRate: number | null;
}

export interface ProgrammeRedFlag {
  userId: string;
  enrollmentId: string;
  fullName: string;
  daysSinceLastActivity: number | null;
}

export function useAdminProgrammes() {
  const [programmes, setProgrammes] = useState<ProgrammeOption[]>([]);
  useEffect(() => {
    supabase.from("programmes").select("id, name").order("name").then(({ data }) => setProgrammes(data ?? []));
  }, []);
  return programmes;
}

/**
 * Admin per-programme engagement. Per-week Training / quiz / prompt counts
 * are read from their tables; the Triad reflection rate and the red flags
 * ("inactive 7+ days") come from their one canonical calculation
 * (admin_programme_triad_reflection_rate, admin_enrollment_inactivity).
 */
export function useAdminProgrammeEngagement(programmeId: string | null) {
  const [weeks, setWeeks] = useState<ProgrammeWeekEngagement[]>([]);
  const [redFlags, setRedFlags] = useState<ProgrammeRedFlag[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!programmeId) {
      setWeeks([]);
      setRedFlags([]);
      return;
    }
    let mounted = true;
    (async () => {
      setLoading(true);

      // Engagement facts with one canonical calculation are read, never
      // recomputed here: the Triad reflection rate (per Training week) and
      // "inactive 7+ days" (the same rule the reminders and email use).
      const [{ data: enrollments }, { data: trainingWeeks }, { data: reflectionRate }, { data: inactivity }] = await Promise.all([
        supabase.from("programme_enrollments").select("id, user_id, status, start_date").eq("programme_id", programmeId),
        supabase.from("training_weeks").select("id, week_number, title").eq("programme_id", programmeId).eq("is_visible", true).order("week_number"),
        supabase.rpc("admin_programme_triad_reflection_rate", { p_programme_id: programmeId }),
        supabase.rpc("admin_enrollment_inactivity", { p_programme_id: programmeId }),
      ]);
      if (!mounted) return;

      const flags: ProgrammeRedFlag[] = (inactivity ?? [])
        .filter((row) => row.is_inactive)
        .map((row) => ({
          userId: row.user_id,
          enrollmentId: row.enrollment_id,
          fullName: row.full_name || "—",
          daysSinceLastActivity: row.days_since_last_activity,
        }))
        .sort((a, b) => (b.daysSinceLastActivity ?? 999) - (a.daysSinceLastActivity ?? 999));
      const triadRateByWeek = new Map(
        (reflectionRate ?? []).filter((row) => !row.is_total && row.training_week_id).map((row) => [row.training_week_id as string, row.rate_pct])
      );

      const currentByUser = new Map<string, string>();
      for (const userId of [...new Set((enrollments ?? []).map((e) => e.user_id as string))]) {
        const id = resolveCurrentEnrollment(
          (enrollments ?? []).filter((e) => e.user_id === userId).map((e) => ({
            id: e.id as string, status: e.status, start_date: e.start_date,
          })),
        );
        if (id) currentByUser.set(userId, id);
      }
      const enrollmentIds = [...currentByUser.values()];
      const enrolledIds = [...currentByUser.keys()];
      const weekIds = (trainingWeeks ?? []).map((w) => w.id as string);

      if (enrolledIds.length === 0 || weekIds.length === 0) {
        setWeeks([]);
        setRedFlags(flags);
        setLoading(false);
        return;
      }

      const [{ data: progress }, { data: assignments }] = await Promise.all([
        supabase.from("training_progress").select("user_id, enrollment_id, training_week_id, completed_at").in("training_week_id", weekIds).in("enrollment_id", enrollmentIds),
        supabase.from("assignments").select("id, training_week_id, assignment_type").eq("is_visible", true).in("training_week_id", weekIds),
      ]);
      if (!mounted) return;

      const quizAssignments = (assignments ?? []).filter((a) => a.assignment_type === "quiz");
      const quizAssignmentIds = quizAssignments.map((a) => a.id as string);

      const [{ data: submissions }, { data: prompts }] = await Promise.all([
        quizAssignmentIds.length
          ? supabase.from("assignment_submissions").select("user_id, enrollment_id, assignment_id, score_pct, submitted_at").in("assignment_id", quizAssignmentIds).in("enrollment_id", enrollmentIds)
          : Promise.resolve({ data: [] as { user_id: string; assignment_id: string; score_pct: number | null; submitted_at: string }[] }),
        supabase.from("daily_prompts").select("id, training_week_id").in("training_week_id", weekIds),
      ]);
      if (!mounted) return;

      const promptIds = (prompts ?? []).map((p) => p.id as string);
      const { data: promptResponses } = promptIds.length
        ? await supabase.from("daily_prompt_responses").select("user_id, enrollment_id, daily_prompt_id, responded_at").in("daily_prompt_id", promptIds).in("enrollment_id", enrollmentIds)
        : { data: [] as { user_id: string; daily_prompt_id: string; responded_at: string | null }[] };
      if (!mounted) return;

      const promptToWeek = new Map((prompts ?? []).map((p) => [p.id as string, p.training_week_id as string]));
      const enrolledCount = enrolledIds.length;

      const weeksOut: ProgrammeWeekEngagement[] = (trainingWeeks ?? []).map((w) => {
        const weekId = w.id as string;
        const completedUsers = new Set((progress ?? []).filter((p) => p.training_week_id === weekId && p.completed_at).map((p) => p.user_id));

        const weekQuizIds = new Set(quizAssignments.filter((a) => a.training_week_id === weekId).map((a) => a.id));
        const weekSubs = (submissions ?? []).filter((s) => weekQuizIds.has(s.assignment_id));
        const quizAvgScore = weekSubs.length > 0 ? weekSubs.reduce((sum, s) => sum + (s.score_pct ?? 0), 0) / weekSubs.length : null;
        const quizSubmittedUsers = new Set(weekSubs.map((s) => s.user_id));

        const weekPromptIds = new Set([...promptToWeek.entries()].filter(([, tw]) => tw === weekId).map(([id]) => id));
        const weekResponses = (promptResponses ?? []).filter((r) => weekPromptIds.has(r.daily_prompt_id) && r.responded_at);
        const respondedUsers = new Set(weekResponses.map((r) => r.user_id));

        return {
          weekId,
          weekNumber: w.week_number as number,
          title: w.title as string,
          enrolledCount,
          completedCount: completedUsers.size,
          skillCardCompletionPct: enrolledCount > 0 ? (completedUsers.size * 100) / enrolledCount : null,
          quizAvgScore,
          quizCompletionPct: weekQuizIds.size > 0 && enrolledCount > 0 ? (quizSubmittedUsers.size * 100) / enrolledCount : null,
          triadReflectionPct: triadRateByWeek.get(weekId) ?? null,
          promptResponseRate: weekPromptIds.size > 0 && enrolledCount > 0 ? (respondedUsers.size * 100) / enrolledCount : null,
        };
      });

      setWeeks(weeksOut);
      setRedFlags(flags);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [programmeId]);

  return { weeks, redFlags, loading };
}
