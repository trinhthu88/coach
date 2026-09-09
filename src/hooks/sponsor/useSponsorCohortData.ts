import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  SponsorGoalGrowth,
  SponsorKpis,
  SponsorRosterRow,
  SponsorSatisfaction,
  SponsorProgrammeEngagementRow,
  SponsorRedFlagRow,
  SponsorCoachUtilisationRow,
} from "./useSponsorDashboardData";

interface SponsorCohortData {
  kpis: SponsorKpis | null;
  goalGrowth: SponsorGoalGrowth | null;
  roster: SponsorRosterRow[];
  satisfaction: SponsorSatisfaction | null;
  minLeadersForDistribution: number;
  programmeEngagement: SponsorProgrammeEngagementRow[];
  redFlags: SponsorRedFlagRow[];
  coachUtilisation: SponsorCoachUtilisationRow[];
  loading: boolean;
}

/**
 * Every sponsor_* RPC now accepts an optional p_cohort_id uuid (see
 * src/integrations/supabase/types.ts), so this hook fetches cohort-scoped
 * data server-side instead of over-fetching org-wide rows and filtering
 * them client-side.
 *
 * The `cohortId` this hook receives is actually the cohort *name* — the
 * route param SponsorCohortDetail.tsx passes in (none of the sponsor_*
 * RPCs return a cohort id, only cohort_name, so the route was built on the
 * name). p_cohort_id is a uuid, so the cohort's id is resolved from its
 * name first via a direct `cohorts` table query — the one exception to the
 * sponsor_*-RPC-only rule, same one SponsorCohortDetail.tsx already uses
 * for the cohort's start/end dates.
 */
export function useSponsorCohortData(cohortId: string): SponsorCohortData {
  const [kpis, setKpis] = useState<SponsorKpis | null>(null);
  const [goalGrowth, setGoalGrowth] = useState<SponsorGoalGrowth | null>(null);
  const [roster, setRoster] = useState<SponsorRosterRow[]>([]);
  const [satisfaction, setSatisfaction] = useState<SponsorSatisfaction | null>(null);
  const [minLeadersForDistribution, setMinLeadersForDistribution] = useState(5);
  const [programmeEngagement, setProgrammeEngagement] = useState<SponsorProgrammeEngagementRow[]>([]);
  const [redFlags, setRedFlags] = useState<SponsorRedFlagRow[]>([]);
  const [coachUtilisation, setCoachUtilisation] = useState<SponsorCoachUtilisationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      const { data: cohortRow } = await supabase
        .from("cohorts")
        .select("id")
        .eq("name", cohortId)
        .maybeSingle();
      if (!mounted) return;
      const pCohortId = cohortRow?.id ?? null;

      const [
        kpisRes, goalGrowthRes, rosterRes, satisfactionRes, minLeadersRes,
        engagementRes, redFlagsRes, utilisationRes,
      ] = await Promise.all([
        supabase.rpc("sponsor_kpis", { p_cohort_id: pCohortId }),
        supabase.rpc("sponsor_goal_growth_summary", { p_cohort_id: pCohortId }),
        supabase.rpc("sponsor_roster", { p_cohort_id: pCohortId }),
        supabase.rpc("sponsor_satisfaction_summary", { p_cohort_id: pCohortId }),
        supabase.rpc("sponsor_min_leaders_for_distribution", { p_cohort_id: pCohortId }),
        supabase.rpc("sponsor_programme_engagement", { p_cohort_id: pCohortId }),
        supabase.rpc("sponsor_engagement_red_flags", { p_cohort_id: pCohortId }),
        supabase.rpc("sponsor_coach_utilisation", { p_cohort_id: pCohortId }),
      ]);
      if (!mounted) return;

      setKpis(kpisRes.data?.[0] ?? null);
      setGoalGrowth(goalGrowthRes.data?.[0] ?? null);
      setRoster(rosterRes.data ?? []);
      setSatisfaction(satisfactionRes.data?.[0] ?? null);
      if (typeof minLeadersRes.data === "number") setMinLeadersForDistribution(minLeadersRes.data);
      setProgrammeEngagement(engagementRes.data ?? []);
      setRedFlags(redFlagsRes.data ?? []);
      setCoachUtilisation(utilisationRes.data ?? []);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [cohortId]);

  return {
    kpis, goalGrowth, roster, satisfaction, minLeadersForDistribution,
    programmeEngagement, redFlags, coachUtilisation, loading,
  };
}
