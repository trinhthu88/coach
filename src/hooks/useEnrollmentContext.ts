import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  enrollmentQueryKey,
  getCurrentEnrollmentId,
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

  // THE current enrollment is the server's (learner_current_enrollment, on
  // enrollment_is_ongoing): a paused or past-end enrollment is not current.
  const currentQuery = useQuery({
    queryKey: ["current-enrollment", userId],
    queryFn: () => getCurrentEnrollmentId(),
    enabled: !!userId,
  });

  const history = historyQuery.data ?? [];
  const selection = resolveSelectedEnrollmentResult(history, selectedEnrollmentId, currentQuery.data ?? null);
  const selectedEnrollment = selection.kind === "selected" ? selection.enrollment : null;

  return {
    history,
    currentEnrollmentId: currentQuery.data ?? null,
    selectedEnrollment,
    selectedEnrollmentId: selectedEnrollment?.id ?? selectedEnrollmentId,
    selectionState: selection.kind,
    selectionError: selection.kind === "invalid" ? `Enrollment ${selection.enrollmentId} was not found.` : null,
    selectEnrollment: (enrollment: Enrollment | string | null) =>
      setSelectedEnrollmentId(typeof enrollment === "string" ? enrollment : enrollment?.id ?? null),
    enrollmentQueryKey: (resource: string) => enrollmentQueryKey(resource, selectedEnrollment?.id),
    loading: historyQuery.isLoading || currentQuery.isLoading,
    /** A failed read is an error, never "no enrollment" (learner pages must not render empty states for it). */
    loadError: (historyQuery.error ?? currentQuery.error ?? null) as Error | null,
  };
}
