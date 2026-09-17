import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
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

/**
 * Fetches a UUID-scoped, server-authorized sponsor cohort summary.
 *
 * Same legacy+canonical dual-fetch as useSponsorDashboardData (canonical
 * spread last so it always wins on overlap) — see that hook's doc comment
 * for exactly which fields still have no canonical equivalent and why the
 * legacy RPCs can't be dropped yet.
 */
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
      supabase.rpc("sponsor_canonical_enrollment_progress", { p_cohort_id: cohortId }),
      supabase.rpc("sponsor_canonical_cohort_progress", { p_cohort_id: cohortId }),
      supabase.rpc("sponsor_min_leaders_for_distribution"),
    ]).then(([summaryRes, cohortRes, canonicalRowsRes, canonicalCohortRes, thresholdRes]) => {
      if (!mounted) return;
      const canonicalById = new Map((Array.isArray(canonicalRowsRes.data) ? canonicalRowsRes.data : []).map((row) => [row.enrollment_id, row]));
      const rows = (summaryRes.data ?? []).map((row) => ({ ...row, ...canonicalById.get(row.enrollment_id) })) as SponsorRosterRow[];
      const legacyAggregate = cohortRes.data?.[0];
      const aggregate = Array.isArray(canonicalCohortRes.data) && canonicalCohortRes.data[0]
        ? { ...(legacyAggregate ?? {}), ...canonicalCohortRes.data[0] } as SponsorCohortSummary
        : null;
      setMinLeadersForDistribution(thresholdRes.data ?? 0);
      setCohortLabel(aggregate?.cohort_label ?? rows[0]?.cohort_label ?? null);
      setSuppressed(aggregate?.suppressed ?? true);
      if (!mounted) return;
      setRoster(rows);
      setKpis(aggregate);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [cohortId]);

  return { kpis, roster, minLeadersForDistribution, cohortLabel, suppressed, loading };
}