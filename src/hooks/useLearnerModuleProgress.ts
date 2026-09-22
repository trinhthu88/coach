import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type LearnerModuleProgressRow = Database["public"]["Functions"]["learner_module_progress"]["Returns"][number];

/**
 * Per-module canonical progress of one enrollment (learner_module_progress →
 * canonical_module_progress → the requirement calendar). The sidebar badges
 * and the module pages read this same projection; nothing counts sessions or
 * child items on the client.
 */
export function useLearnerModuleProgress(enrollmentId: string | null | undefined) {
  const query = useQuery({
    queryKey: ["learner-module-progress", enrollmentId ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("learner_module_progress", {
        p_enrollment_id: enrollmentId as string,
        p_as_of: new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
      return (data ?? []) as LearnerModuleProgressRow[];
    },
    enabled: !!enrollmentId,
    staleTime: 60_000,
  });
  const byModule = Object.fromEntries((query.data ?? []).map((r) => [r.module, r])) as Record<string, LearnerModuleProgressRow>;
  return { rows: query.data ?? [], byModule, loading: query.isLoading, error: query.error as Error | null };
}
