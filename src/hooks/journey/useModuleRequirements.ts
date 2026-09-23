import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type ModuleType = Database["public"]["Enums"]["programme_module_type"];

export interface ModuleNextRequirement {
  ordinal: number;
  dueOn: string;
  /** A session is already booked / proposed for it (not yet held). */
  bookedOn: string | null;
  /** Its due date has passed (due today is not overdue) and it is not fulfilled -- canonical is_overdue. */
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

/** One canonical calendar row (learner_requirement_calendar), with the
 * requirement's booking from learner_module_requirements. */
export interface CanonicalRequirementRow {
  requirement_id: string | null;
  requirement_index: number;
  due_on: string | null;
  is_completed: boolean;
  is_overdue: boolean;
  booked_on: string | null;
}

/**
 * The first requirement the canonical calendar does not count as completed,
 * in order. Completion and overdue are the database's (window, freeze and
 * "overdue after the due date, not on it" included), never recomputed here,
 * so this flag cannot disagree with the overdue count beside it.
 */
export function nextRequirementOf(rows: CanonicalRequirementRow[]): ModuleNextRequirement | null {
  const next = [...rows]
    .filter((r) => r.due_on)
    .sort((a, b) => a.requirement_index - b.requirement_index)
    .find((r) => !r.is_completed);
  if (!next) return null;
  return { ordinal: next.requirement_index, dueOn: next.due_on!, bookedOn: next.booked_on ?? null, overdue: next.is_overdue };
}

/**
 * One module's canonical requirement state for the learner's own enrollment:
 * counts (required / completed / due / overdue / booked) from
 * learner_module_progress -- the same canonical_module_progress row Dashboard,
 * Sponsor and Admin read -- and the next requirement from the canonical
 * calendar (learner_requirement_calendar), with its booking from
 * learner_module_requirements.
 */
export function useModuleRequirements(enrollmentId: string | null | undefined, module: ModuleType) {
  const query = useQuery({
    queryKey: ["module-requirements", enrollmentId, module],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<ModuleRequirementState> => {
      // The learner's local calendar day, not the UTC one.
      const today = format(new Date(), "yyyy-MM-dd");
      const [progress, calendar, requirements] = await Promise.all([
        supabase.rpc("learner_module_progress", { p_enrollment_id: enrollmentId!, p_as_of: today }),
        supabase.rpc("learner_requirement_calendar", { p_enrollment_id: enrollmentId!, p_as_of: today }),
        supabase.rpc("learner_module_requirements", { p_enrollment_id: enrollmentId! }),
      ]);
      if (progress.error) throw progress.error;
      if (calendar.error) throw calendar.error;
      if (requirements.error) throw requirements.error;
      const row = (progress.data ?? []).find((r) => r.module === module) ?? null;
      const bookedOn = new Map(
        (requirements.data ?? []).filter((r) => r.module === module).map((r) => [r.requirement_id, r.booked_on]),
      );
      const reqs = (calendar.data ?? [])
        .filter((r) => r.module === module)
        .map((r) => ({
          requirement_id: r.requirement_id,
          requirement_index: r.requirement_index,
          due_on: r.due_on,
          is_completed: r.is_completed,
          is_overdue: r.is_overdue,
          booked_on: (r.requirement_id && bookedOn.get(r.requirement_id)) ?? null,
        }));
      return {
        required: row?.required_units ?? null,
        completed: row?.completed_units ?? null,
        due: row?.due_units ?? null,
        overdue: row?.overdue_units ?? null,
        booked: row?.booked_units ?? null,
        paceStatus: row?.pace_status ?? null,
        next: nextRequirementOf(reqs),
      };
    },
  });
  return {
    state: query.data ?? null,
    loading: !!enrollmentId && query.isLoading,
    error: query.error ? (query.error as { message?: string }).message ?? "error" : null,
  };
}
