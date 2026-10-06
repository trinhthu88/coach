import { useQuery } from "@tanstack/react-query";
import { assessmentFileUrl } from "@/lib/assessments";

/** A short-lived signed URL for a file in the private assessment bucket (signed for five minutes). */
export function useAssessmentFileUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ["assessment-file-url", path],
    enabled: !!path,
    queryFn: () => assessmentFileUrl(path!),
    staleTime: 4 * 60 * 1000,
  });
}
