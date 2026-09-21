import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import type { ProgrammeInfo, SessionUsage } from "./types";

interface JourneyProgrammeData {
  programme: ProgrammeInfo | null;
  /**
   * Operational session usage only. This counts raw session rows, so it must
   * never be used as programme progress (a completed session = a fulfilled
   * requirement unit, counted by the canonical engine). Use `coaching` below.
   */
  usage: SessionUsage | null;
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
    { data: u, error: usageError },
    { data: e, error: enrollmentError },
    { data: progressRows, error: progressError },
    { data: checklistRows },
  ] = await Promise.all([
    supabase.rpc("get_coachee_session_usage_for_enrollment", {
      p_enrollment_id: enrollmentId,
    }),
    supabase
      .from("programme_enrollments")
      .select("id, start_date, end_date, programme_id, programmes(name, coachee_session_limit, duration_months), cohorts(name)")
      .eq("id", enrollmentId)
      .maybeSingle(),
    supabase.rpc("learner_module_progress", {
      p_enrollment_id: enrollmentId,
      p_as_of: new Date().toISOString().slice(0, 10),
    }),
    supabase.rpc("coaching_post_session_checklist", { p_enrollment_id: enrollmentId }),
  ]);
  if (usageError) throw usageError;
  if (enrollmentError) throw enrollmentError;
  const usageRow = Array.isArray(u) ? u[0] : u;

  const programme: ProgrammeInfo | null =
    e && e.programmes
      ? {
          enrollmentId: e.id,
          programmeName: e.programmes.name,
          cohortName: e.cohorts?.name ?? null,
          startDate: e.start_date,
          endDate: e.end_date,
          sessionsAllowed: e.programmes.coachee_session_limit ?? 0,
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

  return { programme, usage: usageRow ?? null, coaching };
}

/**
 * Owns the active programme enrollment + monthly session usage quota for a
 * coachee. Shared between the coachee and coach "my journey" views.
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
    usage: data?.usage ?? null,
    loading: enrollmentContext.loading || (!!enrollmentId && isLoading),
    error,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
  };
}
