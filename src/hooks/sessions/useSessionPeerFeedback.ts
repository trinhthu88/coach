import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PeerFeedbackState } from "./types";

interface UseSessionPeerFeedbackOptions {
  sessionId: string | undefined;
  isPeer: boolean;
  peerCoachId: string | undefined;
  peerCoacheeId: string | undefined;
}

const DEFAULT_STATE: PeerFeedbackState = {
  ethical_practice: 70,
  coaching_mindset: 70,
  maintains_agreements: 70,
  trust_safety: 70,
  maintains_presence: 70,
  listens_actively: 70,
  evokes_awareness: 70,
  facilitates_growth: 70,
  feedback_note: "",
  existed: false,
};

async function fetchPeerFeedback(sessionId: string): Promise<PeerFeedbackState> {
  const { data: fb } = await supabase
    .from("peer_session_competency_feedback")
    .select("*")
    .eq("peer_session_id", sessionId)
    .maybeSingle();
  if (!fb) return DEFAULT_STATE;
  return {
    ethical_practice: fb.ethical_practice ?? 70,
    coaching_mindset: fb.coaching_mindset ?? 70,
    maintains_agreements: fb.maintains_agreements ?? 70,
    trust_safety: fb.trust_safety ?? 70,
    maintains_presence: fb.maintains_presence ?? 70,
    listens_actively: fb.listens_actively ?? 70,
    evokes_awareness: fb.evokes_awareness ?? 70,
    facilitates_growth: fb.facilitates_growth ?? 70,
    feedback_note: fb.feedback_note ?? "",
    existed: true,
  };
}

/**
 * Loads and persists the 8 ICF competency ratings a peer-coachee leaves for
 * their peer-coach after a completed peer session.
 */
export function useSessionPeerFeedback({
  sessionId,
  isPeer,
  peerCoachId,
  peerCoacheeId,
}: UseSessionPeerFeedbackOptions) {
  const queryClient = useQueryClient();
  const queryKey = ["session-peer-feedback", sessionId];
  const enabled = isPeer && !!sessionId;

  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchPeerFeedback(sessionId as string),
    enabled,
    staleTime: 30_000,
    // Feedback is locally editable before an explicit save; avoid a
    // background window-focus refetch silently overwriting unsaved sliders.
    refetchOnWindowFocus: false,
  });

  // `feedback` is locally editable (sliders/textarea) before an explicit
  // save, seeded from the loaded row whenever it changes.
  const [feedback, setFeedback] = useState<PeerFeedbackState>(DEFAULT_STATE);
  useEffect(() => {
    setFeedback(enabled ? data ?? DEFAULT_STATE : DEFAULT_STATE);
  }, [enabled, data]);

  const reload = () => queryClient.invalidateQueries({ queryKey });

  const saveMutation = useMutation({
    mutationFn: async (state: PeerFeedbackState) => {
      if (!sessionId || !peerCoachId || !peerCoacheeId) return;
      const payload = {
        peer_session_id: sessionId,
        peer_coach_id: peerCoachId,
        peer_coachee_id: peerCoacheeId,
        ethical_practice: state.ethical_practice,
        coaching_mindset: state.coaching_mindset,
        maintains_agreements: state.maintains_agreements,
        trust_safety: state.trust_safety,
        maintains_presence: state.maintains_presence,
        listens_actively: state.listens_actively,
        evokes_awareness: state.evokes_awareness,
        facilitates_growth: state.facilitates_growth,
        feedback_note: state.feedback_note || null,
      };
      const { error } = state.existed
        ? await supabase
            .from("peer_session_competency_feedback")
            .update(payload)
            .eq("peer_session_id", sessionId)
        : await supabase.from("peer_session_competency_feedback").insert(payload);
      if (error) throw error;
    },
  });

  const save = async (state: PeerFeedbackState) => {
    if (!sessionId || !peerCoachId || !peerCoacheeId) return { error: null };
    try {
      await saveMutation.mutateAsync(state);
      toast.success("Feedback saved");
      setFeedback((p) => ({ ...p, existed: true }));
      queryClient.invalidateQueries({ queryKey });
      return { error: null };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed");
      return { error };
    }
  };

  return { feedback, setFeedback, reload, save };
}
