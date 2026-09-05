import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export type ReflectionQuestionType = "open_text" | "scale_1_10";

export interface ReflectionQuestion {
  id: string;
  question_text: string;
  question_text_vi: string | null;
  question_type: ReflectionQuestionType;
  is_required: boolean;
  sort_order: number;
}

export interface ProgrammeReflection {
  id: string;
  programme_id: string;
  reflection_number: number;
  title: string;
  title_vi: string | null;
  instructions: string | null;
  instructions_vi: string | null;
  appears_at_week: number;
}

export interface ReflectionSubmission {
  id: string;
  confidence_score: number;
  submitted_at: string;
}

export interface ReflectionAnswer {
  question_id: string;
  answer_text: string | null;
  answer_value: number | null;
}

export interface ReflectionAnswerInput {
  questionId: string;
  text?: string;
  value?: number;
}

/**
 * The programme_reflections row assigned to a given training week (if any),
 * its admin-authored questions, and the current user's submission + answers.
 * The confidence score is a fixed field on every submission — never a
 * reflection_questions row — so it's returned separately from `answers`.
 */
export function useWeekReflection(weekNumber: number | undefined, programmeId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const queryKey = useMemo(
    () => ["week-reflection", programmeId, weekNumber, user?.id],
    [programmeId, weekNumber, user?.id]
  );

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data: reflection, error: rError } = await supabase
        .from("programme_reflections")
        .select("id, programme_id, reflection_number, title, title_vi, instructions, instructions_vi, appears_at_week")
        .eq("programme_id", programmeId as string)
        .eq("appears_at_week", weekNumber as number)
        .maybeSingle();
      if (rError) throw rError;
      if (!reflection) {
        return { reflection: null, questions: [] as ReflectionQuestion[], submission: null, answers: [] as ReflectionAnswer[] };
      }

      const [{ data: questions, error: qError }, { data: submission, error: sError }] = await Promise.all([
        supabase
          .from("reflection_questions")
          .select("id, question_text, question_text_vi, question_type, is_required, sort_order")
          .eq("reflection_id", reflection.id)
          .order("sort_order"),
        supabase
          .from("reflection_submissions")
          .select("id, confidence_score, submitted_at")
          .eq("reflection_id", reflection.id)
          .eq("user_id", user!.id)
          .maybeSingle(),
      ]);
      if (qError) throw qError;
      if (sError) throw sError;

      let answers: ReflectionAnswer[] = [];
      if (submission) {
        const { data: answerRows, error: aError } = await supabase
          .from("reflection_answers")
          .select("question_id, answer_text, answer_value")
          .eq("submission_id", submission.id);
        if (aError) throw aError;
        answers = (answerRows ?? []) as ReflectionAnswer[];
      }

      return {
        reflection: reflection as ProgrammeReflection,
        questions: (questions ?? []) as ReflectionQuestion[],
        submission: (submission as ReflectionSubmission | null) ?? null,
        answers,
      };
    },
    enabled: !!programmeId && !!weekNumber && !!user,
  });

  const submit = useCallback(
    async (confidenceScore: number, answers: ReflectionAnswerInput[]) => {
      const reflectionId = data?.reflection?.id;
      if (!reflectionId || !user) return;
      setSubmitting(true);
      const { data: submission, error } = await supabase
        .from("reflection_submissions")
        .upsert(
          { reflection_id: reflectionId, user_id: user.id, confidence_score: confidenceScore },
          { onConflict: "reflection_id,user_id" }
        )
        .select("id")
        .single();
      if (error || !submission) {
        setSubmitting(false);
        toast.error(error?.message ?? "Could not submit reflection");
        return;
      }
      const { error: answersError } = await supabase.from("reflection_answers").upsert(
        answers.map((a) => ({
          submission_id: submission.id,
          question_id: a.questionId,
          answer_text: a.text ?? null,
          answer_value: a.value ?? null,
        })),
        { onConflict: "submission_id,question_id" }
      );
      setSubmitting(false);
      if (answersError) {
        toast.error(answersError.message);
        return;
      }
      queryClient.invalidateQueries({ queryKey });
    },
    [data?.reflection?.id, user, queryClient, queryKey]
  );

  return {
    reflection: data?.reflection ?? null,
    questions: data?.questions ?? [],
    submission: data?.submission ?? null,
    answers: data?.answers ?? [],
    loading: isLoading,
    submitting,
    submit,
  };
}
