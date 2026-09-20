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
  error: string | null;
  retry: () => void;
}

export function useSponsorCohortData(cohortId: string): SponsorCohortData {
  const [kpis, setKpis] = useState<SponsorCohortSummary | null>(null);
  const [roster, setRoster] = useState<SponsorRosterRow[]>([]);
  const [cohortLabel, setCohortLabel] = useState<string | null>(null);
  const [suppressed, setSuppressed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [minLeadersForDistribution, setMinLeadersForDistribution] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    Promise.all([
      supabase.rpc("sponsor_canonical_enrollment_metadata", { p_cohort_id: cohortId }),
      supabase.rpc("sponsor_canonical_cohort_progress", { p_cohort_id: cohortId }),
      supabase.rpc("sponsor_min_leaders_for_distribution"),
    ]).then(([summaryRes, canonicalCohortRes, thresholdRes]) => {
      if (!mounted) return;
      if (
        summaryRes.error ||
        canonicalCohortRes.error ||
        thresholdRes.error ||
        !Array.isArray(summaryRes.data) ||
        !Array.isArray(canonicalCohortRes.data)
      ) {
        console.error("Sponsor cohort canonical data failed to load", {
          cohortId,
          metadataError: summaryRes.error,
          cohortError: canonicalCohortRes.error,
          thresholdError: thresholdRes.error,
        });
        setError("load");
        setLoading(false);
        return;
      }
      const rows = (Array.isArray(summaryRes.data) ? summaryRes.data : []) as SponsorRosterRow[];
      const aggregate = Array.isArray(canonicalCohortRes.data) && canonicalCohortRes.data[0]
        ? canonicalCohortRes.data[0] as SponsorCohortSummary
        : null;
      setMinLeadersForDistribution(thresholdRes.data ?? 0);
      setCohortLabel(aggregate?.cohort_label ?? rows[0]?.cohort_label ?? null);
      setSuppressed(aggregate?.suppressed ?? true);
      if (!mounted) return;
      setRoster(rows);
      setKpis(aggregate);
      setLoading(false);
    }).catch((cause) => {
      if (!mounted) return;
      console.error("Sponsor cohort data request failed", { cohortId, cause });
      setError("load");
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [cohortId, reloadToken]);

  return {
    kpis,
    roster,
    minLeadersForDistribution,
    cohortLabel,
    suppressed,
    loading,
    error,
    retry: () => setReloadToken((token) => token + 1),
  };
}