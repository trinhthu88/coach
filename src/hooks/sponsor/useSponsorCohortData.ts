import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  applyCohortModuleProgress,
  applyModuleProgress,
  type SponsorRosterRow,
  type SponsorCohortSummary,
} from "./useSponsorDashboardData";

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

      Promise.all(rows.map(async (row) => {
        const { data, error } = await supabase.rpc("get_enrollment_progress", {
          p_enrollment_id: row.enrollment_id,
        });
        return applyModuleProgress(row, error ? [] : Array.isArray(data) ? data : []);
      })).then((enrichedRows) => {
        if (!mounted) return;
        setRoster(enrichedRows);
        setKpis(aggregate ? applyCohortModuleProgress(aggregate, enrichedRows) : null);
        setLoading(false);
      });
    });
    return () => { mounted = false; };
  }, [cohortId]);

  return { kpis, roster, minLeadersForDistribution, cohortLabel, suppressed, loading };
}