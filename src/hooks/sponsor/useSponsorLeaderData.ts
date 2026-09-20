import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { SponsorRosterRow } from "./useSponsorDashboardData";
import {
  EMPTY_PROGRAMME_EXPERIENCE,
  parseProgrammeExperience,
  parseProgrammeJourney,
  type ProgrammeExperience,
  type ProgrammeJourneyPoint,
  type ProgrammeLearningItem,
  type ProgrammeWeeklyParticipation,
} from "@/lib/programmeProfile";

type HostedLeaderProgress = Database["public"]["Functions"]["sponsor_canonical_enrollment_metadata"]["Returns"][number];

// One journey/experience contract shared with the learner self-view — see
// src/lib/programmeProfile.ts. Aliases keep existing sponsor imports stable.
export type SponsorLeaderJourneyPoint = ProgrammeJourneyPoint;
export type SponsorLeaderWeeklyParticipation = ProgrammeWeeklyParticipation;
export type SponsorLeaderLearningItem = ProgrammeLearningItem;
export type SponsorLeaderExperience = ProgrammeExperience;

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

export function useSponsorLeaderData(enrollmentId: string, cohortId?: string): SponsorLeaderData {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<SponsorLeaderData>({
    leader: null,
    journey: [],
    experience: EMPTY_PROGRAMME_EXPERIENCE,
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

      // Progress and journey are the required canonical payloads. Experience
      // is optional enrichment and runs after them so three heavy
      // enrollment-scoped RPCs do not compete for the database statement
      // timeout at the same time.
      const [progress, journey] = await Promise.all([
        supabase.rpc("sponsor_canonical_enrollment_metadata", metadataParams),
        supabase.rpc("sponsor_canonical_leader_journey", { p_enrollment_id: enrollmentId }),
      ]);
      const experience = await supabase.rpc("sponsor_canonical_leader_experience", { p_enrollment_id: enrollmentId });
      const rpcErrors = [progress.error, journey.error];
      const needsSessionRefresh = allowSessionRefresh && rpcErrors.some((rpcError) =>
        rpcError?.code === "42501" || rpcError?.code === "401" || (rpcError as { status?: number } | null)?.status === 401
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
      setState((current) => ({
        ...current,
        leader,
        journey: parseProgrammeJourney(journey.data),
        experience: parseProgrammeExperience(experience.data),
        loading: false,
        error,
      }));
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