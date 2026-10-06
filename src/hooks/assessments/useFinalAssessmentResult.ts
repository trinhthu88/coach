import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FinalAssessmentState } from "./useLearnerFinalAssessment";

/**
 * Admin and Sponsor reads of the Final Assessment, each through its own role
 * wrapper over canonical_final_assessment_result (the learner's is
 * useLearnerFinalAssessmentFor). No row = the programme has no Final Assessment.
 */

export interface AdminFinalAssessment {
  state: FinalAssessmentState;
  attemptNo: number;
  dueOn: string | null;
  submittedAt: string | null;
  releasedAt: string | null;
  quizCorrect: number | null;
  quizTotal: number | null;
  quizScorePct: number | null;
  passMarkPct: number | null;
  quizPassed: boolean | null;
  outcome: "pass" | "not_pass" | "resubmit" | null;
  finalResult: "pass" | "not_pass" | null;
}

export function useAdminFinalAssessment(enrollmentId: string | null | undefined) {
  return useQuery({
    queryKey: ["admin-final-assessment", enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<AdminFinalAssessment | null> => {
      const { data, error } = await supabase.rpc("admin_final_assessment_result", { p_enrollment_id: enrollmentId! });
      if (error) throw error;
      const r = (data ?? [])[0];
      if (!r) return null;
      return {
        state: r.state as FinalAssessmentState,
        attemptNo: r.attempt_no,
        dueOn: r.due_on ?? null,
        submittedAt: r.submitted_at ?? null,
        releasedAt: r.released_at ?? null,
        quizCorrect: r.quiz_correct ?? null,
        quizTotal: r.quiz_total ?? null,
        quizScorePct: r.quiz_score_pct ?? null,
        passMarkPct: r.pass_mark_pct ?? null,
        quizPassed: r.quiz_passed ?? null,
        outcome: (r.outcome as AdminFinalAssessment["outcome"]) ?? null,
        finalResult: (r.final_result as AdminFinalAssessment["finalResult"]) ?? null,
      };
    },
  });
}

export type SponsorFinalAssessmentStatus = "not_submitted" | "under_review" | "completed";

export function useSponsorFinalAssessment(enrollmentId: string | null | undefined) {
  return useQuery({
    queryKey: ["sponsor-final-assessment", enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<{ status: SponsorFinalAssessmentStatus; result: "pass" | "not_pass" | null } | null> => {
      const { data, error } = await supabase.rpc("sponsor_final_assessment_status", { p_enrollment_id: enrollmentId! });
      if (error) throw error;
      const r = (data ?? [])[0];
      if (!r) return null;
      return { status: r.status as SponsorFinalAssessmentStatus, result: (r.result as "pass" | "not_pass" | null) ?? null };
    },
  });
}
