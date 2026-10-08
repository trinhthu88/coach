import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";

export type ActiveEnrollmentContext =
  Database["public"]["Functions"]["learner_enrollment_context"]["Returns"][number];

/**
 * THE learner enrollment resolver. Every learner surface (Dashboard, My
 * Journey, the module pages, the Sessions hub, the sidebar) resolves the
 * signed-in learner's enrollment here -- never by searching the latest cohort,
 * programme membership or user_id on its own:
 *
 *   authenticated user -> the enrollment the server says to SHOW
 *   (learner_display_enrollment): the current one (enrollment_is_ongoing:
 *   active AND inside its dates), else the latest, read-only. `isCurrent`
 *   says whether actions (book, submit, schedule) are offered; when it is
 *   false the page shows ProgrammeReadOnlyBanner. The server refuses those
 *   actions either way.
 *
 * A resolution failure is returned as `error`, never as an empty enrollment,
 * so a page can say what went wrong instead of rendering empty states.
 */
export function useActiveEnrollment() {
  const { user } = useAuth();
  const resolver = useEnrollmentContext(user?.id);
  const enrollmentId = resolver.selectedEnrollment?.id ?? null;
  return {
    userId: user?.id ?? null,
    enrollmentId,
    enrollment: resolver.selectedEnrollment ?? null,
    /** The enrollment actions use (learner_current_enrollment's answer), or null. */
    currentEnrollmentId: resolver.currentEnrollmentId ?? null,
    /** false: show the enrollment read-only (banner, no Book / Submit / Schedule / Resubmit). */
    isCurrent: resolver.isCurrent,
    /** current | paused | ended | upcoming, from the server. */
    displayState: resolver.displayState,
    /** Every enrollment of this learner (active and historical), newest first. */
    ownEnrollmentIds: (resolver.history ?? []).map((e) => e.id),
    /** "selected" | "missing" (no enrollment at all) | "invalid" */
    selectionState: resolver.selectionState,
    loading: resolver.loading,
    error: resolver.loadError?.message ?? resolver.selectionError ?? null,
  };
}

/**
 * What the active enrollment IS (learner_enrollment_context): programme,
 * cohort, organisation, stored/effective status and the effective start/end
 * the canonical engine uses -- one row every learner header can show.
 */
export function useActiveEnrollmentDetails() {
  const active = useActiveEnrollment();
  const query = useQuery({
    queryKey: ["learner-enrollment-context", active.enrollmentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("learner_enrollment_context", { p_enrollment_id: active.enrollmentId as string });
      if (error) throw error;
      return (data?.[0] as ActiveEnrollmentContext | undefined) ?? null;
    },
    enabled: !!active.enrollmentId,
    staleTime: 60_000,
  });
  return {
    ...active,
    details: query.data ?? null,
    loading: active.loading || (!!active.enrollmentId && query.isLoading),
    // Only a RESOLUTION failure is fatal for a page; the details are display
    // extras (organisation name), so their failure is reported separately.
    error: active.error,
    detailsError: query.error ? (query.error as Error).message : null,
  };
}
