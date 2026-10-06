import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseAssessmentFiles, type AssessmentFile, type AssessmentKind, type AssessmentOutcome } from "@/lib/assessments";

/**
 * Released assessment feedback for one enrollment, from
 * learner_assessment_feedback ONLY: the latest approved review of each
 * released submission (rule 7). Unapproved versions, return reasons and
 * in-progress reviews never reach this hook; the quiz score is released with
 * the feedback.
 */

export const LEARNER_ASSESSMENT_FEEDBACK_KEY = "learner-assessment-feedback";

export interface LearnerAssessmentFeedback {
  submissionId: string;
  kind: AssessmentKind;
  requirementId: string;
  requirementOrdinal: number | null;
  attemptNo: number;
  submittedAt: string;
  releasedAt: string;
  viewedAt: string | null;
  assessorName: string;
  feedbackText: string | null;
  outcome: AssessmentOutcome | null;
  files: AssessmentFile[];
  quizCorrect: number | null;
  quizTotal: number | null;
  quizScorePct: number | null;
}

export function useLearnerAssessmentFeedback(enrollmentId: string | null | undefined) {
  const query = useQuery({
    queryKey: [LEARNER_ASSESSMENT_FEEDBACK_KEY, enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<LearnerAssessmentFeedback[]> => {
      const { data, error } = await supabase.rpc("learner_assessment_feedback", { p_enrollment_id: enrollmentId! });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        submissionId: r.submission_id,
        kind: r.kind as AssessmentKind,
        requirementId: r.requirement_id,
        requirementOrdinal: r.requirement_ordinal ?? null,
        attemptNo: r.attempt_no,
        submittedAt: r.submitted_at,
        releasedAt: r.released_at,
        viewedAt: r.viewed_at ?? null,
        assessorName: r.assessor_name,
        feedbackText: r.feedback_text ?? null,
        outcome: (r.outcome as AssessmentOutcome | null) ?? null,
        files: parseAssessmentFiles(r.feedback_files),
        quizCorrect: r.quiz_correct ?? null,
        quizTotal: r.quiz_total ?? null,
        quizScorePct: r.quiz_score_pct ?? null,
      }));
    },
  });
  return { feedback: query.data ?? [], loading: query.isLoading, error: query.isError };
}

/** Records the first time the learner sees released feedback (server clock; idempotent). */
export function useMarkFeedbackViewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (submissionId: string) => {
      const { error } = await supabase.rpc("learner_mark_feedback_viewed", { p_submission_id: submissionId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [LEARNER_ASSESSMENT_FEEDBACK_KEY] }),
  });
}
