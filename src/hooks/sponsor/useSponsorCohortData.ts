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
 * None of the sponsor_* RPCs take a cohort_id argument (see
 * src/integrations/supabase/types.ts — every one of them is `Args: never`),
 * so this hook fetches the same org-wide RPCs useSponsorDashboardData does
 * and narrows client-side to one cohort:
 *  - roster: filtered by cohort_name, the only cohort field it returns.
 *  - redFlags: cross-referenced against the cohort-filtered roster's
 *    coachee_id (sponsor_engagement_red_flags returns user_id but no
 *    cohort_name at all).
 *  - goalGrowth: recomputed from the cohort-filtered roster's own
 *    goal_growth (already a per-leader 0-100 pct), using the same bucket
 *    thresholds sponsor_goal_growth_summary() uses server-side — the RPC's
 *    own return value is a single org-wide row with no per-leader
 *    breakdown to filter.
 *  - programmeEngagement / coachUtilisation: these RPCs aggregate across
 *    the whole org with no leader or cohort dimension in their returned
 *    columns at all (programme_engagement is per-week-across-all-users,
 *    coach_utilisation is per-coach-across-all-sessions) — there is no
 *    field to filter on, so these are shown org-wide on every cohort's
 *    detail page rather than silently faked as cohort-scoped.
 */
export function useSponsorCohortData(cohortId: string): SponsorCohortData {
  const [kpis, setKpis] = useState<SponsorKpis | null>(null);
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
      const [
        kpisRes, rosterRes, satisfactionRes, minLeadersRes,
        engagementRes, redFlagsRes, utilisationRes,
      ] = await Promise.all([
        supabase.rpc("sponsor_kpis"),
        supabase.rpc("sponsor_roster"),
        supabase.rpc("sponsor_satisfaction_summary"),
        supabase.rpc("sponsor_min_leaders_for_distribution"),
        supabase.rpc("sponsor_programme_engagement"),
        supabase.rpc("sponsor_engagement_red_flags"),
        supabase.rpc("sponsor_coach_utilisation"),
      ]);
      if (!mounted) return;

      const cohortRoster = (rosterRes.data ?? []).filter((r) => r.cohort_name === cohortId);
      const cohortCoacheeIds = new Set(cohortRoster.map((r) => r.coachee_id));

      setKpis(kpisRes.data?.[0] ?? null);
      setRoster(cohortRoster);
      setSatisfaction(satisfactionRes.data?.[0] ?? null);
      if (typeof minLeadersRes.data === "number") setMinLeadersForDistribution(minLeadersRes.data);
      setProgrammeEngagement(engagementRes.data ?? []);
      setRedFlags((redFlagsRes.data ?? []).filter((f) => cohortCoacheeIds.has(f.user_id)));
      setCoachUtilisation(utilisationRes.data ?? []);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [cohortId]);

  const minLeaders = minLeadersForDistribution;
  const withGrowth = roster.filter((r) => r.goal_growth != null);
  const goalGrowth: SponsorGoalGrowth | null = roster.length === 0 ? null : {
    avg_growth: withGrowth.length ? withGrowth.reduce((s, r) => s + r.goal_growth!, 0) / withGrowth.length : null as unknown as number,
    pct_progressing: withGrowth.length ? (100 * withGrowth.filter((r) => r.goal_growth! >= 50).length) / withGrowth.length : null as unknown as number,
    enrolled_leaders_count: roster.length,
    hit_target_count: withGrowth.length >= minLeaders ? withGrowth.filter((r) => r.goal_growth! >= 100).length : null as unknown as number,
    meaningful_progress_count: withGrowth.length >= minLeaders ? withGrowth.filter((r) => r.goal_growth! >= 50 && r.goal_growth! < 100).length : null as unknown as number,
    just_started_count: withGrowth.length >= minLeaders ? withGrowth.filter((r) => r.goal_growth! > 0 && r.goal_growth! < 50).length : null as unknown as number,
    flat_declined_count: withGrowth.length >= minLeaders ? withGrowth.filter((r) => r.goal_growth! <= 0).length : null as unknown as number,
  };

  return {
    kpis, goalGrowth, roster, satisfaction, minLeadersForDistribution,
    programmeEngagement, redFlags, coachUtilisation, loading,
  };
}
