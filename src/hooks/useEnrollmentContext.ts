import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  enrollmentQueryKey,
  getEnrollmentHistory,
  getOngoingEnrollment,
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

  const ongoingQuery = useQuery({
    queryKey: ["ongoing-enrollment", userId],
    queryFn: () => getOngoingEnrollment(userId as string),
    enabled: !!userId,
  });

  const history = historyQuery.data ?? [];
  const selection = resolveSelectedEnrollmentResult(history, selectedEnrollmentId);
  // The fallback query is retained for loading/cache compatibility, but can
  // only select an enrollment when history has exactly one ongoing row.
  const selectedEnrollment = selection.kind === "selected"
    ? selection.enrollment
    : !selectedEnrollmentId && history.length === 0 && ongoingQuery.data
      ? ongoingQuery.data
      : null;

  return {
    history,
    ongoingEnrollment: ongoingQuery.data ?? null,
    selectedEnrollment,
    selectedEnrollmentId: selectedEnrollment?.id ?? selectedEnrollmentId,
    selectionState: selection.kind,
    selectionError: selection.kind === "ambiguous"
      ? "Multiple ongoing programme enrollments require an explicit selection."
      : selection.kind === "invalid"
        ? `Enrollment ${selection.enrollmentId} was not found.`
        : null,
    selectEnrollment: (enrollment: Enrollment | string | null) =>
      setSelectedEnrollmentId(typeof enrollment === "string" ? enrollment : enrollment?.id ?? null),
    enrollmentQueryKey: (resource: string) => enrollmentQueryKey(resource, selectedEnrollment?.id),
    loading: historyQuery.isLoading || ongoingQuery.isLoading,
  };
}
