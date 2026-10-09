import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * A Coach's held Coaching sessions as the directory shows them:
 * coach_public_delivered_sessions (reported_held_sessions_internal, demo
 * organisations excluded) -- the number Admin -> Registrations shows too.
 * null while unknown (loading or failed), never a guessed 0.
 */
export function useCoachDeliveredSessions(coachId: string | undefined) {
  const query = useQuery({
    queryKey: ["coach-public-delivered-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("coach_public_delivered_sessions");
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.coach_id, row.delivered_sessions]));
    },
    staleTime: 5 * 60_000,
  });
  return {
    deliveredSessions: query.data && coachId ? query.data.get(coachId) ?? 0 : null,
    loading: query.isLoading,
  };
}
