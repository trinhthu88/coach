import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type EnrollmentProgressModule =
  Database["public"]["Functions"]["get_enrollment_progress"]["Returns"][number];

async function fetchEnrollmentProgress(enrollmentId: string, asOf?: string) {
  const { data, error } = await supabase.rpc("get_enrollment_progress", {
    p_enrollment_id: enrollmentId,
    ...(asOf ? { p_as_of: asOf } : {}),
  });
  if (error) throw error;
  return data ?? [];
}

export function useEnrollmentProgress(enrollmentId?: string, asOf?: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["enrollment-progress", enrollmentId ?? null, asOf ?? null],
    queryFn: () => fetchEnrollmentProgress(enrollmentId as string, asOf),
    enabled: !!enrollmentId,
    staleTime: 30_000,
  });

  return {
    modules: (data ?? []) as EnrollmentProgressModule[],
    loading: !!enrollmentId && isLoading,
    error,
  };
}
