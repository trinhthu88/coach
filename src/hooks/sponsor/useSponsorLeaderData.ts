import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { SponsorRosterRow } from "./useSponsorDashboardData";

type HostedLeaderProgress = Database["public"]["Functions"]["sponsor_canonical_enrollment_metadata"]["Returns"][number];

export type SponsorLeaderJourneyPoint = {
  checkpoint_number: number;
  due_on: string;
  label: string | null;
  module_scope: string[];
  required_units: number;
  completed_units: number;
  state: "completed" | "current" | "overdue" | "upcoming";
};

export type SponsorLeaderWeeklyParticipation = {
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

export type SponsorLeaderLearningItem = {
  key: "skill_cards" | "quizzes" | "reflections" | "daily_prompts";
  label: string;
  required_units: number;
  due_units: number;
  completed_units: number;
  progress_available: boolean;
  status: "completed" | "current" | "overdue" | "upcoming" | "unavailable";
};

export type SponsorLeaderExperience = {
  weeklyParticipation: SponsorLeaderWeeklyParticipation[];
  learningBreakdown: SponsorLeaderLearningItem[];
  coachingUtilisation: {
    required_units: number | null;
    completed_units: number | null;
    due_units: number | null;
    booked_units: number | null;
    utilisation_pct: number | null;
  } | null;
};

export type SponsorLeaderProfileData = Pick<
  SponsorRosterRow,
  | "enrollment_id"
  | "learner_display_name"
  | "programme_label"
  | "cohort_id"
  | "cohort_label"
  | "enrollment_status"
  | "stored_enrollment_status"
  | "effective_enrollment_status"
  | "enrollment_start_date"
  | "enrollment_end_date"
  | "programme_start_date"
  | "programme_end_date"
  | "required_units"
  | "completed_units"
  | "due_units"
  | "booked_units"
  | "overdue_units"
  | "full_completion_pct"
  | "due_adherence_pct"
  | "pace_status"
  | "coaching_required_units"
  | "coaching_completed_units"
  | "coaching_due_units"
  | "coaching_booked_units"
  | "training_required_units"
  | "training_completed_units"
  | "training_due_units"
  | "training_booked_units"
  | "peer_required_units"
  | "peer_completed_units"
  | "peer_due_units"
  | "peer_booked_units"
  | "mentoring_required_units"
  | "mentoring_completed_units"
  | "mentoring_due_units"
  | "mentoring_booked_units"
  | "triad_required_units"
  | "triad_completed_units"
  | "triad_due_units"
  | "triad_booked_units"
  | "goal_count"
  | "goal_progress_pct"
  | "open_action_count"
  | "completed_action_count"
  | "total_action_count"
  | "action_completion_pct"
  | "satisfaction_avg"
  | "satisfaction_rated_count"
>;

export interface SponsorLeaderData {
  leader: SponsorLeaderProfileData | null;
  journey: SponsorLeaderJourneyPoint[];
  experience: SponsorLeaderExperience;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

type ExperiencePayload = {
  weekly_participation?: unknown;
  learning_breakdown?: unknown;
  coaching_utilisation?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJourney(value: unknown): SponsorLeaderJourneyPoint[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SponsorLeaderJourneyPoint => {
    const row = asRecord(item);
    return typeof row.checkpoint_number === "number"
      && typeof row.due_on === "string"
      && typeof row.required_units === "number"
      && typeof row.completed_units === "number"
      && ["completed", "current", "overdue", "upcoming"].includes(String(row.state));
  }).map((item) => ({
    checkpoint_number: item.checkpoint_number,
    due_on: item.due_on,
    label: item.label ?? null,
    module_scope: Array.isArray(item.module_scope) ? item.module_scope.map(String) : [],
    required_units: item.required_units,
    completed_units: item.completed_units,
    state: item.state,
  }));
}

function parseExperience(value: unknown): SponsorLeaderExperience {
  const payload = asRecord(value) as ExperiencePayload;
  const weeklyValue = Array.isArray(payload.weekly_participation) ? payload.weekly_participation : [];
  const learningValue = Array.isArray(payload.learning_breakdown) ? payload.learning_breakdown : [];
  const coaching = asRecord(payload.coaching_utilisation);

  return {
    weeklyParticipation: weeklyValue.filter((item): item is SponsorLeaderWeeklyParticipation => {
      const row = asRecord(item);
      return typeof row.week_number === "number"
        && typeof row.week_start === "string"
        && typeof row.week_end === "string"
        && typeof row.required_units === "number"
        && typeof row.completed_units === "number"
        && typeof row.activity_units === "number"
        && ["completed", "current", "overdue", "upcoming"].includes(String(row.state));
    }).map((item) => ({
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
    learningBreakdown: learningValue.filter((item): item is SponsorLeaderLearningItem => {
      const row = asRecord(item);
      return typeof row.key === "string"
        && typeof row.label === "string"
        && typeof row.required_units === "number"
        && typeof row.due_units === "number"
        && typeof row.completed_units === "number"
        && typeof row.progress_available === "boolean"
        && ["completed", "current", "overdue", "upcoming", "unavailable"].includes(String(row.status));
    }).map((item) => ({
      key: item.key,
      label: item.label,
      required_units: item.required_units,
      due_units: item.due_units,
      completed_units: item.completed_units,
      progress_available: item.progress_available,
      status: item.status,
    })),
    coachingUtilisation: Object.keys(coaching).length === 0 ? null : {
      required_units: asNumber(coaching.required_units),
      completed_units: asNumber(coaching.completed_units),
      due_units: asNumber(coaching.due_units),
      booked_units: asNumber(coaching.booked_units),
      utilisation_pct: asNumber(coaching.utilisation_pct),
    },
  };
}

export function useSponsorLeaderData(enrollmentId: string, cohortId?: string): SponsorLeaderData {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<SponsorLeaderData>({
    leader: null,
    journey: [],
    experience: { weeklyParticipation: [], learningBreakdown: [], coachingUtilisation: null },
    loading: true,
    error: null,
    retry: () => undefined,
  });

  useEffect(() => {
    let mounted = true;
    setState((current) => ({ ...current, loading: true, error: null }));

    const metadataParams = cohortId
      ? { p_cohort_id: cohortId, p_enrollment_id: enrollmentId }
      : { p_enrollment_id: enrollmentId };

    const load = async (allowSessionRefresh: boolean) => {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (!session) {
        if (!mounted) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: sessionError?.message ?? "Sponsor session is unavailable",
        }));
        return;
      }

      const [progress, journey, experience] = await Promise.all([
        supabase.rpc("sponsor_canonical_enrollment_metadata", metadataParams),
        supabase.rpc("sponsor_canonical_leader_journey", { p_enrollment_id: enrollmentId }),
        supabase.rpc("sponsor_canonical_leader_experience", { p_enrollment_id: enrollmentId }),
      ]);
      const rpcErrors = [progress.error, journey.error];
      const needsSessionRefresh = allowSessionRefresh && rpcErrors.some((rpcError) =>
        rpcError?.code === "42501" || rpcError?.code === "401" || rpcError?.status === 401
      );

      if (needsSessionRefresh) {
        const { data: { session: refreshedSession } } = await supabase.auth.refreshSession();
        if (refreshedSession) {
          await load(false);
          return;
        }
      }

      if (!mounted) return;
      const leaderRow = progress.data?.[0] as HostedLeaderProgress | undefined;
      const leader = leaderRow ? leaderRow as SponsorLeaderProfileData : null;
      const error = progress.error?.message
        ?? journey.error?.message
        ?? null;
      if (experience.error && !error) {
        console.warn("Sponsor leader experience is unavailable; rendering canonical progress without optional detail", {
          cohortId,
          enrollmentId,
          experienceError: experience.error,
        });
      }
      if (error) {
        console.error("Sponsor leader detail failed to load", {
          cohortId,
          enrollmentId,
          metadataError: progress.error,
          journeyError: journey.error,
          experienceError: experience.error,
        });
      }
      setState({
        leader,
        journey: parseJourney(journey.data),
        experience: parseExperience(experience.data),
        loading: false,
        error,
      });
    };

    load(true).catch((error: unknown) => {
      if (!mounted) return;
      console.error("Sponsor leader detail request failed", {
        cohortId,
        enrollmentId,
        cause: error,
      });
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load leader detail",
      }));
    });

    return () => {
      mounted = false;
    };
  }, [cohortId, enrollmentId, reloadToken]);

  return {
    ...state,
    retry: () => setReloadToken((token) => token + 1),
  };
}