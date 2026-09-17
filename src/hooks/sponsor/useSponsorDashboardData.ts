import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type HostedCanonicalEnrollment = Database["public"]["Functions"]["sponsor_canonical_enrollment_metadata"]["Returns"][number];
type HostedCanonicalCohort = Database["public"]["Functions"]["sponsor_canonical_cohort_progress"]["Returns"][number];
type HostedCanonicalOrganisation = Database["public"]["Functions"]["sponsor_canonical_organisation_progress"]["Returns"][number];

export type SponsorEnrollmentSummary = HostedCanonicalEnrollment;
export type SponsorCohortSummary = HostedCanonicalCohort;
export type SponsorRosterRow = SponsorEnrollmentSummary;
export type SponsorKpis = HostedCanonicalOrganisation;
export type SponsorGoalGrowth = {
  hit_target_count: number; meaningful_progress_count: number; just_started_count: number;
  flat_declined_count: number; pct_progressing: number;
};
export type SponsorProgrammeEngagementRow = {
  week_number: number; week_title: string; is_locked: boolean; effective_unlock_date: string | null;
  skill_card_completion_pct: number; quiz_completion_pct: number; quiz_avg_score: number | null;
  reflection_completion_pct: number; triad_completion_pct: number; triad_satisfaction_avg: number | null;
  daily_prompt_response_rate: number;
};
export type SponsorRedFlagRow = { full_name: string; missed_prompts: number; missed_quizzes: number; missed_triads: number; days_since_last_activity: number };
export type SponsorSatisfactionTrendRow = { week_number: number; avg_rating: number | null };
export type SponsorCoachUtilisationRow = { coach_name: string; completed_sessions: number };

interface SponsorDashboardData {
  kpis: SponsorKpis | null;
  roster: SponsorEnrollmentSummary[];
  cohortSummaries: SponsorCohortSummary[];
  minLeadersForDistribution: number;
  loading: boolean;
}

export function useSponsorDashboardData(): SponsorDashboardData {
  const [kpis, setKpis] = useState<SponsorKpis | null>(null);
  const [roster, setRoster] = useState<SponsorEnrollmentSummary[]>([]);
  const [cohortSummaries, setCohortSummaries] = useState<SponsorCohortSummary[]>([]);
  const [minLeadersForDistribution, setMinLeadersForDistribution] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [
        { data: canonicalCohorts, error: cohortError },
        { data: canonicalOrganisation, error: organisationError },
        threshold,
      ] = await Promise.all([
        supabase.rpc("sponsor_canonical_cohort_progress"),
        supabase.rpc("sponsor_canonical_organisation_progress"),
        supabase.rpc("sponsor_min_leaders_for_distribution"),
      ]);
      if (!mounted) return;
      if (cohortError || organisationError || !Array.isArray(canonicalCohorts) || !Array.isArray(canonicalOrganisation)) {
        setLoading(false);
        return;
      }
      setMinLeadersForDistribution(threshold.data ?? 0);
      const cohorts = canonicalCohorts as SponsorCohortSummary[];
      const visibleCohorts = cohorts.filter((cohort) => !cohort.suppressed);
      const rosterResults = await Promise.all(visibleCohorts.map(async (cohort) => {
        const { data, error } = await supabase.rpc("sponsor_canonical_enrollment_metadata", {
          p_cohort_id: cohort.cohort_id,
        });
        if (error || !Array.isArray(data)) return [];
        return data as SponsorRosterRow[];
      }));
      const rosterRows = rosterResults.flat();
      if (!mounted) return;
      setCohortSummaries(cohorts);
      setRoster(rosterRows);
      setKpis(canonicalOrganisation[0] as SponsorKpis);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return {
    kpis, roster, cohortSummaries, minLeadersForDistribution, loading,
  };
}
