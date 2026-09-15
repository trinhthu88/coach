import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";

export type ProgrammeModuleType =
  | "coaching"
  | "peer_coaching"
  | "mentoring"
  | "triads"
  | "training"
  | "quiz"
  | "assessment"
  | "daily_prompt";

interface ProgrammeModule {
  module: ProgrammeModuleType;
  enabled: boolean;
  config: Record<string, unknown>;
}

export function useProgrammeModules() {
  const { user, role } = useAuth();
  const { selectedEnrollment, selectedEnrollmentId, loading: enrollmentLoading } = useEnrollmentContext(user?.id);

  const { data, isLoading } = useQuery({
    queryKey: ["programme-modules", user?.id, selectedEnrollmentId ?? null],
    queryFn: async () => {
      if (!selectedEnrollmentId) return [];
      const { data, error } = await supabase.rpc("get_enrollment_programme_modules", {
        p_enrollment_id: selectedEnrollmentId,
      });
      if (error) throw error;
      return (data ?? []) as ProgrammeModule[];
    },
    enabled: !!user && !!selectedEnrollmentId && role !== "admin" && role !== "sponsor",
    staleTime: 60_000,
  });

  const modules = data ?? [];

  const hasModule = (mod: ProgrammeModuleType) =>
    modules.some((m) => m.module === mod && m.enabled);

  const hasDirection = (mod: ProgrammeModuleType, direction: "give" | "receive") => {
    const m = modules.find((x) => x.module === mod && x.enabled);
    if (!m) return false;
    return (m.config as Record<string, boolean>)?.[direction] === true;
  };

  const getConfig = (mod: ProgrammeModuleType) =>
    modules.find((m) => m.module === mod)?.config ?? {};

  return {
    modules,
    loading: !!user && (enrollmentLoading || isLoading),
    enrollmentId: selectedEnrollment?.id ?? selectedEnrollmentId ?? null,
    enrollmentLoading,
    hasModule,
    hasDirection,
    getConfig,
    noProgramme: !isLoading && modules.length === 0,
  };
}
