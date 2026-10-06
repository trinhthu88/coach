import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { canonicalCompletionPct } from "@/lib/programmeProfile";

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

/**
 * Admin's completion rate across enrollments, summed like Sponsor's: completed
 * units over required units (admin_canonical_completion_rate, 20261006200000).
 * Never a mean of per-enrollment percentages.
 */
export async function fetchAdminCompletionRate(enrollmentIds: string[]): Promise<number | null> {
  if (enrollmentIds.length === 0) return null;
  const { data, error } = await supabase.rpc("admin_canonical_completion_rate", { p_enrollment_ids: enrollmentIds });
  if (error) throw error;
  // null = nothing required yet: never shown as 0%.
  return canonicalCompletionPct(data?.[0]?.full_completion_pct);
}

/** Enrollments at risk by the canonical EFFECTIVE status (the status Learner and Sponsor see). */
export function canonicalAtRisk(rows: AdminCanonicalProgressRow[]): AdminCanonicalProgressRow[] {
  return rows.filter((r) => r.effective_enrollment_status === "at_risk");
}

/** One module of the canonical enrollment row: units completed of units required. */
export interface CanonicalModuleUnits {
  completed: number;
  required: number;
}

/**
 * The canonical row's Coaching or Peer units. Null when the enrollment has no
 * canonical progress (no enrollment, or progress unavailable) -- never a
 * default allowance.
 */
export function canonicalModuleUnits(
  row: AdminCanonicalProgressRow | null | undefined,
  module: "coaching" | "peer",
): CanonicalModuleUnits | null {
  if (!row || !row.progress_available) return null;
  return module === "coaching"
    ? { completed: row.coaching_completed_units, required: row.coaching_required_units }
    : { completed: row.peer_completed_units, required: row.peer_required_units };
}

export function formatModuleUnits(units: CanonicalModuleUnits | null): string {
  return units ? `${units.completed} / ${units.required}` : "—";
}
