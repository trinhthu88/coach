import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type SponsorKpis = Database["public"]["Functions"]["sponsor_kpis"]["Returns"][number];
export type SponsorGoalGrowth = Database["public"]["Functions"]["sponsor_goal_growth_summary"]["Returns"][number];
export type SponsorRosterRow = Database["public"]["Functions"]["sponsor_roster"]["Returns"][number];
export type SponsorSatisfaction = Database["public"]["Functions"]["sponsor_satisfaction_summary"]["Returns"][number];
export type SponsorTimeline = Database["public"]["Functions"]["sponsor_timeline"]["Returns"][number];

interface SponsorDashboardData {
  kpis: SponsorKpis | null;
  goalGrowth: SponsorGoalGrowth | null;
  roster: SponsorRosterRow[];
  satisfaction: SponsorSatisfaction | null;
  timeline: SponsorTimeline | null;
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
  const [goalGrowth, setGoalGrowth] = useState<SponsorGoalGrowth | null>(null);
  const [roster, setRoster] = useState<SponsorRosterRow[]>([]);
  const [satisfaction, setSatisfaction] = useState<SponsorSatisfaction | null>(null);
  const [timeline, setTimeline] = useState<SponsorTimeline | null>(null);
  const [minLeadersForDistribution, setMinLeadersForDistribution] = useState(5);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [kpisRes, growthRes, rosterRes, satisfactionRes, timelineRes, minLeadersRes] = await Promise.all([
        supabase.rpc("sponsor_kpis"),
        supabase.rpc("sponsor_goal_growth_summary"),
        supabase.rpc("sponsor_roster"),
        supabase.rpc("sponsor_satisfaction_summary"),
        supabase.rpc("sponsor_timeline"),
        supabase.rpc("sponsor_min_leaders_for_distribution"),
      ]);
      if (!mounted) return;
      setKpis(kpisRes.data?.[0] ?? null);
      setGoalGrowth(growthRes.data?.[0] ?? null);
      setRoster(rosterRes.data ?? []);
      setSatisfaction(satisfactionRes.data?.[0] ?? null);
      setTimeline(timelineRes.data?.[0] ?? null);
      if (typeof minLeadersRes.data === "number") setMinLeadersForDistribution(minLeadersRes.data);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return { kpis, goalGrowth, roster, satisfaction, timeline, minLeadersForDistribution, loading };
}
