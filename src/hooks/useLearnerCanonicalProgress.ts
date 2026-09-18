import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  EMPTY_ENGAGEMENT,
  EMPTY_PROGRAMME_EXPERIENCE,
  parseProgrammeExperience,
  parseProgrammeJourney,
  type ProgrammeEngagementFacts,
  type ProgrammeExperience,
  type ProgrammeJourneyPoint,
  type ProgrammeLearningItem,
  type ProgrammeWeeklyParticipation,
} from "@/lib/programmeProfile";

/**
 * The learner's own mirror of useSponsorLeaderData: same primitives
 * (canonical_module_progress / sponsor_canonical_module_schedule /
 * sponsor_canonical_activity / canonical_enrollment_engagement) behind
 * learner_canonical_* instead of sponsor_canonical_*, self-authorized
 * instead of sponsor-authorized. Every shared fact this hook returns
 * (programme/cohort dates, required and completed units per module, overall
 * progress, pace, journey checkpoints, goal/action/rating summary) is
 * computed by the exact same engine Sponsor Leader Detail reads, and parsed
 * by the same functions (src/lib/programmeProfile.ts), so a learner and
 * their sponsor can never see two different answers for the same
 * enrollment. Do not add a second, independently-calculated version of any
 * of these fields elsewhere in the learner UI — extend this hook.
 */

export type LearnerModuleProgress =
  Database["public"]["Functions"]["learner_canonical_module_progress"]["Returns"][number];

export type LearnerCanonicalProgress =
  Database["public"]["Functions"]["learner_canonical_progress"]["Returns"][number];

export type LearnerJourneyPoint = ProgrammeJourneyPoint;
export type LearnerWeeklyParticipation = ProgrammeWeeklyParticipation;
export type LearnerLearningItem = ProgrammeLearningItem;
export type LearnerExperience = ProgrammeExperience;

export interface LearnerCanonicalData {
  progress: LearnerCanonicalProgress | null;
  modules: LearnerModuleProgress[];
  journey: LearnerJourneyPoint[];
  experience: LearnerExperience;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

async function fetchLearnerCanonical(enrollmentId: string, asOf?: string) {
  const args = asOf ? { p_enrollment_id: enrollmentId, p_as_of: asOf } : { p_enrollment_id: enrollmentId };
  const [progressRes, modulesRes, journeyRes, experienceRes] = await Promise.all([
    supabase.rpc("learner_canonical_progress", args),
    supabase.rpc("learner_canonical_module_progress", args),
    supabase.rpc("learner_canonical_journey", args),
    supabase.rpc("learner_canonical_experience", args),
  ]);
  const failure = progressRes.error ?? modulesRes.error ?? journeyRes.error ?? experienceRes.error;
  if (failure) {
    console.error("Learner canonical progress failed to load", {
      enrollmentId,
      progressError: progressRes.error,
      modulesError: modulesRes.error,
      journeyError: journeyRes.error,
      experienceError: experienceRes.error,
    });
    throw failure;
  }

  return {
    progress: (progressRes.data?.[0] as LearnerCanonicalProgress | undefined) ?? null,
    modules: (modulesRes.data ?? []) as LearnerModuleProgress[],
    journey: parseProgrammeJourney(journeyRes.data),
    experience: parseProgrammeExperience(experienceRes.data),
  };
}

function errorMessage(error: unknown) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

/**
 * Canonical self-view for the signed-in learner's own enrollment: overall +
 * per-module progress, programme journey checkpoints, and the learning
 * breakdown (skill cards / quizzes / reflections / daily prompts). All four
 * values come from the same schedule + activity engine as Sponsor Leader
 * Detail — nothing here is recomputed client-side.
 */
export function useLearnerCanonicalProgress(enrollmentId: string | undefined, asOf?: string): LearnerCanonicalData {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["learner-canonical-progress", enrollmentId ?? null, asOf ?? null],
    queryFn: () => fetchLearnerCanonical(enrollmentId as string, asOf),
    enabled: !!enrollmentId,
    staleTime: 30_000,
  });

  return {
    progress: data?.progress ?? null,
    modules: data?.modules ?? [],
    journey: data?.journey ?? [],
    experience: data?.experience ?? EMPTY_PROGRAMME_EXPERIENCE,
    loading: !!enrollmentId && isLoading,
    error: errorMessage(error),
    retry: () => void refetch(),
  };
}

/**
 * Goals / actions / programme-experience summary for the learner's own
 * enrollment — learner_canonical_engagement reads the same
 * canonical_enrollment_engagement definition Sponsor's metadata reads, so
 * "Goal progress", "Actions completed" and "Programme experience" match the
 * sponsor's numbers exactly. Kept as its own query so a failure here shows
 * an honest error on those cards without blanking programme progress.
 */
export function useLearnerCanonicalEngagement(enrollmentId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["learner-canonical-engagement", enrollmentId ?? null],
    queryFn: async (): Promise<ProgrammeEngagementFacts> => {
      const { data: rows, error: rpcError } = await supabase.rpc("learner_canonical_engagement", {
        p_enrollment_id: enrollmentId as string,
      });
      if (rpcError) {
        console.error("Learner engagement summary failed to load", { enrollmentId, rpcError });
        throw rpcError;
      }
      const row = rows?.[0];
      return row
        ? {
            goal_count: row.goal_count,
            goal_progress_pct: row.goal_progress_pct,
            open_action_count: row.open_action_count,
            completed_action_count: row.completed_action_count,
            total_action_count: row.total_action_count,
            satisfaction_avg: row.satisfaction_avg,
            satisfaction_rated_count: row.satisfaction_rated_count,
          }
        : EMPTY_ENGAGEMENT;
    },
    enabled: !!enrollmentId,
    staleTime: 30_000,
  });

  return {
    engagement: data ?? EMPTY_ENGAGEMENT,
    loading: !!enrollmentId && isLoading,
    error: errorMessage(error),
  };
}

/** Query keys whose canonical values change when the learner edits goals/ratings/actions. */
export const LEARNER_ENGAGEMENT_QUERY_KEYS = [["learner-canonical-engagement"], ["learner-canonical-goal-progress"]] as const;

/**
 * Per-goal progress for the learner's own enrollment —
 * learner_canonical_goal_progress reads canonical_goal_progress, the same
 * rows canonical_enrollment_engagement averages into "Goal progress". The UI
 * renders these values; it never recalculates Start→Target progress.
 */
export function useLearnerCanonicalGoalProgress(enrollmentId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["learner-canonical-goal-progress", enrollmentId ?? null],
    queryFn: async (): Promise<Record<string, number | null>> => {
      const { data: rows, error: rpcError } = await supabase.rpc("learner_canonical_goal_progress", {
        p_enrollment_id: enrollmentId as string,
      });
      if (rpcError) {
        console.error("Learner goal progress failed to load", { enrollmentId, rpcError });
        throw rpcError;
      }
      return Object.fromEntries((rows ?? []).map((row) => [row.goal_id, row.progress_pct ?? null]));
    },
    enabled: !!enrollmentId,
    staleTime: 30_000,
  });

  return {
    progressByGoal: data ?? {},
    loading: !!enrollmentId && isLoading,
    error: errorMessage(error),
  };
}
