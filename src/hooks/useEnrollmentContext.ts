import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  enrollmentQueryKey,
  getEnrollmentHistory,
  getOngoingEnrollment,
  resolveSelectedEnrollment,
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
  const selectedEnrollment = resolveSelectedEnrollment(history, selectedEnrollmentId) ??
    (!selectedEnrollmentId ? ongoingQuery.data ?? null : null);

  return {
    history,
    ongoingEnrollment: ongoingQuery.data ?? null,
    selectedEnrollment,
    selectedEnrollmentId: selectedEnrollment?.id ?? selectedEnrollmentId,
    selectEnrollment: (enrollment: Enrollment | string | null) =>
      setSelectedEnrollmentId(typeof enrollment === "string" ? enrollment : enrollment?.id ?? null),
    enrollmentQueryKey: (resource: string) => enrollmentQueryKey(resource, selectedEnrollment?.id),
    loading: historyQuery.isLoading || ongoingQuery.isLoading,
  };
}
