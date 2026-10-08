import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  enrollmentQueryKey,
  getDisplayEnrollment,
  getEnrollmentHistory,
  resolveSelectedEnrollmentResult,
  type Enrollment,
} from "@/lib/enrollments";

export function useEnrollmentContext(userId: string | undefined, initialEnrollmentId?: string | null) {
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string | null>(initialEnrollmentId ?? null);

  useEffect(() => {
    if (initialEnrollmentId !== undefined) setSelectedEnrollmentId(initialEnrollmentId ?? null);
  }, [initialEnrollmentId]);

  const historyQuery = useQuery({
    queryKey: ["enrollment-history", userId],
    queryFn: () => getEnrollmentHistory(userId as string),
    enabled: !!userId,
  });

  // What the pages SHOW is the server's (learner_display_enrollment): the
  // current enrollment (enrollment_is_ongoing), else the latest one, flagged
  // read-only as paused / ended / upcoming. Whether the learner can ACT is its
  // is_current; nothing here reads status or dates.
  const displayQuery = useQuery({
    queryKey: ["display-enrollment", userId],
    queryFn: () => getDisplayEnrollment(),
    enabled: !!userId,
  });
  const display = displayQuery.data ?? null;
  const currentEnrollmentId = display?.isCurrent ? display.enrollmentId : null;

  const history = historyQuery.data ?? [];
  const selection = resolveSelectedEnrollmentResult(history, selectedEnrollmentId, display?.enrollmentId ?? null);
  const selectedEnrollment = selection.kind === "selected" ? selection.enrollment : null;
  // The selected enrollment's standing, as the server gave it. An explicitly
  // selected enrollment other than the displayed one is not current.
  const shown = selectedEnrollment && display && selectedEnrollment.id === display.enrollmentId ? display : null;

  return {
    history,
    currentEnrollmentId,
    /** The selected enrollment is the current one: actions are offered. */
    isCurrent: selectedEnrollment ? selectedEnrollment.id === currentEnrollmentId : null,
    /** current | paused | ended | upcoming (learner_display_enrollment); null when unknown. */
    displayState: shown?.displayState ?? null,
    selectedEnrollment,
    selectedEnrollmentId: selectedEnrollment?.id ?? selectedEnrollmentId,
    selectionState: selection.kind,
    selectionError: selection.kind === "invalid" ? `Enrollment ${selection.enrollmentId} was not found.` : null,
    selectEnrollment: (enrollment: Enrollment | string | null) =>
      setSelectedEnrollmentId(typeof enrollment === "string" ? enrollment : enrollment?.id ?? null),
    enrollmentQueryKey: (resource: string) => enrollmentQueryKey(resource, selectedEnrollment?.id),
    loading: historyQuery.isLoading || displayQuery.isLoading,
    /** A failed read is an error, never "no enrollment" (learner pages must not render empty states for it). */
    loadError: (historyQuery.error ?? displayQuery.error ?? null) as Error | null,
  };
}
