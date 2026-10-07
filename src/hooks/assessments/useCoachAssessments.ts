import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ASSESSMENT_FILES_BUCKET,
  FEEDBACK_PDF_MAX_BYTES,
  parseAssessmentFiles,
  type AssessmentFile,
  type AssessmentKind,
  type AssessmentOutcome,
  type AssessmentStatus,
} from "@/lib/assessments";

/**
 * The assessor's side of the review pipeline. Everything is read through
 * coach_assessment_inbox (rule 4: full content only while the assignment is
 * active; afterwards only the coach's own released history) and written
 * through coach_submit_review. The feedback PDF is uploaded first under
 * {enrollment}/{submission}/, which the storage policy allows only to the
 * active assessor, then registered by coach_submit_review.
 */

export const COACH_ASSESSMENT_INBOX_KEY = "coach-assessment-inbox";

export type CoachInboxTab = "to_assess" | "returned" | "awaiting_validation" | "released";
export const COACH_INBOX_TABS: CoachInboxTab[] = ["to_assess", "returned", "awaiting_validation", "released"];

export interface TriadReflectionAnswerView {
  questionId: string;
  section: "coach" | "coachee" | "observer" | "general";
  question: string;
  questionVi: string | null;
  answer: string;
}

export interface CoachInboxRow {
  submissionId: string;
  enrollmentId: string;
  tab: CoachInboxTab;
  kind: AssessmentKind;
  cohortId: string;
  cohortName: string;
  learnerName: string;
  requirementOrdinal: number | null;
  attemptNo: number;
  status: AssessmentStatus;
  submittedAt: string;
  assignedAt: string | null;
  dueOn: string | null;
  isOverdue: boolean;
  /** Learner content: present only while the assignment is active. */
  reflection: { submittedAt: string; answers: TriadReflectionAnswerView[] } | null;
  transcriptText: string | null;
  quizCorrect: number | null;
  quizTotal: number | null;
  quizScorePct: number | null;
  learnerFiles: AssessmentFile[];
  /** Admin's reason, when the review came back. */
  returnReason: string | null;
  myLatestVersion: number | null;
  myLatestFeedbackText: string | null;
  myLatestOutcome: AssessmentOutcome | null;
  releasedAt: string | null;
}

export function useCoachAssessmentInbox(enabled = true) {
  return useQuery({
    queryKey: [COACH_ASSESSMENT_INBOX_KEY],
    enabled,
    queryFn: async (): Promise<CoachInboxRow[]> => {
      const { data, error } = await supabase.rpc("coach_assessment_inbox");
      if (error) throw error;
      return (data ?? []).map((r) => {
        const reflection = r.reflection as
          | { submitted_at: string; answers: { question_id: string; section: TriadReflectionAnswerView["section"]; question: string; question_vi: string | null; answer: string }[] }
          | null;
        return {
          submissionId: r.submission_id,
          enrollmentId: r.enrollment_id,
          tab: r.inbox_tab as CoachInboxTab,
          kind: r.kind as AssessmentKind,
          cohortId: r.cohort_id,
          cohortName: r.cohort_name,
          learnerName: r.learner_name,
          requirementOrdinal: r.requirement_ordinal ?? null,
          attemptNo: r.attempt_no,
          status: r.status as AssessmentStatus,
          submittedAt: r.submitted_at,
          assignedAt: r.assigned_at ?? null,
          dueOn: r.due_on ?? null,
          isOverdue: !!r.is_overdue,
          reflection: reflection
            ? {
                submittedAt: reflection.submitted_at,
                answers: (reflection.answers ?? []).map((a) => ({
                  questionId: a.question_id,
                  section: a.section,
                  question: a.question,
                  questionVi: a.question_vi,
                  answer: a.answer,
                })),
              }
            : null,
          transcriptText: r.transcript_text ?? null,
          quizCorrect: r.quiz_correct ?? null,
          quizTotal: r.quiz_total ?? null,
          quizScorePct: r.quiz_score_pct ?? null,
          learnerFiles: parseAssessmentFiles(r.learner_files),
          returnReason: r.return_reason ?? null,
          myLatestVersion: r.my_latest_review_version ?? null,
          myLatestFeedbackText: r.my_latest_feedback_text ?? null,
          myLatestOutcome: (r.my_latest_outcome as AssessmentOutcome | null) ?? null,
          releasedAt: r.released_at ?? null,
        };
      });
    },
  });
}

/** Submissions still waiting on this coach: new ones and the ones Admin returned. */
export function pendingReviewCount(rows: CoachInboxRow[]) {
  return rows.filter((r) => r.tab === "to_assess" || r.tab === "returned").length;
}

export class FeedbackPdfError extends Error {
  constructor(public reason: "type" | "size") {
    super(reason === "type" ? "The feedback file must be a PDF" : "The feedback PDF must be 10 MB or smaller");
  }
}

/** Checked here for a clear message; the bucket and coach_submit_review check again. */
export function checkFeedbackPdf(file: File) {
  if (file.type !== "application/pdf") throw new FeedbackPdfError("type");
  if (file.size > FEEDBACK_PDF_MAX_BYTES) throw new FeedbackPdfError("size");
}

export function useSubmitAssessmentReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      row,
      feedbackText,
      outcome,
      pdf,
    }: {
      row: Pick<CoachInboxRow, "submissionId" | "enrollmentId">;
      feedbackText: string;
      outcome: AssessmentOutcome | null;
      pdf: File | null;
    }) => {
      let uploadedPath: string | null = null;
      if (pdf) {
        checkFeedbackPdf(pdf);
        const safeName = pdf.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "feedback.pdf";
        uploadedPath = `${row.enrollmentId}/${row.submissionId}/feedback-${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from(ASSESSMENT_FILES_BUCKET)
          .upload(uploadedPath, pdf, { contentType: "application/pdf", upsert: false });
        if (upErr) throw upErr;
      }
      const { data, error } = await supabase.rpc("coach_submit_review", {
        p_submission_id: row.submissionId,
        p_feedback_text: feedbackText.trim() || undefined,
        p_outcome: outcome ?? undefined,
        p_files: uploadedPath ? [{ storage_path: uploadedPath, file_kind: "feedback_pdf" }] : [],
      });
      if (error) {
        // Not registered, so the policy still lets the uploader remove it.
        if (uploadedPath) await supabase.storage.from(ASSESSMENT_FILES_BUCKET).remove([uploadedPath]);
        throw error;
      }
      return data as string;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [COACH_ASSESSMENT_INBOX_KEY] }),
  });
}
