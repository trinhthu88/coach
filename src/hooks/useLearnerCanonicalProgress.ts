import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * The learner's own mirror of useSponsorLeaderData: same primitives
 * (get_sponsor_programme_progress / sponsor_canonical_module_schedule /
 * sponsor_canonical_activity) behind learner_canonical_* instead of
 * sponsor_canonical_leader_*, self-authorized instead of sponsor-authorized.
 * Every shared fact this hook returns (programme/cohort dates, required and
 * completed units per module, overall progress, pace, journey checkpoints)
 * is computed by the exact same engine Sponsor Leader Detail reads, so a
 * learner and their sponsor can never see two different answers for the
 * same enrollment. Do not add a second, independently-calculated version of
 * any of these fields elsewhere in the learner UI — extend this hook.
 */

export type LearnerModuleProgress =
  Database["public"]["Functions"]["learner_canonical_module_progress"]["Returns"][number];

export type LearnerCanonicalProgress =
  Database["public"]["Functions"]["learner_canonical_progress"]["Returns"][number];

export type LearnerJourneyPoint = {
  checkpoint_number: number;
  due_on: string;
  label: string | null;
  module_scope: string[];
  required_units: number;
  completed_units: number;
  state: "completed" | "current" | "overdue" | "upcoming";
};

export type LearnerWeeklyParticipation = {
  week_number: number;
  week_start: string;
  week_end: string;
  required_units: number;
  due_units: number;
  completed_units: number;
  activity_units: number;
  state: "completed" | "current" | "overdue" | "upcoming";
  is_current: boolean;
};

export type LearnerLearningItem = {
  key: "skill_cards" | "quizzes" | "reflections" | "daily_prompts";
  label: string;
  required_units: number;
  due_units: number;
  completed_units: number;
  progress_available: boolean;
  status: "completed" | "current" | "overdue" | "upcoming" | "unavailable";
};

export interface LearnerExperience {
  weeklyParticipation: LearnerWeeklyParticipation[];
  learningBreakdown: LearnerLearningItem[];
  coachingUtilisation: {
    required_units: number | null;
    completed_units: number | null;
    due_units: number | null;
    booked_units: number | null;
    utilisation_pct: number | null;
  } | null;
}

export interface LearnerCanonicalData {
  progress: LearnerCanonicalProgress | null;
  modules: LearnerModuleProgress[];
  journey: LearnerJourneyPoint[];
  experience: LearnerExperience;
  loading: boolean;
  error: string | null;
}

const EMPTY_EXPERIENCE: LearnerExperience = { weeklyParticipation: [], learningBreakdown: [], coachingUtilisation: null };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJourney(value: unknown): LearnerJourneyPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is LearnerJourneyPoint => {
      const row = asRecord(item);
      return (
        typeof row.checkpoint_number === "number" &&
        typeof row.due_on === "string" &&
        typeof row.required_units === "number" &&
        typeof row.completed_units === "number" &&
        ["completed", "current", "overdue", "upcoming"].includes(String(row.state))
      );
    })
    .map((item) => ({
      checkpoint_number: item.checkpoint_number,
      due_on: item.due_on,
      label: item.label ?? null,
      module_scope: Array.isArray(item.module_scope) ? item.module_scope.map(String) : [],
      required_units: item.required_units,
      completed_units: item.completed_units,
      state: item.state,
    }));
}

