import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { SponsorRosterRow } from "./useSponsorDashboardData";

export type SponsorLeaderCadenceItem = Database["public"]["Functions"]["sponsor_leader_cadence_items"]["Returns"][number];
export type SponsorProgrammeHistoryRow = Database["public"]["Functions"]["sponsor_leader_programme_history"]["Returns"][number];

export interface SponsorLeaderDetailData {
  leader: SponsorRosterRow | null;
  cadenceItems: SponsorLeaderCadenceItem[];
  history: SponsorProgrammeHistoryRow[];
  nextSession: string | null;
  minLeadersForDistribution: number;
  notFound: boolean;
  loading: boolean;
}

/**
 * Leader Detail reuses the exact same sponsor_enrollment_summaries row the
 * Cohort roster already fetched (looked up by enrollment_id) -- there is no
 * second calculation of Enrollment Status / On Track / Cadence Completion /
 * Goal Progress anywhere in this hook, by design (spec: "Do NOT implement
 * new independent calculations for the Leader page").
 */
export function useSponsorLeaderDetail(cohortId: string, enrollmentId: string): SponsorLeaderDetailData {
  const [leader, setLeader] = useState<SponsorRosterRow | null>(null);
  const [cadenceItems, setCadenceItems] = useState<SponsorLeaderCadenceItem[]>([]);
  const [history, setHistory] = useState<SponsorProgrammeHistoryRow[]>([]);
  const [nextSession, setNextSession] = useState<string | null>(null);
  const [minLeadersForDistribution, setMinLeadersForDistribution] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      supabase.rpc("sponsor_enrollment_summaries", { p_cohort_id: cohortId }),
      supabase.rpc("sponsor_leader_cadence_items", { p_enrollment_id: enrollmentId }),
      supabase.rpc("sponsor_leader_programme_history", { p_enrollment_id: enrollmentId }),
      supabase.rpc("sponsor_enrollment_next_session", { p_enrollment_id: enrollmentId }),
      supabase.rpc("sponsor_min_leaders_for_distribution"),
    ]).then(([rosterRes, cadenceRes, historyRes, nextSessionRes, thresholdRes]) => {
      if (!mounted) return;
      const row = (rosterRes.data ?? []).find((r) => r.enrollment_id === enrollmentId) ?? null;
      setLeader(row);
      setNotFound(!row);
      setCadenceItems(cadenceRes.data ?? []);
      setHistory(historyRes.data ?? []);
      setNextSession(nextSessionRes.data ?? null);
      setMinLeadersForDistribution(thresholdRes.data ?? 0);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [cohortId, enrollmentId]);

  return { leader, cadenceItems, history, nextSession, minLeadersForDistribution, notFound, loading };
}
