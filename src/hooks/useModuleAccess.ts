import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules, ProgrammeModuleType } from "./useProgrammeModules";

/**
 * Whether the current user may open a module's workspace.
 *
 * A learner: their active programme includes the module (useProgrammeModules,
 * the same gating as has_programme_module()). Mentoring also opens to a Coach
 * who is a MENTOR -- an active cohort_mentors row (is_active_cohort_mentor,
 * 20261006200000) -- whether or not they are enrolled themselves, so a Mentor
 * reaches the mentoring sessions they give.
 */
export function useModuleAccess(module: string) {
  const { role } = useAuth();
  const { hasModule, loading } = useProgrammeModules();
  const checkMentor = module === "mentoring" && role === "coach";
  const mentor = useQuery({
    queryKey: ["is-active-cohort-mentor"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_active_cohort_mentor");
      if (error) throw error;
      return data === true;
    },
    enabled: checkMentor,
    staleTime: 60_000,
  });
  return {
    enabled: hasModule(module as ProgrammeModuleType) || (checkMentor && mentor.data === true),
    loading: loading || (checkMentor && mentor.isLoading),
  };
}