function parseExperience(value: unknown): LearnerExperience {
  const payload = asRecord(value) as {
    weekly_participation?: unknown;
    learning_breakdown?: unknown;
    coaching_utilisation?: unknown;
  };
  const weeklyValue = Array.isArray(payload.weekly_participation) ? payload.weekly_participation : [];
  const learningValue = Array.isArray(payload.learning_breakdown) ? payload.learning_breakdown : [];
  const coaching = asRecord(payload.coaching_utilisation);

  return {
    weeklyParticipation: weeklyValue
      .filter((item): item is LearnerWeeklyParticipation => {
        const row = asRecord(item);
        return (
          typeof row.week_number === "number" &&
          typeof row.week_start === "string" &&
          typeof row.week_end === "string" &&
          typeof row.required_units === "number" &&
          typeof row.completed_units === "number" &&
          typeof row.activity_units === "number" &&
          ["completed", "current", "overdue", "upcoming"].includes(String(row.state))
        );
      })
      .map((item) => ({
        week_number: item.week_number,
        week_start: item.week_start,
        week_end: item.week_end,
        required_units: item.required_units,
        due_units: item.due_units,
        completed_units: item.completed_units,
        activity_units: item.activity_units,
        state: item.state,
        is_current: Boolean(item.is_current),
      })),
    learningBreakdown: learningValue
      .filter((item): item is LearnerLearningItem => {
        const row = asRecord(item);
        return (
          typeof row.key === "string" &&
          typeof row.label === "string" &&
          typeof row.required_units === "number" &&
          typeof row.due_units === "number" &&
          typeof row.completed_units === "number" &&
          typeof row.progress_available === "boolean" &&
          ["completed", "current", "overdue", "upcoming", "unavailable"].includes(String(row.status))
        );
      })
      .map((item) => ({
        key: item.key,
        label: item.label,
        required_units: item.required_units,
        due_units: item.due_units,
        completed_units: item.completed_units,
        progress_available: item.progress_available,
        status: item.status,
      })),
    coachingUtilisation:
      Object.keys(coaching).length === 0
        ? null
        : {
            required_units: asNumber(coaching.required_units),
            completed_units: asNumber(coaching.completed_units),
            due_units: asNumber(coaching.due_units),
            booked_units: asNumber(coaching.booked_units),
            utilisation_pct: asNumber(coaching.utilisation_pct),
          },
  };
}

async function fetchLearnerCanonical(enrollmentId: string, asOf?: string) {
  const args = asOf ? { p_enrollment_id: enrollmentId, p_as_of: asOf } : { p_enrollment_id: enrollmentId };
  const [progressRes, modulesRes, journeyRes, experienceRes] = await Promise.all([
    supabase.rpc("learner_canonical_progress", args),
    supabase.rpc("learner_canonical_module_progress", args),
    supabase.rpc("learner_canonical_journey", args),
    supabase.rpc("learner_canonical_experience", args),
  ]);
  if (progressRes.error) throw progressRes.error;
  if (modulesRes.error) throw modulesRes.error;
  if (journeyRes.error) throw journeyRes.error;
  if (experienceRes.error) throw experienceRes.error;

  return {
    progress: (progressRes.data?.[0] as LearnerCanonicalProgress | undefined) ?? null,
    modules: (modulesRes.data ?? []) as LearnerModuleProgress[],
    journey: parseJourney(journeyRes.data),
    experience: parseExperience(experienceRes.data),
  };
}

/**
 * Canonical self-view for the signed-in learner's own enrollment: overall +
 * per-module progress, programme journey checkpoints, and the learning
 * breakdown (skill cards / quizzes / reflections / daily prompts). All four
 * values come from the same schedule + activity engine as Sponsor Leader
 * Detail — nothing here is recomputed client-side.
 */
export function useLearnerCanonicalProgress(enrollmentId: string | undefined, asOf?: string): LearnerCanonicalData {
  const { data, isLoading, error } = useQuery({
    queryKey: ["learner-canonical-progress", enrollmentId ?? null, asOf ?? null],
    queryFn: () => fetchLearnerCanonical(enrollmentId as string, asOf),
    enabled: !!enrollmentId,
    staleTime: 30_000,
  });

  return {
    progress: data?.progress ?? null,
    modules: data?.modules ?? [],
    journey: data?.journey ?? [],
    experience: data?.experience ?? EMPTY_EXPERIENCE,
    loading: !!enrollmentId && isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
}
