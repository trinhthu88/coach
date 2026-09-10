import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SponsorKpis, SponsorRosterRow } from "./useSponsorDashboardData";

export interface SponsorCohortData {
  kpis: SponsorKpis | null;
  roster: SponsorRosterRow[];
  minLeadersForDistribution: number;
  cohortLabel: string | null;
  suppressed: boolean;
  loading: boolean;
}

/** Fetches a UUID-scoped, server-authorized sponsor cohort summary. */
export function useSponsorCohortData(cohortId: string): SponsorCohortData {
  const [kpis, setKpis] = useState<SponsorKpis | null>(null);
  const [roster, setRoster] = useState<SponsorRosterRow[]>([]);
  const [cohortLabel, setCohortLabel] = useState<string | null>(null);
  const [suppressed, setSuppressed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      supabase.rpc("sponsor_enrollment_summaries", { p_cohort_id: cohortId }),
      supabase.rpc("sponsor_cohort_summaries", { p_cohort_id: cohortId }),
    ]).then(([summaryRes, cohortRes]) => {
      if (!mounted) return;
      const rows = summaryRes.data ?? [];
      const aggregate = cohortRes.data?.[0];
      setCohortLabel(aggregate?.cohort_label ?? rows[0]?.cohort_label ?? null);
      setSuppressed(aggregate?.suppressed ?? rows.length < 5);
      setRoster(rows.map((r) => ({
        ...r,
        full_name: r.learner_display_name,
        cohort_name: r.cohort_label,
        coachee_id: "",
        goal_growth: null,
        progress_pct: r.due_adherence_pct ?? 0,
        sessions_completed: r.coaching_completed_count,
        sessions_entitled: r.required_units,
      })));
      setKpis(aggregate ? {
        leaders_enrolled: aggregate.enrollment_count,
        enrolled_active_count: rows.filter((r) => r.enrollment_status === "active").length,
        on_track_count: rows.filter((r) => r.pace_status === "on_track").length,
        at_risk_count: rows.filter((r) => r.pace_status === "behind").length,
        sessions_used: aggregate.completed_units ?? 0,
        sessions_entitled: aggregate.required_units ?? 0,
      } : null);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [cohortId]);

  return { kpis, roster, minLeadersForDistribution: 5, cohortLabel, suppressed, loading };
}