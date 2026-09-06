import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";

export interface TimelineWeek {
  id: string;
  weekNumber: number;
  title: string;
  titleVi: string | null;
  locked: boolean;
  viewedAt: string | null;
  completedAt: string | null;
  quiz: { total: number; submitted: number; scorePct: number | null };
  reflection: { total: number; submitted: number };
  promptStreak: { total: number; done: number };
  triadStatus: "completed" | "scheduled" | "not_scheduled" | null;
  status: "locked" | "current" | "available" | "completed";
}

interface RawWeek {
  id: string;
  week_number: number;
  title: string;
  title_vi: string | null;
  unlock_date: string | null;
  locked: boolean;
  viewed_at: string | null;
  completed_at: string | null;
}

interface RawTriadRound {
  id: string;
  training_week_id: string | null;
  triad_groups: {
    member_1_id: string;
    member_2_id: string;
    member_3_id: string | null;
    triad_sessions: { status: string; proposed_start_time: string | null; created_at: string }[];
  }[];
}

async function fetchTimeline(userId: string, hasTriads: boolean): Promise<TimelineWeek[]> {
  const { data: weeksData, error } = await supabase.rpc("get_my_training_weeks");
  if (error) throw error;
  const weeks = (weeksData || []) as RawWeek[];
  if (weeks.length === 0) return [];

  const weekIds = weeks.map((w) => w.id);
  const weekNumbers = weeks.map((w) => w.week_number);

  const [{ data: assignments }, { data: prompts }, { data: reflections }, { data: triadRounds }] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, training_week_id, assignment_type")
      .eq("is_visible", true)
      .eq("assignment_type", "quiz")
      .in("training_week_id", weekIds),
    supabase.from("daily_prompts").select("id, training_week_id").eq("is_visible", true).in("training_week_id", weekIds),
    // Reflections are a separate system keyed by appears_at_week, not an
    // assignment_type any more — RLS already scopes this to reflections for
    // programmes the user is enrolled in whose week has unlocked.
    supabase.from("programme_reflections").select("id, appears_at_week").in("appears_at_week", weekNumbers),
    // Triad rounds link to a training week directly; each round holds at
    // most one group (and one current session) for this user, found via
    // "Triad groups: member read" RLS.
    hasTriads
      ? supabase
          .from("triad_rounds")
          .select(
            "id, training_week_id, triad_groups(member_1_id, member_2_id, member_3_id, triad_sessions(status, proposed_start_time, created_at))",
          )
          .in("training_week_id", weekIds)
      : Promise.resolve({ data: [] as RawTriadRound[] }),
  ]);

  const assignmentIds = (assignments || []).map((a) => a.id as string);
  const promptIds = (prompts || []).map((p) => p.id as string);
  const reflectionIds = (reflections || []).map((r) => r.id as string);

  const [{ data: submissions }, { data: responses }, { data: reflectionSubs }] = await Promise.all([
    assignmentIds.length
      ? supabase.from("assignment_submissions").select("assignment_id, score_pct").eq("user_id", userId).in("assignment_id", assignmentIds)
      : Promise.resolve({ data: [] as { assignment_id: string; score_pct: number | null }[] }),
    promptIds.length
      ? supabase.from("daily_prompt_responses").select("daily_prompt_id, responded_at").eq("user_id", userId).in("daily_prompt_id", promptIds)
      : Promise.resolve({ data: [] as { daily_prompt_id: string; responded_at: string | null }[] }),
    reflectionIds.length
      ? supabase.from("reflection_submissions").select("reflection_id").eq("user_id", userId).in("reflection_id", reflectionIds)
      : Promise.resolve({ data: [] as { reflection_id: string }[] }),
  ]);

  const submissionByAssignment = new Map((submissions || []).map((s) => [s.assignment_id, s]));
  const respondedPromptIds = new Set((responses || []).filter((r) => r.responded_at).map((r) => r.daily_prompt_id));
  const submittedReflectionIds = new Set((reflectionSubs || []).map((r) => r.reflection_id));

  const today = new Date().toISOString().slice(0, 10);
  let currentAssigned = false;

  return weeks
    .sort((a, b) => a.week_number - b.week_number)
    .map((w): TimelineWeek => {
      const quizAssignments = (assignments || []).filter((a) => a.training_week_id === w.id);
      const quizSubmitted = quizAssignments.filter((a) => submissionByAssignment.has(a.id));
      const firstQuizScore = quizSubmitted.length > 0 ? submissionByAssignment.get(quizSubmitted[0].id)?.score_pct ?? null : null;

      const weekReflections = (reflections || []).filter((r) => r.appears_at_week === w.week_number);
      const reflectionSubmittedCount = weekReflections.filter((r) => submittedReflectionIds.has(r.id)).length;

      const weekPrompts = (prompts || []).filter((p) => p.training_week_id === w.id);
      const promptsDone = weekPrompts.filter((p) => respondedPromptIds.has(p.id)).length;

      let triadStatus: TimelineWeek["triadStatus"] = null;
      if (hasTriads) {
        const rounds = ((triadRounds || []) as RawTriadRound[]).filter((r) => r.training_week_id === w.id);
        const mySessions = rounds
          .flatMap((r) => r.triad_groups)
          .filter((g) => [g.member_1_id, g.member_2_id, g.member_3_id].includes(userId))
          .flatMap((g) => g.triad_sessions);
        if (mySessions.length === 0) triadStatus = "not_scheduled";
        else if (mySessions.some((s) => s.status === "completed" || (s.proposed_start_time && s.proposed_start_time < today)))
          triadStatus = "completed";
        else triadStatus = "scheduled";
      }

      let status: TimelineWeek["status"];
      if (w.locked) status = "locked";
      else if (w.completed_at) status = "completed";
      else if (!currentAssigned) {
        status = "current";
        currentAssigned = true;
      } else {
        status = "available";
      }

      return {
        id: w.id,
        weekNumber: w.week_number,
        title: w.title,
        titleVi: w.title_vi,
        locked: w.locked,
        viewedAt: w.viewed_at,
        completedAt: w.completed_at,
        quiz: { total: quizAssignments.length, submitted: quizSubmitted.length, scorePct: firstQuizScore },
        reflection: { total: weekReflections.length, submitted: reflectionSubmittedCount },
        promptStreak: { total: weekPrompts.length, done: promptsDone },
        triadStatus,
        status,
      };
    });
}

/**
 * Backs the "Programme timeline" section on CoacheeJourney/CoachMyJourney —
 * per-week progress across training (skill card, quiz, reflection, daily
 * prompt) plus, when the programme has the triads module, that week's triad
 * session status. Only meaningful when the user has the training module;
 * callers gate rendering on hasModule('training') themselves so this hook
 * doesn't need to duplicate that check to decide whether to run.
 */
export function useProgrammeTimeline(userId: string | undefined) {
  const { hasModule } = useProgrammeModules();
  const hasTriads = hasModule("triads");

  const { data, isLoading } = useQuery({
    queryKey: ["programme-timeline", userId, hasTriads],
    queryFn: () => fetchTimeline(userId as string, hasTriads),
    enabled: !!userId,
    staleTime: 30_000,
  });

  return { weeks: data ?? [], loading: isLoading };
}
