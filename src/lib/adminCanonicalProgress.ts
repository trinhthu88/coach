import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Admin's read of THE canonical completion engine
 * (admin_canonical_enrollment_progress → canonical_enrollment_progress) —
 * the same per-enrollment numbers Learner and Sponsor receive. Admin
 * aggregates (averages, counts) are computed over these rows; no Admin
 * screen calculates completion, adherence, overdue or status itself.
 */
export type AdminCanonicalProgressRow =
  Database["public"]["Functions"]["admin_canonical_enrollment_progress"]["Returns"][number];

export async function fetchAdminCanonicalProgress(enrollmentIds: string[]): Promise<AdminCanonicalProgressRow[]> {
  if (enrollmentIds.length === 0) return [];
  const { data, error } = await supabase.rpc("admin_canonical_enrollment_progress", { p_enrollment_ids: enrollmentIds });
  if (error) throw error;
  return data ?? [];
}

/** Mean of the canonical full_completion_pct across enrollments that have progress. */
export function averageCanonicalCompletion(rows: AdminCanonicalProgressRow[]): number {
  const values = rows
    .filter((r) => r.progress_available && r.full_completion_pct != null)
    .map((r) => Number(r.full_completion_pct));
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Enrollments at risk by the canonical EFFECTIVE status (the status Learner and Sponsor see). */
export function canonicalAtRisk(rows: AdminCanonicalProgressRow[]): AdminCanonicalProgressRow[] {
  return rows.filter((r) => r.effective_enrollment_status === "at_risk");
}
