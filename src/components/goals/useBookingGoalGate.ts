import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseGoalGate, type GoalGateState } from "@/lib/goalGate";

export const BOOKING_GOAL_GATE_QUERY_KEY = "booking-goal-gate";

/**
 * Reads the server's booking goal gate (public.enrollment_goal_gate) for one
 * enrollment. The same rule every booking RPC enforces — never recomputed here.
 * A failed read leaves the gate open: the server still refuses a gated booking,
 * and that rejection is mapped to the same message (getFriendlyErrorMessage).
 */
export function useBookingGoalGate(enrollmentId: string | null | undefined) {
  const query = useQuery({
    queryKey: [BOOKING_GOAL_GATE_QUERY_KEY, enrollmentId],
    enabled: !!enrollmentId,
    staleTime: 30_000,
    queryFn: async (): Promise<GoalGateState | null> => {
      const { data, error } = await supabase.rpc("enrollment_goal_gate", {
        p_enrollment_id: enrollmentId as string,
      });
      if (error) throw error;
      return parseGoalGate(data);
    },
  });
  return {
    gate: query.data ?? null,
    blocked: query.data?.blocked === true,
    loading: query.isLoading,
  };
}
