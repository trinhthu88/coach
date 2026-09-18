import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { MY_TRIADS_KEY } from "./useMyTriads";

export type TriadReflectionSection = "coach" | "coachee" | "observer" | "general";

export interface TriadReflectionQuestion {
  id: string;
  key: string;
  section: TriadReflectionSection;
  label: string;
  labelVi: string | null;
  displayOrder: number;
}

export interface TriadReflectionAnswer {
  questionId: string;
  questionKey: string;
  section: TriadReflectionSection;
  question: string;
  questionVi: string | null;
  answer: string;
}

export interface TriadSessionReflection {
  slot: number;
  isSelf: boolean;
  satisfactionRating: number | null;
  submittedAt: string;
  answers: TriadReflectionAnswer[];
}

/** The reflection questions for a session's programme (stable question ids). */
export function useTriadReflectionQuestions(sessionId: string | undefined) {
  const query = useQuery({
    queryKey: ["triad-reflection-questions", sessionId],
    queryFn: async (): Promise<TriadReflectionQuestion[]> => {
      const { data, error } = await supabase.rpc("learner_triad_reflection_questions", { p_session_id: sessionId as string });
      if (error) throw error;
      return (data ?? []).map((q) => ({
        id: q.id,
        key: q.question_key,
        section: q.section as TriadReflectionSection,
        label: q.label,
        labelVi: q.label_vi,
        displayOrder: q.display_order,
      }));
    },
    enabled: !!sessionId,
  });
  return { questions: query.data ?? [], loading: query.isLoading };
}

/**
 * Reflections on one session as the learner may see them: always their own;
 * the other members' once every member has submitted (server rule).
 */
export function useTriadSessionReflections(sessionId: string | undefined) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["triad-session-reflections", sessionId, user?.id],
    queryFn: async (): Promise<TriadSessionReflection[]> => {
      const { data, error } = await supabase.rpc("learner_triad_session_reflections", { p_session_id: sessionId as string });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        slot: r.member_slot,
        isSelf: r.is_self,
        satisfactionRating: r.satisfaction_rating,
        submittedAt: r.submitted_at,
        answers: ((r.answers ?? []) as { question_id: string; question_key: string; section: TriadReflectionSection; question: string; question_vi: string | null; answer: string }[]).map((a) => ({
          questionId: a.question_id,
          questionKey: a.question_key,
          section: a.section,
          question: a.question,
          questionVi: a.question_vi,
          answer: a.answer,
        })),
      }));
    },
    enabled: !!sessionId && !!user,
  });
  return { reflections: query.data ?? [], loading: query.isLoading };
}

export interface TriadReflectionSubmission {
  satisfactionRating: number | null;
  answers: { questionId: string; answerText: string }[];
}

/**
 * Submit the learner's one reflection for a session (answers by question id
 * + satisfaction). The goal self-rating is recorded separately in the goal
 * source (SessionGoalRatings -> record_goal_checkins), never copied here.
 */
export function useTriadReflection() {
  const queryClient = useQueryClient();
  const submitReflection = useMutation({
    mutationFn: async ({ sessionId, data }: { sessionId: string; data: TriadReflectionSubmission }) => {
      const { error } = await supabase.rpc("learner_triad_submit_reflection", {
        p_session_id: sessionId,
        p_satisfaction_rating: data.satisfactionRating ?? undefined,
        p_answers: data.answers.map((a) => ({ question_id: a.questionId, answer_text: a.answerText })),
      });
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      queryClient.invalidateQueries({ queryKey: ["triad-session-reflections", vars.sessionId] });
      queryClient.invalidateQueries({ queryKey: [MY_TRIADS_KEY] });
      queryClient.invalidateQueries({ queryKey: ["learner-reflection-feed"] });
      queryClient.invalidateQueries({ queryKey: ["triads-card"] });
    },
  });
  return { submitReflection: submitReflection.mutateAsync, submitting: submitReflection.isPending };
}
