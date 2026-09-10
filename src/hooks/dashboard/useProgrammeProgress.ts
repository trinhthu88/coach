import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";

export interface ProgrammeProgressSummary {
  weeksCompleted: number;
  weeksTotal: number;
  quizScores: { weekNumber: number; scorePct: number }[];
  quizAvg: number | null;
  reflectionStreak: number;
  triadCompletedCount: number;
  nextTriadDate: string | null;
  /** Full week list (in order), for the timeline/segment display — same rows
   * get_my_training_weeks() already returned, just not previously exposed. */
  weeks: RawWeek[];
  /** Earliest unlocked, not-yet-completed week; falls back to the most
   * recently unlocked week once everything unlocked is done. */
  currentWeek: RawWeek | null;
  /** The current week's quiz assignment id, if it has one — for the
   * "Take quiz" action button. Null once no quiz module or no quiz that week. */
  currentQuizAssignmentId: string | null;
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
}

const EMPTY: ProgrammeProgressSummary = {
  weeksCompleted: 0,
  weeksTotal: 0,
  quizScores: [],
  quizAvg: null,
  reflectionStreak: 0,
  triadCompletedCount: 0,
  nextTriadDate: null,
  weeks: [],
  currentWeek: null,
  currentQuizAssignmentId: null,
};

async function fetchProgress(enrollmentId: string): Promise<ProgrammeProgressSummary> {
  const [{ data: weeksData, error }, { data: triadSessions }] = await Promise.all([
    supabase.rpc("get_enrollment_training_weeks", { p_enrollment_id: enrollmentId }),
    supabase.from("triad_sessions").select("id, proposed_start_time, status").or(`coach_enrollment_id.eq.${enrollmentId},coachee_enrollment_id.eq.${enrollmentId},observer_enrollment_id.eq.${enrollmentId}`),
  ]);
  if (error) throw error;
  const weeks = (weeksData || []) as RawWeek[];
  if (weeks.length === 0) return EMPTY;

  const weekIds = weeks.map((w) => w.id);
  const weekNumberById = new Map(weeks.map((w) => [w.id, w.week_number]));
  const weekUnlockById = new Map(weeks.map((w) => [w.id, w.effective_unlock_date]));
  const weeksCompleted = weeks.filter((w) => w.completed_at).length;

  const [{ data: assignments }, { data: prompts }] = await Promise.all([
    supabase.from("assignments").select("id, training_week_id").eq("assignment_type", "quiz").eq("is_visible", true).in("training_week_id", weekIds),
    supabase.from("daily_prompts").select("id, training_week_id, day_offset").in("training_week_id", weekIds),
  ]);

  const assignmentIds = (assignments || []).map((a) => a.id as string);
  const promptIds = (prompts || []).map((p) => p.id as string);

  const [{ data: submissions }, { data: responses }] = await Promise.all([
    assignmentIds.length
      ? supabase.from("assignment_submissions").select("assignment_id, score_pct").eq("enrollment_id", enrollmentId).in("assignment_id", assignmentIds)
      : Promise.resolve({ data: [] as { assignment_id: string; score_pct: number | null }[] }),
    promptIds.length
      ? supabase.from("daily_prompt_responses").select("daily_prompt_id, responded_at").eq("enrollment_id", enrollmentId).in("daily_prompt_id", promptIds)
      : Promise.resolve({ data: [] as { daily_prompt_id: string; responded_at: string | null }[] }),
  ]);

  // Quiz scores per week
  const submissionByAssignment = new Map((submissions || []).map((s) => [s.assignment_id, s]));
  const quizScores = (assignments || [])
    .map((a) => {
      const sub = submissionByAssignment.get(a.id);
      if (!sub || sub.score_pct == null) return null;
      return { weekNumber: weekNumberById.get(a.training_week_id) ?? 0, scorePct: sub.score_pct };
    })
    .filter((v): v is { weekNumber: number; scorePct: number } => v != null)
    .sort((a, b) => a.weekNumber - b.weekNumber);
  const quizAvg = quizScores.length > 0 ? quizScores.reduce((s, q) => s + q.scorePct, 0) / quizScores.length : null;

  // Only count prompts that have actually come due (unlock_date + day_offset
  // - 1 <= today) — a future day's prompt with no response yet isn't a gap
  // in the streak, it just hasn't happened. A null day_offset ("any day this
  // week") is due as soon as the week unlocks, same as day 1.
  const today = new Date().toISOString().slice(0, 10);
  const duePrompts = (prompts || [])
    .filter((p) => {
      const unlock = weekUnlockById.get(p.training_week_id as string);
      if (!unlock) return true;
      const due = new Date(`${unlock}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + ((p.day_offset ?? 1) - 1));
      return due.toISOString().slice(0, 10) <= today;
    })
    .sort((a, b) => {
      const wa = weekNumberById.get(a.training_week_id as string) ?? 0;
      const wb = weekNumberById.get(b.training_week_id as string) ?? 0;
      return wa !== wb ? wa - wb : (a.day_offset ?? 1) - (b.day_offset ?? 1);
    });
  const responseByPrompt = new Map((responses || []).map((r) => [r.daily_prompt_id, r]));

  let reflectionStreak = 0;
  for (let i = duePrompts.length - 1; i >= 0; i--) {
    const r = responseByPrompt.get(duePrompts[i].id);
    if (r?.responded_at) reflectionStreak++;
    else break;
  }

  // Triads
  const now = Date.now();
  const sessions = (triadSessions || []) as { id: string; proposed_start_time: string | null; status: string }[];
  const triadCompletedCount = sessions.filter((s) => s.status === "completed").length;
  const nextTriadDate =
    sessions
      .filter((s) => s.status === "confirmed" && s.proposed_start_time && new Date(s.proposed_start_time).getTime() >= now)
      .sort((a, b) => new Date(a.proposed_start_time!).getTime() - new Date(b.proposed_start_time!).getTime())[0]?.proposed_start_time ?? null;

  const currentWeek =
    weeks.find((w) => !w.locked && !w.completed_at) ?? [...weeks].reverse().find((w) => !w.locked) ?? null;
  const currentQuizAssignmentId =
    (currentWeek && (assignments || []).find((a) => a.training_week_id === currentWeek.id)?.id) || null;

  return {
    weeksCompleted,
    weeksTotal: weeks.length,
    quizScores,
    quizAvg,
    reflectionStreak,
    triadCompletedCount,
    nextTriadDate,
    weeks,
    currentWeek,
    currentQuizAssignmentId,
  };
}

/**
 * Provides learner-only training shortcuts for the selected enrollment.
 * Authoritative module completion and pace come from useEnrollmentProgress.
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
