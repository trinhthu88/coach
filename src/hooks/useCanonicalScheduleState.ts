import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CanonicalScheduleStateRow {
  module: string;
  required_units: number;
  scheduled_units: number;
  state: "aligned" | "missing_dates" | "surplus_dates" | string;
}

const RPC_BY_VIEWER = {
  learner: "learner_canonical_schedule_state",
  sponsor: "sponsor_canonical_leader_schedule_state",
  admin: "admin_canonical_schedule_state",
} as const;

/**
 * Required (programme) vs scheduled (cohort) units for one enrollment — one
 * backend construction (cohort_programme_schedule_state) behind a role
 * eligibility wrapper. Every role sees the same mismatch state until an
 * Admin reconciles the cohort schedule.
 */
export function useCanonicalScheduleState(viewer: keyof typeof RPC_BY_VIEWER, enrollmentId: string | null | undefined) {
  const query = useQuery({
    queryKey: ["canonical-schedule-state", viewer, enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<CanonicalScheduleStateRow[]> => {
      const { data, error } = await supabase.rpc(RPC_BY_VIEWER[viewer], { p_enrollment_id: enrollmentId as string });
      if (error) throw error;
      return (data ?? []) as CanonicalScheduleStateRow[];
    },
  });
  const rows = query.data ?? [];
  return { rows, mismatches: rows.filter((r) => r.state !== "aligned"), loading: query.isLoading, error: query.error };
}
