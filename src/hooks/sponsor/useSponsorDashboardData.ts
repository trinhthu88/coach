import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type HostedCanonicalEnrollment = Database["public"]["Functions"]["sponsor_canonical_enrollment_metadata"]["Returns"][number];
type HostedCanonicalCohort = Database["public"]["Functions"]["sponsor_canonical_cohort_progress"]["Returns"][number];
type HostedCanonicalOrganisation = Database["public"]["Functions"]["sponsor_canonical_organisation_progress"]["Returns"][number];

export type SponsorEnrollmentSummary = HostedCanonicalEnrollment;
export type SponsorCohortSummary = HostedCanonicalCohort;
export type SponsorRosterRow = SponsorEnrollmentSummary;
export type SponsorKpis = HostedCanonicalOrganisation;
export type SponsorGoalGrowth = {
  hit_target_count: number; meaningful_progress_count: number; just_started_count: number;
  flat_declined_count: number; pct_progressing: number;
};
export type SponsorSatisfactionTrendRow = { week_number: number; avg_rating: number | null };
export type SponsorCoachUtilisationRow = { coach_name: string; completed_sessions: number };

interface SponsorDashboardData {
  kpis: SponsorKpis | null;
  roster: SponsorEnrollmentSummary[];
  cohortSummaries: SponsorCohortSummary[];
  minLeadersForDistribution: number;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useSponsorDashboardData(): SponsorDashboardData {
  const [kpis, setKpis] = useState<SponsorKpis | null>(null);
  const [roster, setRoster] = useState<SponsorEnrollmentSummary[]>([]);
  const [cohortSummaries, setCohortSummaries] = useState<SponsorCohortSummary[]>([]);
  const [minLeadersForDistribution, setMinLeadersForDistribution] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [
          { data: canonicalCohorts, error: cohortError },
          { data: canonicalOrganisation, error: organisationError },
          threshold,
        ] = await Promise.all([
          supabase.rpc("sponsor_canonical_cohort_progress"),
          supabase.rpc("sponsor_canonical_organisation_progress"),
          supabase.rpc("sponsor_min_leaders_for_distribution"),
        ]);
        if (!mounted) return;
        if (
          cohortError ||
          organisationError ||
          threshold.error ||
          !Array.isArray(canonicalCohorts) ||
          !Array.isArray(canonicalOrganisation) ||
          canonicalOrganisation.length === 0
        ) {
          console.error("Sponsor dashboard canonical data failed to load", {
            cohortError,
            organisationError,
            thresholdError: threshold.error,
          });
          setError("core");
          setLoading(false);
          return;
        }
        setMinLeadersForDistribution(threshold.data ?? 0);
        const cohorts = canonicalCohorts as SponsorCohortSummary[];
        const visibleCohorts = cohorts.filter((cohort) => !cohort.suppressed);
        const rosterResults = await Promise.all(visibleCohorts.map(async (cohort) => {
          const { data, error: metadataError } = await supabase.rpc("sponsor_canonical_enrollment_metadata", {
            p_cohort_id: cohort.cohort_id,
          });
          if (metadataError || !Array.isArray(data)) {
            console.error("Sponsor dashboard enrollment metadata failed to load", {
              cohortId: cohort.cohort_id,
              metadataError,
            });
            return { rows: [] as SponsorRosterRow[], failed: true };
          }
          return { rows: data as SponsorRosterRow[], failed: false };
        }));
        if (!mounted) return;
        if (rosterResults.some((result) => result.failed)) {
          setCohortSummaries(cohorts);
          setKpis(canonicalOrganisation[0] as SponsorKpis);
          setError("metadata");
          setLoading(false);
          return;
        }
        setCohortSummaries(cohorts);
        setRoster(rosterResults.flatMap((result) => result.rows));
        setKpis(canonicalOrganisation[0] as SponsorKpis);
        setLoading(false);
      } catch (cause) {
        if (!mounted) return;
        console.error("Sponsor dashboard data request failed", cause);
        setError("core");
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [reloadToken]);

  return {
    kpis,
    roster,
    cohortSummaries,
    minLeadersForDistribution,
    loading,
    error,
    retry: () => setReloadToken((token) => token + 1),
  };
}
