import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SponsorRosterRow, SponsorCohortSummary } from "./useSponsorDashboardData";

export interface SponsorCohortData {
  kpis: SponsorCohortSummary | null;
  roster: SponsorRosterRow[];
  minLeadersForDistribution: number;
  cohortLabel: string | null;
  suppressed: boolean;
  loading: boolean;
}

/** Fetches a UUID-scoped, server-authorized sponsor cohort summary. */
export function useSponsorCohortData(cohortId: string): SponsorCohortData {
  const [kpis, setKpis] = useState<SponsorCohortSummary | null>(null);
  const [roster, setRoster] = useState<SponsorRosterRow[]>([]);
  const [cohortLabel, setCohortLabel] = useState<string | null>(null);
  const [suppressed, setSuppressed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [minLeadersForDistribution, setMinLeadersForDistribution] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      supabase.rpc("sponsor_enrollment_summaries", { p_cohort_id: cohortId }),
      supabase.rpc("sponsor_cohort_summaries", { p_cohort_id: cohortId }),
      supabase.rpc("sponsor_min_leaders_for_distribution"),
    ]).then(([summaryRes, cohortRes, thresholdRes]) => {
      if (!mounted) return;
      const rows = summaryRes.data ?? [];
      const aggregate = cohortRes.data?.[0];
      setMinLeadersForDistribution(thresholdRes.data ?? 0);
      setCohortLabel(aggregate?.cohort_label ?? rows[0]?.cohort_label ?? null);
       setSuppressed(aggregate?.suppressed ?? true);
       setRoster(rows);
       setKpis(aggregate ?? null);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [cohortId]);

  return { kpis, roster, minLeadersForDistribution, cohortLabel, suppressed, loading };
}