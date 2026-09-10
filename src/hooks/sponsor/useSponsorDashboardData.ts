import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type SponsorEnrollmentSummary = Database["public"]["Functions"]["sponsor_enrollment_summaries"]["Returns"][number];
export type SponsorCohortSummary = Database["public"]["Functions"]["sponsor_cohort_summaries"]["Returns"][number];
// Compatibility aliases are retained for pages being migrated incrementally;
// no legacy RPC is queried and forbidden values are never populated.
export type SponsorRosterRow = SponsorEnrollmentSummary & {
  full_name: string; cohort_name: string; enrollment_status: Database["public"]["Enums"]["enrollment_status"];
  coachee_id: string; goal_growth: null; progress_pct: number;
  sessions_completed: number; sessions_entitled: number;
};
export type SponsorKpis = { leaders_enrolled: number; on_track_count: number; at_risk_count: number; sessions_used: number; sessions_entitled: number; enrolled_active_count: number };
export type SponsorGoalGrowth = null;
export type SponsorSatisfaction = null;
export type SponsorTimeline = null;
export type SponsorProgrammeEngagementRow = never;
export type SponsorRedFlagRow = never;
export type SponsorSatisfactionTrendRow = never;
export type SponsorCoachUtilisationRow = never;

interface SponsorDashboardData {
  kpis: SponsorKpis | null;
  roster: SponsorRosterRow[];
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
  const [roster, setRoster] = useState<SponsorRosterRow[]>([]);
  const [cohortSummaries, setCohortSummaries] = useState<SponsorCohortSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: cohorts, error } = await supabase.rpc("sponsor_cohort_summaries");
      if (!mounted) return;
      if (error) { setLoading(false); return; }
      setRoster([]);
      setCohortSummaries(cohorts ?? []);
      const visible = (cohorts ?? []).filter((r) => !r.suppressed);
      setKpis({ leaders_enrolled: visible.reduce((n, r) => n + (r.enrollment_count ?? 0), 0),
        enrolled_active_count: 0, on_track_count: visible.filter((r) => r.pace_status === "on_track").length,
        at_risk_count: visible.filter((r) => r.pace_status === "behind").length,
        sessions_used: visible.reduce((n, r) => n + (r.coaching_completed_count ?? 0), 0),
        sessions_entitled: visible.reduce((n, r) => n + (r.required_units ?? 0), 0) });
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return {
    kpis, roster, cohortSummaries, minLeadersForDistribution: 5, loading,
  };
}
