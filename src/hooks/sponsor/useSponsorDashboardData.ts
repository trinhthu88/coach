import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type HostedEnrollmentSummary = Database["public"]["Functions"]["sponsor_enrollment_summaries"]["Returns"][number];
type HostedCohortSummary = Database["public"]["Functions"]["sponsor_cohort_summaries"]["Returns"][number];
type HostedOrganisationSummary = Database["public"]["Functions"]["sponsor_organisation_summary"]["Returns"][number];
export type SponsorProgressRow = Database["public"]["Functions"]["get_enrollment_progress"]["Returns"][number];

export type SponsorModuleKey = "coaching" | "training" | "peer" | "mentoring" | "triads";

type SponsorModuleFields = {
  coaching_completed_units?: number | null;
  coaching_due_units?: number | null;
  coaching_required_units?: number | null;
  training_completed_units?: number | null;
  training_due_units?: number | null;
  training_required_units?: number | null;
  peer_completed_units?: number | null;
  peer_due_units?: number | null;
  peer_required_units?: number | null;
  mentoring_completed_units?: number | null;
  mentoring_due_units?: number | null;
  mentoring_required_units?: number | null;
  triad_completed_units?: number | null;
  triad_due_units?: number | null;
  triad_required_units?: number | null;
};

type SponsorCohortModuleFields = SponsorModuleFields & {
  coaching_completed_leaders?: number | null;
  training_completed_leaders?: number | null;
  peer_completed_leaders?: number | null;
  mentoring_completed_leaders?: number | null;
  triad_completed_leaders?: number | null;
};

/**
 * The generated database types can contain fields from local migrations that
 * are intentionally not hosted yet. Keep the live RPC shape explicit here so
 * a missing hosted field cannot silently become a rendered zero.
 */
export type SponsorEnrollmentSummary = HostedEnrollmentSummary & SponsorModuleFields & {
  effective_enrollment_status?: Database["public"]["Enums"]["enrollment_status"];
  stored_enrollment_status?: Database["public"]["Enums"]["enrollment_status"];
};
export type SponsorCohortSummary = HostedCohortSummary & SponsorCohortModuleFields;
export type SponsorRosterRow = SponsorEnrollmentSummary;
export type SponsorKpis = HostedOrganisationSummary;
export type SponsorGoalGrowth = {
  hit_target_count: number; meaningful_progress_count: number; just_started_count: number;
  flat_declined_count: number; pct_progressing: number;
};
export type SponsorProgrammeEngagementRow = {
  week_number: number; week_title: string; is_locked: boolean; effective_unlock_date: string | null;
  skill_card_completion_pct: number; quiz_completion_pct: number; quiz_avg_score: number | null;
  reflection_completion_pct: number; triad_completion_pct: number; triad_satisfaction_avg: number | null;
  daily_prompt_response_rate: number;
};
export type SponsorRedFlagRow = { full_name: string; missed_prompts: number; missed_quizzes: number; missed_triads: number; days_since_last_activity: number };
export type SponsorSatisfactionTrendRow = { week_number: number; avg_rating: number | null };
export type SponsorCoachUtilisationRow = { coach_name: string; completed_sessions: number };

const MODULE_RPC_NAMES: Record<SponsorModuleKey, SponsorProgressRow["module"]> = {
  coaching: "coaching",
  training: "training",
  peer: "peer_coaching",
  mentoring: "mentoring",
  triads: "triads",
};

function progressForModule(progress: SponsorProgressRow[], key: SponsorModuleKey) {
  return progress.find((row) => row.module === MODULE_RPC_NAMES[key]) ?? null;
}

export function applyModuleProgress(row: HostedEnrollmentSummary, progress: SponsorProgressRow[]): SponsorRosterRow {
  const enriched = { ...row } as SponsorRosterRow;
  (Object.keys(MODULE_RPC_NAMES) as SponsorModuleKey[]).forEach((key) => {
    const module = progressForModule(progress, key);
    (enriched as Record<string, unknown>)[`${key}_completed_units`] = module?.completed_units ?? null;
    (enriched as Record<string, unknown>)[`${key}_due_units`] = module?.due_units ?? null;
    (enriched as Record<string, unknown>)[`${key}_required_units`] = module?.required_units ?? null;
  });
  return enriched;
}

