import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

/**
 * Whether the current user has been granted access to an admin-gated module
 * (currently only "mentoring"). Defaults to disabled until the RPC resolves
 * or if no user_module_access row exists — see has_module_access() /
 * RULES.md's module-access section.
 */
export function useModuleAccess(module: string) {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["module-access", module, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("check_has_module_access", { p_module: module });
      if (error) throw error;
      return !!data;
    },
    enabled: !!user && !!module,
    staleTime: 60_000,
  });

  return { enabled: !!data, loading: !!user && isLoading };
}
