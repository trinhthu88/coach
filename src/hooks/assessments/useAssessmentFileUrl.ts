import { useQuery } from "@tanstack/react-query";
import { ASSESSMENT_FILE_URL_SECONDS, assessmentFileUrl } from "@/lib/assessments";

/**
 * A signed URL for a file in the private assessment bucket. Documents are
 * signed for five minutes; a recording passes recordingUrlSeconds(length) so
 * the link outlives the listening. The cached URL is refreshed a minute
 * before it would expire.
 */
export function useAssessmentFileUrl(path: string | null | undefined, expiresIn = ASSESSMENT_FILE_URL_SECONDS) {
  return useQuery({
    queryKey: ["assessment-file-url", path, expiresIn],
    enabled: !!path,
    queryFn: () => assessmentFileUrl(path!, expiresIn),
    staleTime: Math.max(expiresIn - 60, 30) * 1000,
  });
}
