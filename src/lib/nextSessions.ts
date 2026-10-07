import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * The next session per module is one SQL construction
 * (canonical_next_session_by_module over canonical_session_history,
 * 20261007001100): per module -- coach-pool practice apart -- the earliest
 * requested, confirmed or proposed session still ahead. Dashboard cards read
 * it through these two wrappers and only render the row.
 */
export type LearnerNextSession =
  Database["public"]["Functions"]["learner_next_session_by_module"]["Returns"][number];
export type CoachNextSession =
  Database["public"]["Functions"]["coach_next_session_by_module"]["Returns"][number];
type Module = Database["public"]["Enums"]["programme_module_type"];

/** The learner's own (coach-as-learner too), for one enrollment. */
export async function fetchLearnerNextSessions(enrollmentId: string): Promise<LearnerNextSession[]> {
  const { data, error } = await supabase.rpc("learner_next_session_by_module", { p_enrollment_id: enrollmentId });
  if (error) throw error;
  return data ?? [];
}

/** The sessions the calling Coach delivers, across their learners. */
export async function fetchCoachNextSessions(): Promise<CoachNextSession[]> {
  const { data, error } = await supabase.rpc("coach_next_session_by_module");
  if (error) throw error;
  return data ?? [];
}

export function pickModule<T extends { module: Module; is_practice: boolean }>(
  rows: T[],
  module: Module,
  practice = false,
): T | null {
  return rows.find((r) => r.module === module && r.is_practice === practice) ?? null;
}
