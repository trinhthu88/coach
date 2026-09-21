import { supabase } from "@/integrations/supabase/client";

/**
 * Satisfaction is ONE aggregate: every 1–5 rating a learner submitted on a
 * completed session of ANY module (Coaching, Peer Coaching, Mentoring,
 * Triads), from canonical_enrollment_satisfaction. Only numbers ever leave
 * the session pair — never the narrative. Clients never average raw session
 * rating columns themselves.
 */
export interface SatisfactionRow {
  rated_count: number;
  rating_sum: number;
  /** Counts of 1..5 ratings, index 0 = rating 1. */
  rating_counts: number[];
}

export interface SatisfactionSummary {
  ratedCount: number;
  /** Mean on the 1–5 scale; null when nothing has been rated. */
  average: number | null;
  /** Counts of 1..5 ratings, index 0 = rating 1. */
  distribution: [number, number, number, number, number];
}

export function aggregateSatisfaction(rows: readonly SatisfactionRow[]): SatisfactionSummary {
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let ratedCount = 0;
  let sum = 0;
  for (const row of rows) {
    ratedCount += row.rated_count;
    sum += row.rating_sum;
    row.rating_counts.slice(0, 5).forEach((count, i) => {
      distribution[i] += count;
    });
  }
  return { ratedCount, average: ratedCount ? sum / ratedCount : null, distribution };
}

/** Admin: the aggregate over the given enrollments (all four modules). */
export async function fetchAdminSatisfaction(enrollmentIds: string[]): Promise<SatisfactionSummary> {
  if (enrollmentIds.length === 0) return aggregateSatisfaction([]);
  const { data, error } = await supabase.rpc("admin_enrollment_satisfaction", { p_enrollment_ids: enrollmentIds });
  if (error) throw error;
  return aggregateSatisfaction(data ?? []);
}
