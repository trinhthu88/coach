import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { fetchMyTriadStatus, fetchMyTriads, type TriadGroupEntry, type TriadStatusView } from "@/hooks/triads/useMyTriads";

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

async function fetchTimeline(userId: string, enrollmentId: string, hasTriads: boolean): Promise<TimelineWeek[]> {
  const { data: weeksData, error } = await supabase.rpc("get_enrollment_training_weeks", {
    p_enrollment_id: enrollmentId,
  });
  if (error) throw error;
  const weeks = (weeksData || []) as RawWeek[];
  if (weeks.length === 0) return [];

  // Per-week counts are the server's: learner_training_week_items (the same
  // rows the Training page renders) and the quiz score from
  // learner_training_summary (20261007001100). Nothing is counted here.
  const [{ data: items, error: itemsError }, { data: summaryRows, error: summaryError }, triadGroups, triadCanonical] = await Promise.all([
    supabase.rpc("learner_training_week_items", { p_enrollment_id: enrollmentId }),
    supabase.rpc("learner_training_summary", { p_enrollment_id: enrollmentId }),
    // The learner's cohort Triad groups and canonical Triad status. A week
    // shows a Triad state only when a cohort Triad deadline is linked to it.
    hasTriads ? fetchMyTriads(enrollmentId) : Promise.resolve([] as TriadGroupEntry[]),
    hasTriads ? fetchMyTriadStatus(enrollmentId) : Promise.resolve(null as TriadStatusView | null),
  ]);
  if (itemsError) throw itemsError;
  if (summaryError) throw summaryError;
  const itemOf = (weekId: string, type: string) =>
    (items ?? []).find((i) => i.training_week_id === weekId && i.item_type === type) ?? null;
  const scoreByWeek = new Map(
    ((summaryRows?.[0]?.quiz_scores as { week_number: number; score_pct: number }[] | null) ?? []).map((q) => [q.week_number, Number(q.score_pct)]),
  );

  let currentAssigned = false;

  return weeks
    .sort((a, b) => a.week_number - b.week_number)
    .map((w): TimelineWeek => {
      const quiz = itemOf(w.id, "quizzes");
      const reflection = itemOf(w.id, "reflections");
      const prompts = itemOf(w.id, "daily_prompts");

      // A week's Triad deadline is met when the canonical completed sessions
      // reach that cumulative milestone (the same rule Admin and the Triads
      // page show) — never a local reading of session statuses, never a
      // session assigned to the week.
      let triadStatus: TimelineWeek["triadStatus"] = null;
      const weekMilestones = triadCanonical?.schedule.filter((m) => m.trainingWeekId === w.id) ?? [];
      if (hasTriads && weekMilestones.length > 0) {
        const activeGroup = triadGroups.find((g) => g.isActive);
        const hasOpenSession = !!activeGroup?.sessions.some((s) => s.status === "proposed" || s.status === "confirmed");
        if (weekMilestones.every((m) => m.satisfied)) triadStatus = "completed";
        else if (hasOpenSession) triadStatus = "scheduled";
        else triadStatus = "not_scheduled";
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
        quiz: { total: quiz?.required_units ?? 0, submitted: quiz?.completed_units ?? 0, scorePct: scoreByWeek.get(w.week_number) ?? null },
        reflection: { total: reflection?.required_units ?? 0, submitted: reflection?.completed_units ?? 0 },
        promptStreak: { total: prompts?.required_units ?? 0, done: prompts?.completed_units ?? 0 },
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
  const { hasModule, enrollmentId } = useProgrammeModules();
  const { selectedEnrollment } = useEnrollmentContext(userId);
  const hasTriads = hasModule("triads");
  const selectedId = selectedEnrollment?.id ?? enrollmentId;

  const { data, isLoading } = useQuery({
    queryKey: ["programme-timeline", userId, selectedId ?? null, hasTriads],
    queryFn: () => fetchTimeline(userId as string, selectedId as string, hasTriads),
    enabled: !!userId && !!selectedId,
    staleTime: 30_000,
  });

  return { weeks: data ?? [], loading: isLoading };
}

