import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type HostedEnrollmentSummary = Database["public"]["Functions"]["sponsor_enrollment_summaries"]["Returns"][number];
type HostedCohortSummary = Database["public"]["Functions"]["sponsor_cohort_summaries"]["Returns"][number];
type HostedOrganisationSummary = Database["public"]["Functions"]["sponsor_organisation_summary"]["Returns"][number];
type HostedCanonicalEnrollment = Database["public"]["Functions"]["sponsor_canonical_enrollment_progress"]["Returns"][number];
type HostedCanonicalCohort = Database["public"]["Functions"]["sponsor_canonical_cohort_progress"]["Returns"][number];
type HostedCanonicalOrganisation = Database["public"]["Functions"]["sponsor_canonical_organisation_progress"]["Returns"][number];

export type SponsorEnrollmentSummary = HostedEnrollmentSummary & HostedCanonicalEnrollment;
export type SponsorCohortSummary = HostedCohortSummary & HostedCanonicalCohort;
export type SponsorRosterRow = SponsorEnrollmentSummary;
export type SponsorKpis = HostedOrganisationSummary & HostedCanonicalOrganisation;
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

/**
 * All sponsor-facing data comes from the sponsor_* SECURITY DEFINER
 * functions — never a direct table query. Each is scoped server-side to
 * the caller's own organization; there is no client-supplied org id to
 * get wrong.
 */
export function useSponsorDashboardData(): SponsorDashboardData {
  const [kpis, setKpis] = useState<SponsorKpis | null>(null);
  const [roster, setRoster] = useState<SponsorEnrollmentSummary[]>([]);
  const [cohortSummaries, setCohortSummaries] = useState<SponsorCohortSummary[]>([]);
  const [minLeadersForDistribution, setMinLeadersForDistribution] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [{ data: legacyCohorts, error: cohortError }, { data: canonicalCohorts }, { data: legacyOrganisation }, { data: canonicalOrganisation }, threshold] = await Promise.all([
        supabase.rpc("sponsor_cohort_summaries"),
        supabase.rpc("sponsor_canonical_cohort_progress"),
        supabase.rpc("sponsor_organisation_summary"),
        supabase.rpc("sponsor_canonical_organisation_progress"),
        supabase.rpc("sponsor_min_leaders_for_distribution"),
      ]);
      if (!mounted) return;
      if (cohortError || !Array.isArray(canonicalCohorts) || !Array.isArray(canonicalOrganisation)) { setLoading(false); return; }
      setMinLeadersForDistribution(threshold.data ?? 0);
      const cohorts = canonicalCohorts.map((cohort) => ({
        ...(legacyCohorts ?? []).find((legacy) => legacy.cohort_id === cohort.cohort_id),
        ...cohort,
      })) as SponsorCohortSummary[];
      const visibleCohorts = cohorts.filter((cohort) => !cohort.suppressed);
      const rosterResults = await Promise.all(visibleCohorts.map(async (cohort) => {
        const [{ data: legacyRows, error: legacyError }, { data: canonicalRows, error: canonicalError }] = await Promise.all([
          supabase.rpc("sponsor_enrollment_summaries", { p_cohort_id: cohort.cohort_id }),
          supabase.rpc("sponsor_canonical_enrollment_progress", { p_cohort_id: cohort.cohort_id }),
        ]);
        if (legacyError || canonicalError) return [];
        const canonicalById = new Map((canonicalRows ?? []).map((row) => [row.enrollment_id, row]));
        return (legacyRows ?? []).map((row) => ({ ...row, ...canonicalById.get(row.enrollment_id) })) as SponsorRosterRow[];
      }));
      const rosterRows = rosterResults.flat();
       if (!mounted) return;
      setCohortSummaries(cohorts);
      setRoster(rosterRows);
      setKpis({ ...(legacyOrganisation?.[0] ?? {}), ...canonicalOrganisation[0] } as SponsorKpis);
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
