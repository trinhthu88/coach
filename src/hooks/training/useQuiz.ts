import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export interface QuizOption {
  id: string;
  text: string;
  text_vi?: string;
  is_correct: boolean;
}

export interface QuizQuestion {
  id: string;
  question_text: string;
  question_text_vi: string | null;
  options: QuizOption[];
  explanation: string | null;
  explanation_vi: string | null;
  sort_order: number;
}

export interface QuizAssignment {
  id: string;
  training_week_id: string;
  title: string;
  title_vi: string | null;
  instructions: string | null;
  instructions_vi: string | null;
}

export interface QuizSubmission {
  answers: Record<string, string>;
  score_pct: number | null;
  correct_count: number | null;
  total_count: number | null;
}

/**
 * A quiz assignment's questions plus this user's submission, if any. Scoring
 * happens server-side (score_quiz_submission trigger) — this hook only sends
 * the raw {question_id: selected_option_id} answers and reads back whatever
 * the trigger computed, so a client can't fabricate its own score.
 */
export function useQuiz(assignmentId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["quiz", assignmentId, user?.id],
    queryFn: async () => {
      const [{ data: assignment, error: aError }, { data: questions, error: qError }, { data: submission, error: sError }] =
        await Promise.all([
          supabase
            .from("assignments")
            .select("id, training_week_id, title, title_vi, instructions, instructions_vi")
            .eq("id", assignmentId as string)
            .maybeSingle(),
          // Server-side masked: is_correct/explanation are only present once
          // this user already has a submission for this assignment — see
          // get_quiz_questions() in 20260904100000_quiz_submission_integrity.sql.
          supabase.rpc("get_quiz_questions", { p_assignment_id: assignmentId as string }),
          supabase
            .from("assignment_submissions")
            .select("answers, score_pct, correct_count, total_count")
            .eq("assignment_id", assignmentId as string)
            .eq("user_id", user!.id)
            .maybeSingle(),
        ]);
      if (aError) throw aError;
      if (qError) throw qError;
      if (sError) throw sError;

      return {
        assignment: (assignment as QuizAssignment | null) ?? null,
        questions: ((questions ?? []) as unknown as QuizQuestion[]),
        submission: (submission as QuizSubmission | null) ?? null,
      };
    },
    enabled: !!assignmentId && !!user,
  });

  const submit = useCallback(
    async (answers: Record<string, string>) => {
      if (!assignmentId || !user) return;
      setSubmitting(true);
      const { error } = await supabase.from("assignment_submissions").insert({
        assignment_id: assignmentId,
        user_id: user.id,
        answers,
      });
      setSubmitting(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["quiz", assignmentId, user.id] });
      queryClient.invalidateQueries({ queryKey: ["assignments", data?.assignment?.training_week_id, user.id] });
    },
    [assignmentId, user, queryClient, data?.assignment?.training_week_id]
  );

  return {
    assignment: data?.assignment ?? null,
    questions: data?.questions ?? [],
    submission: data?.submission ?? null,
    loading: isLoading,
    submitting,
    submit,
  };
}
