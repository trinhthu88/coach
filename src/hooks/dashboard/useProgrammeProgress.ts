import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProgrammeProgressSummary {
  weeksCompleted: number;
  weeksTotal: number;
  quizScores: { weekNumber: number; scorePct: number }[];
  quizAvg: number | null;
  reflectionStreak: number;
  confidenceTrend: { label: string; score: number }[];
  triadCompletedCount: number;
  nextTriadDate: string | null;
}

interface RawWeek {
  id: string;
  week_number: number;
  unlock_date: string | null;
  completed_at: string | null;
}

const EMPTY: ProgrammeProgressSummary = {
  weeksCompleted: 0,
  weeksTotal: 0,
  quizScores: [],
  quizAvg: null,
  reflectionStreak: 0,
  confidenceTrend: [],
  triadCompletedCount: 0,
  nextTriadDate: null,
};

async function fetchProgress(userId: string): Promise<ProgrammeProgressSummary> {
  const { data: weeksData, error } = await supabase.rpc("get_my_training_weeks");
  if (error) throw error;
  const weeks = (weeksData || []) as RawWeek[];
  if (weeks.length === 0) return EMPTY;

  const weekIds = weeks.map((w) => w.id);
  const weekNumberById = new Map(weeks.map((w) => [w.id, w.week_number]));
  const weekUnlockById = new Map(weeks.map((w) => [w.id, w.unlock_date]));
  const weeksCompleted = weeks.filter((w) => w.completed_at).length;

  const [{ data: assignments }, { data: prompts }, { data: triadSessions }] = await Promise.all([
    supabase.from("assignments").select("id, training_week_id").eq("assignment_type", "quiz").eq("is_visible", true).in("training_week_id", weekIds),
    supabase.from("daily_prompts").select("id, training_week_id, day_number").in("training_week_id", weekIds),
    // RLS ("Triad sessions: members view own") already scopes this to just
    // the caller's own sessions, same pattern TriadDashboard.tsx relies on.
    supabase.from("triad_sessions").select("id, session_date, status"),
  ]);

  const assignmentIds = (assignments || []).map((a) => a.id as string);
  const promptIds = (prompts || []).map((p) => p.id as string);

  const [{ data: submissions }, { data: responses }] = await Promise.all([
    assignmentIds.length
      ? supabase.from("assignment_submissions").select("assignment_id, score_pct").eq("user_id", userId).in("assignment_id", assignmentIds)
      : Promise.resolve({ data: [] as { assignment_id: string; score_pct: number | null }[] }),
    promptIds.length
      ? supabase.from("daily_prompt_responses").select("daily_prompt_id, responded_at, confidence_score").eq("user_id", userId).in("daily_prompt_id", promptIds)
      : Promise.resolve({ data: [] as { daily_prompt_id: string; responded_at: string | null; confidence_score: number | null }[] }),
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

  // Only count prompts that have actually come due (unlock_date + day_number
  // - 1 <= today) — a future day's prompt with no response yet isn't a gap
  // in the streak, it just hasn't happened.
  const today = new Date().toISOString().slice(0, 10);
  const duePrompts = (prompts || [])
    .filter((p) => {
      const unlock = weekUnlockById.get(p.training_week_id as string);
      if (!unlock) return true;
      const due = new Date(`${unlock}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + (p.day_number - 1));
      return due.toISOString().slice(0, 10) <= today;
    })
    .sort((a, b) => {
      const wa = weekNumberById.get(a.training_week_id as string) ?? 0;
      const wb = weekNumberById.get(b.training_week_id as string) ?? 0;
      return wa !== wb ? wa - wb : a.day_number - b.day_number;
    });
  const responseByPrompt = new Map((responses || []).map((r) => [r.daily_prompt_id, r]));

  let reflectionStreak = 0;
  for (let i = duePrompts.length - 1; i >= 0; i--) {
    const r = responseByPrompt.get(duePrompts[i].id);
    if (r?.responded_at) reflectionStreak++;
    else break;
  }

  const confidenceTrend = duePrompts
    .map((p) => {
      const r = responseByPrompt.get(p.id);
      if (r?.confidence_score == null) return null;
      const weekNumber = weekNumberById.get(p.training_week_id as string) ?? 0;
      return { label: `W${weekNumber}D${p.day_number}`, score: r.confidence_score };
    })
    .filter((v): v is { label: string; score: number } => v != null);

  // Triads
  const now = Date.now();
  const sessions = (triadSessions || []) as { id: string; session_date: string; status: string }[];
  const triadCompletedCount = sessions.filter((s) => s.status !== "cancelled" && new Date(s.session_date).getTime() < now).length;
  const nextTriadDate =
    sessions
      .filter((s) => s.status !== "cancelled" && new Date(s.session_date).getTime() >= now)
      .sort((a, b) => new Date(a.session_date).getTime() - new Date(b.session_date).getTime())[0]?.session_date ?? null;

  return {
    weeksCompleted,
    weeksTotal: weeks.length,
    quizScores,
    quizAvg,
    reflectionStreak,
    confidenceTrend,
    triadCompletedCount,
    nextTriadDate,
  };
}

/**
 * Backs ProgrammeProgressCard on the coach/coachee dashboards. Callers gate
 * on hasModule('training') themselves (same convention as
 * useProgrammeTimeline / ThisWeekSkillCard) since get_my_training_weeks()
 * already returns nothing when that module is off — quiz/triad/daily_prompt
 * data is naturally empty too in that case since it all hangs off training
 * weeks the caller can't see.
 */
export function useProgrammeProgress(userId: string | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ["programme-progress", userId],
    queryFn: () => fetchProgress(userId as string),
    enabled: !!userId,
    staleTime: 30_000,
  });

  return { summary: data ?? EMPTY, loading: !!userId && isLoading };
}
