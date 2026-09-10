import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type SponsorEnrollmentSummary = Database["public"]["Functions"]["sponsor_enrollment_summaries"]["Returns"][number];
export type SponsorCohortSummary = Database["public"]["Functions"]["sponsor_cohort_summaries"]["Returns"][number];
export type SponsorRosterRow = SponsorEnrollmentSummary;
export type SponsorKpis = Database["public"]["Functions"]["sponsor_organisation_summary"]["Returns"][number];
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
      const [{ data: cohorts, error }, { data: organisation }, threshold] = await Promise.all([
        supabase.rpc("sponsor_cohort_summaries"),
        supabase.rpc("sponsor_organisation_summary"),
        supabase.rpc("sponsor_min_leaders_for_distribution"),
      ]);
      if (!mounted) return;
      if (error) { setLoading(false); return; }
      setMinLeadersForDistribution(threshold.data ?? 0);
      setCohortSummaries(cohorts ?? []);
      // Organisation scope is aggregate-only. Names and enrollment rows are
      // available only after navigating to an explicit, unsuppressed cohort.
      setRoster([]);
      const summary = organisation?.[0];
      setKpis(summary ?? null);
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
