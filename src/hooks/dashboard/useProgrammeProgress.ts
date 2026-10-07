import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";

export interface ProgrammeProgressSummary {
  weeksTotal: number;
  quizScores: { weekNumber: number; scorePct: number }[];
  quizAvg: number | null;
  reflectionStreak: number;
  /** Full week list (in order), for the timeline/segment display — same rows
   * get_my_training_weeks() already returned, just not previously exposed. */
  weeks: RawWeek[];
  /** Earliest unlocked, not-yet-completed week; falls back to the most
   * recently unlocked week once everything unlocked is done. */
  currentWeek: RawWeek | null;
  /** The current week's quiz assignment id, if it has one — for the
   * "Take quiz" action button. Null once no quiz module or no quiz that week. */
  currentQuizAssignmentId: string | null;
  /** Each week's visible quiz assignment id (week id → assignment id), so
   * every unlocked week — not just the current one — can link to its quiz. */
  quizAssignmentIdByWeek: Record<string, string>;
  /** Child learning evidence per week (learner_training_week_items → canonical_learning_items). */
  itemsByWeek: Record<string, TrainingWeekItem[]>;
}

export interface TrainingWeekItem {
  item_type: "skill_cards" | "quizzes" | "reflections" | "daily_prompts" | string;
  required_units: number;
  completed_units: number;
  due_units: number;
  overdue_units: number;
}

export interface RawWeek {
  id: string;
  week_number: number;
  title: string;
  title_vi: string | null;
  subtitle: string | null;
  subtitle_vi: string | null;
  unlock_date: string | null;
  /** Cohort-relative unlock date (override, then cohort start + week offset,
   *  then the flat unlock_date fallback) — get_my_training_weeks() already
   *  computes this server-side; prefer it over unlock_date for display and
   *  for any "is this due yet" timing math, never recompute the fallback
   *  chain here. */
  effective_unlock_date: string | null;
  locked: boolean;
  viewed_at: string | null;
  completed_at: string | null;
  /** The week's canonical Training requirement (cohort date) and its state. */
  requirement_id?: string | null;
  requirement_due_on?: string | null;
  requirement_state?: "completed" | "completed_late" | "current" | "overdue" | "upcoming" | "not_required" | string | null;
}

const EMPTY: ProgrammeProgressSummary = {
  weeksTotal: 0,
  quizScores: [],
  quizAvg: null,
  reflectionStreak: 0,
  weeks: [],
  currentWeek: null,
  currentQuizAssignmentId: null,
  quizAssignmentIdByWeek: {},
  itemsByWeek: {},
};

async function fetchProgress(enrollmentId: string): Promise<ProgrammeProgressSummary> {
  const { data: weeksData, error } = await supabase.rpc("get_enrollment_training_weeks", { p_enrollment_id: enrollmentId });
  if (error) throw error;
  const weeks = (weeksData || []) as RawWeek[];
  if (weeks.length === 0) return EMPTY;

  const weekIds = weeks.map((w) => w.id);

  // Quiz scores, their average and the Daily Prompt streak are the server's
  // (learner_training_summary, 20261007001100, in programme_today()); the
  // quiz assignments are read only to link each week to its quiz.
  const [{ data: assignments }, { data: weekItems, error: itemsError }, { data: summaryRows, error: summaryError }] = await Promise.all([
    supabase.from("assignments").select("id, training_week_id").eq("assignment_type", "quiz").eq("is_visible", true).in("training_week_id", weekIds),
    supabase.rpc("learner_training_week_items", { p_enrollment_id: enrollmentId }),
    supabase.rpc("learner_training_summary", { p_enrollment_id: enrollmentId }),
  ]);
  if (itemsError) throw itemsError;
  if (summaryError) throw summaryError;
  const itemsByWeek: Record<string, TrainingWeekItem[]> = {};
  const ITEM_ORDER = ["skill_cards", "quizzes", "reflections", "daily_prompts"];
  for (const item of weekItems ?? []) {
    (itemsByWeek[item.training_week_id] ??= []).push(item);
  }
  for (const list of Object.values(itemsByWeek)) {
    list.sort((a, b) => ITEM_ORDER.indexOf(a.item_type) - ITEM_ORDER.indexOf(b.item_type));
  }

  const summary = summaryRows?.[0];
  const quizScores = ((summary?.quiz_scores as { week_number: number; score_pct: number }[] | null) ?? []).map((q) => ({
    weekNumber: q.week_number,
    scorePct: Number(q.score_pct),
  }));
  const quizAvg = summary?.quiz_avg == null ? null : Number(summary.quiz_avg);
  const reflectionStreak = summary?.reflection_streak ?? 0;

  const currentWeek =
    weeks.find((w) => !w.locked && !w.completed_at) ?? [...weeks].reverse().find((w) => !w.locked) ?? null;
  const quizAssignmentIdByWeek: Record<string, string> = {};
  for (const a of assignments || []) {
    if (a.training_week_id && !quizAssignmentIdByWeek[a.training_week_id]) quizAssignmentIdByWeek[a.training_week_id] = a.id;
  }
  const currentQuizAssignmentId = (currentWeek && quizAssignmentIdByWeek[currentWeek.id]) || null;

  return {
    weeksTotal: weeks.length,
    quizScores,
    quizAvg,
    reflectionStreak,
    weeks,
    currentWeek,
    currentQuizAssignmentId,
    quizAssignmentIdByWeek,
    itemsByWeek,
  };
}

/**
 * Provides learner-only training shortcuts for the selected enrollment:
 * which week/quiz to link to next, and quiz-score/reflection-streak detail
 * that Sponsor doesn't track at this granularity. Required/completed counts,
 * pace, and overall progress are NOT computed here — those are shared facts
 * and come from useLearnerCanonicalProgress (same engine as Sponsor Leader
 * Detail). Triad completion used to be duplicated here too (an unscoped,
 * uncapped count of triad_sessions rows); it was removed because it could
 * disagree with the canonical triad module count and nothing rendered it.
 */
export function useProgrammeProgress(userId: string | undefined, initialEnrollmentId?: string | null) {
  const context = useEnrollmentContext(userId, initialEnrollmentId);
  const enrollmentId = context.selectedEnrollment?.id;
  const { data, isLoading } = useQuery({
    queryKey: ["programme-training-progress", enrollmentId],
    queryFn: () => fetchProgress(enrollmentId as string),
    enabled: !!userId && !!enrollmentId,
    staleTime: 30_000,
  });

  return { enrollmentId, summary: data ?? EMPTY, loading: context.loading || (!!enrollmentId && isLoading) };
}
