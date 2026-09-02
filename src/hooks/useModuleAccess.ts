import { useProgrammeModules, ProgrammeModuleType } from "./useProgrammeModules";

/**
 * Whether the current user's active programme includes the given module.
 * Delegates to useProgrammeModules() — see that hook and
 * get_my_programme_modules() for the underlying programme_modules gating.
 * Kept as a thin wrapper so ProtectedRoute's `module="mentoring"` prop and
 * other existing callers didn't need to change.
 */
export function useModuleAccess(module: string) {
  const { hasModule, loading } = useProgrammeModules();
  return {
    enabled: hasModule(module as ProgrammeModuleType),
    loading,
  };
}
