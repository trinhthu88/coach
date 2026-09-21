import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type ModuleType = Database["public"]["Enums"]["programme_module_type"];

export interface ModuleNextRequirement {
  ordinal: number;
  dueOn: string;
  /** A session is already booked / proposed for it (not yet held). */
  bookedOn: string | null;
  /** Its deadline has been reached (due today or earlier) and it is not fulfilled. */
  overdue: boolean;
}

export interface ModuleRequirementState {
  required: number | null;
  completed: number | null;
  due: number | null;
  overdue: number | null;
  booked: number | null;
  paceStatus: string | null;
  next: ModuleNextRequirement | null;
}

/** The first requirement not yet fulfilled, in ordinal order. */
export function nextRequirementOf(
  rows: { ordinal: number; due_on: string; fulfilled_on: string | null; booked_on: string | null }[],
  today = new Date().toISOString().slice(0, 10),
): ModuleNextRequirement | null {
  const next = [...rows].sort((a, b) => a.ordinal - b.ordinal).find((r) => !r.fulfilled_on);
  if (!next) return null;
  // Same rule as canonical_module_progress (due_on <= as_of, unmet => overdue),
  // so this flag never disagrees with the overdue count beside it.
  return { ordinal: next.ordinal, dueOn: next.due_on, bookedOn: next.booked_on ?? null, overdue: next.due_on <= today };
}

/**
 * One module's canonical requirement state for the learner's own enrollment:
 * counts (required / completed / due / overdue / booked) from
 * learner_module_progress -- the same canonical_module_progress row Dashboard,
 * Sponsor and Admin read -- and the next requirement with its deadline from
 * learner_module_requirements (the four canonical fulfilment functions).
 */
export function useModuleRequirements(enrollmentId: string | null | undefined, module: ModuleType) {
  const query = useQuery({
    queryKey: ["module-requirements", enrollmentId, module],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<ModuleRequirementState> => {
      const today = new Date().toISOString().slice(0, 10);
      const [progress, requirements] = await Promise.all([
        supabase.rpc("learner_module_progress", { p_enrollment_id: enrollmentId!, p_as_of: today }),
        supabase.rpc("learner_module_requirements", { p_enrollment_id: enrollmentId! }),
      ]);
      if (progress.error) throw progress.error;
      if (requirements.error) throw requirements.error;
      const row = (progress.data ?? []).find((r) => r.module === module) ?? null;
      const reqs = (requirements.data ?? []).filter((r) => r.module === module);
      return {
        required: row?.required_units ?? null,
        completed: row?.completed_units ?? null,
        due: row?.due_units ?? null,
        overdue: row?.overdue_units ?? null,
        booked: row?.booked_units ?? null,
        paceStatus: row?.pace_status ?? null,
        next: nextRequirementOf(reqs, today),
      };
    },
  });
  return {
    state: query.data ?? null,
    loading: !!enrollmentId && query.isLoading,
    error: query.error ? (query.error as { message?: string }).message ?? "error" : null,
  };
}