function sumModuleField(rows: SponsorRosterRow[], key: SponsorModuleKey, field: "completed" | "due" | "required") {
  const fieldName = `${key}_${field}_units` as keyof SponsorRosterRow;
  const values = rows.map((row) => row[fieldName] as number | null | undefined);
  return values.some((value) => value != null) ? values.reduce((sum, value) => sum + (value ?? 0), 0) : null;
}

function countCompletedLeaders(rows: SponsorRosterRow[], key: SponsorModuleKey) {
  const completedField = `${key}_completed_units` as keyof SponsorRosterRow;
  const requiredField = `${key}_required_units` as keyof SponsorRosterRow;
  const comparableRows = rows.filter((row) => row[completedField] != null && row[requiredField] != null);
  return comparableRows.length
    ? comparableRows.filter((row) => Number(row[completedField]) >= Number(row[requiredField])).length
    : null;
}

export function applyCohortModuleProgress(summary: HostedCohortSummary, rows: SponsorRosterRow[]): SponsorCohortSummary {
  const enriched = { ...summary } as SponsorCohortSummary;
  (Object.keys(MODULE_RPC_NAMES) as SponsorModuleKey[]).forEach((key) => {
    (enriched as Record<string, unknown>)[`${key}_completed_units`] = sumModuleField(rows, key, "completed");
    (enriched as Record<string, unknown>)[`${key}_due_units`] = sumModuleField(rows, key, "due");
    (enriched as Record<string, unknown>)[`${key}_required_units`] = sumModuleField(rows, key, "required");
    (enriched as Record<string, unknown>)[`${key}_completed_leaders`] = countCompletedLeaders(rows, key);
  });
  return enriched;
}

async function enrichRosterRows(rows: HostedEnrollmentSummary[]) {
  return Promise.all(rows.map(async (row) => {
    const { data, error } = await supabase.rpc("get_enrollment_progress", {
      p_enrollment_id: row.enrollment_id,
    });
    return applyModuleProgress(row, error ? [] : Array.isArray(data) ? data : []);
  }));
}

interface SponsorDashboardData {
  kpis: SponsorKpis | null;
  roster: SponsorEnrollmentSummary[];
  cohortSummaries: SponsorCohortSummary[];
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
  const [roster, setRoster] = useState<SponsorEnrollmentSummary[]>([]);
  const [cohortSummaries, setCohortSummaries] = useState<SponsorCohortSummary[]>([]);
  const [minLeadersForDistribution, setMinLeadersForDistribution] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [{ data: cohorts, error }, { data: organisation }, threshold] = await Promise.all([
        supabase.rpc("sponsor_cohort_summaries"),
        supabase.rpc("sponsor_organisation_summary"),
        supabase.rpc("sponsor_min_leaders_for_distribution"),
      ]);
      if (!mounted) return;
      if (error) { setLoading(false); return; }
      setMinLeadersForDistribution(threshold.data ?? 0);
      const visibleCohorts = (cohorts ?? []).filter((cohort) => !cohort.suppressed);
       const rosterResults = await Promise.all(
        visibleCohorts.map((cohort) =>
          supabase.rpc("sponsor_enrollment_summaries", { p_cohort_id: cohort.cohort_id })
        )
      );
       const rosterRows = await enrichRosterRows(
         rosterResults.flatMap((result) => result.error ? [] : result.data ?? [])
       );
       if (!mounted) return;
       const rowsByCohort = new Map<string, SponsorRosterRow[]>();
       rosterRows.forEach((row) => {
         const cohortRows = rowsByCohort.get(row.cohort_id) ?? [];
         cohortRows.push(row);
         rowsByCohort.set(row.cohort_id, cohortRows);
       });
       setCohortSummaries((cohorts ?? []).map((cohort) => applyCohortModuleProgress(cohort, rowsByCohort.get(cohort.cohort_id) ?? [])));
       setRoster(rosterRows);
      const summary = organisation?.[0];
      setKpis(summary ?? null);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return {
    kpis, roster, cohortSummaries, minLeadersForDistribution, loading,
  };
}
