import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import type { ProgrammeInfo } from "./types";

interface JourneyProgrammeData {
  programme: ProgrammeInfo | null;
  /** Canonical Coaching programme progress, the same reader every role uses. */
  coaching: {
    requiredUnits: number;
    completedUnits: number;
    bookedUnits: number;
    dueUnits: number;
    overdueUnits: number;
    postSessionPending: number;
  } | null;
}

async function fetchJourneyProgramme(coacheeId: string, enrollmentId: string): Promise<JourneyProgrammeData> {
  const [
    { data: e, error: enrollmentError },
    { data: progressRows, error: progressError },
    { data: checklistRows },
  ] = await Promise.all([
    supabase
      .from("programme_enrollments")
      .select("id, start_date, end_date, programme_id, programmes(name, duration_months), cohorts(name)")
      .eq("id", enrollmentId)
      .maybeSingle(),
    supabase.rpc("learner_module_progress", {
      p_enrollment_id: enrollmentId,
    }),
    supabase.rpc("coaching_post_session_checklist", { p_enrollment_id: enrollmentId }),
  ]);
  if (enrollmentError) throw enrollmentError;

  const programme: ProgrammeInfo | null =
    e && e.programmes
      ? {
          enrollmentId: e.id,
          programmeName: e.programmes.name,
          cohortName: e.cohorts?.name ?? null,
          startDate: e.start_date,
          endDate: e.end_date,
          durationMonths: e.programmes.duration_months ?? 0,
        }
      : null;

  // A failed canonical read is an error, never a silent zero.
  if (progressError) throw progressError;
  const coachingRow = (progressRows ?? []).find((r) => r.module === "coaching");
  const coaching = coachingRow
    ? {
        requiredUnits: coachingRow.required_units,
        completedUnits: coachingRow.completed_units,
        bookedUnits: coachingRow.booked_units,
        dueUnits: coachingRow.due_units,
        overdueUnits: coachingRow.overdue_units,
        postSessionPending: (checklistRows ?? []).filter((c) => !c.evidence_complete).length,
      }
    : null;

  return { programme, coaching };
}

/**
 * Owns the active programme enrollment and its canonical Coaching progress for
 * a coachee. Shared between the coachee and coach "my journey" views.
 */
export function useJourneyProgramme(coacheeId: string | undefined, initialEnrollmentId?: string | null) {
  const queryClient = useQueryClient();
  const enrollmentContext = useEnrollmentContext(coacheeId, initialEnrollmentId);
  const enrollmentId = enrollmentContext.selectedEnrollment?.id;
  const queryKey = ["journey-programme", coacheeId, enrollmentId ?? null];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchJourneyProgramme(coacheeId as string, enrollmentId as string),
    enabled: !!coacheeId && !!enrollmentId,
    staleTime: 30_000,
  });

  return {
    programme: data?.programme ?? null,
    coaching: data?.coaching ?? null,
    loading: enrollmentContext.loading || (!!enrollmentId && isLoading),
    /** learner_display_enrollment: false when the shown enrollment is read-only. */
    isCurrent: enrollmentContext.isCurrent,
    displayState: enrollmentContext.displayState,
    error,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
  };
}
