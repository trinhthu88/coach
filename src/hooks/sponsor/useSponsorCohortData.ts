import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { SponsorRosterRow, SponsorCohortSummary } from "./useSponsorDashboardData";

export type SponsorCadenceItem = Database["public"]["Functions"]["sponsor_cohort_cadence_items"]["Returns"][number];

export interface SponsorCohortData {
  kpis: SponsorCohortSummary | null;
  roster: SponsorRosterRow[];
  cadenceItems: SponsorCadenceItem[];
  minLeadersForDistribution: number;
  cohortLabel: string | null;
  suppressed: boolean;
  loading: boolean;
}

/** Fetches a UUID-scoped, server-authorized sponsor cohort summary. */
export function useSponsorCohortData(cohortId: string): SponsorCohortData {
  const [kpis, setKpis] = useState<SponsorCohortSummary | null>(null);
  const [roster, setRoster] = useState<SponsorRosterRow[]>([]);
  const [cadenceItems, setCadenceItems] = useState<SponsorCadenceItem[]>([]);
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
      supabase.rpc("sponsor_cohort_cadence_items", { p_cohort_id: cohortId }),
    ]).then(([summaryRes, cohortRes, thresholdRes, cadenceRes]) => {
      if (!mounted) return;
      const rows = summaryRes.data ?? [];
      const aggregate = cohortRes.data?.[0];
      setMinLeadersForDistribution(thresholdRes.data ?? 0);
      setCohortLabel(aggregate?.cohort_label ?? rows[0]?.cohort_label ?? null);
      setSuppressed(aggregate?.suppressed ?? true);
      setRoster(rows);
      setKpis(aggregate ?? null);
      setCadenceItems(cadenceRes.data ?? []);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [cohortId]);

  return { kpis, roster, cadenceItems, minLeadersForDistribution, cohortLabel, suppressed, loading };
}
