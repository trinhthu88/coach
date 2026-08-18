import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { COMPETENCY_KEYS, MentoringFeedbackState } from "./types";

interface UseMentoringFeedbackOptions {
  sessionId: string | undefined;
  mentorId: string | undefined;
  menteeId: string | undefined;
}

const DEFAULT_STATE: MentoringFeedbackState = {
  ethical_practice: "",
  coaching_mindset: "",
  maintains_agreements: "",
  trust_safety: "",
  maintains_presence: "",
  listens_actively: "",
  evokes_awareness: "",
  facilitates_growth: "",
  overall_notes: "",
  existed: false,
};

async function fetchMentoringFeedback(sessionId: string): Promise<MentoringFeedbackState> {
  const { data: fb } = await supabase
    .from("mentoring_feedback")
    .select("*")
    .eq("mentoring_session_id", sessionId)
    .maybeSingle();
  if (!fb) return DEFAULT_STATE;
  const state = { ...DEFAULT_STATE, existed: true };
  for (const key of COMPETENCY_KEYS) state[key] = fb[key] ?? "";
  state.overall_notes = fb.overall_notes ?? "";
  return state;
}

/**
 * Mentoring's equivalent of useSessionPeerFeedback.ts — same 8 ICF
 * competency categories, but free-text per competency instead of a 0-100
 * rating (mentoring_feedback has text columns, not smallint), per the
 * task's explicit "form, not a rating" requirement.
 */
export function useMentoringFeedback({ sessionId, mentorId, menteeId }: UseMentoringFeedbackOptions) {
  const queryClient = useQueryClient();
  const queryKey = ["mentoring-feedback", sessionId];
  const enabled = !!sessionId;

  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchMentoringFeedback(sessionId as string),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const [feedback, setFeedback] = useState<MentoringFeedbackState>(DEFAULT_STATE);
  useEffect(() => {
    setFeedback(enabled ? data ?? DEFAULT_STATE : DEFAULT_STATE);
  }, [enabled, data]);

  const reload = () => queryClient.invalidateQueries({ queryKey });

  const saveMutation = useMutation({
    mutationFn: async (state: MentoringFeedbackState) => {
      if (!sessionId || !mentorId || !menteeId) return;
      const payload = {
        mentoring_session_id: sessionId,
        mentor_id: mentorId,
        mentee_id: menteeId,
        submitted_by: mentorId,
        ethical_practice: state.ethical_practice || null,
        coaching_mindset: state.coaching_mindset || null,
        maintains_agreements: state.maintains_agreements || null,
        trust_safety: state.trust_safety || null,
        maintains_presence: state.maintains_presence || null,
        listens_actively: state.listens_actively || null,
        evokes_awareness: state.evokes_awareness || null,
        facilitates_growth: state.facilitates_growth || null,
        overall_notes: state.overall_notes || null,
      };
      const { error } = state.existed
        ? await supabase.from("mentoring_feedback").update(payload).eq("mentoring_session_id", sessionId)
        : await supabase.from("mentoring_feedback").insert(payload);
      if (error) throw error;
    },
  });

  const save = async (state: MentoringFeedbackState) => {
    if (!sessionId || !mentorId || !menteeId) return { error: null };
    try {
      await saveMutation.mutateAsync(state);
      setFeedback((p) => ({ ...p, existed: true }));
      queryClient.invalidateQueries({ queryKey });
      supabase.functions
        .invoke("send-mentoring-feedback", { body: { session_id: sessionId } })
        .then(({ error }) => {
          if (error) console.error("Failed to send mentoring feedback email", error);
        });
      return { error: null };
    } catch (error) {
      return { error };
    }
  };

  return { feedback, setFeedback, reload, save };
}
