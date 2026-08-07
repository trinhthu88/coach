import { useCallback, useEffect, useState } from "react";
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
  const [feedback, setFeedback] = useState<PeerFeedbackState>(DEFAULT_STATE);

  const load = useCallback(async () => {
    if (!isPeer || !sessionId) {
      setFeedback(DEFAULT_STATE);
      return;
    }
    const { data: fb } = await supabase
      .from("peer_session_competency_feedback")
      .select("*")
      .eq("peer_session_id", sessionId)
      .maybeSingle();
    if (fb) {
      setFeedback({
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
      });
    } else {
      setFeedback(DEFAULT_STATE);
    }
  }, [sessionId, isPeer]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (state: PeerFeedbackState) => {
      if (!sessionId || !peerCoachId || !peerCoacheeId) return { error: null };
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
      if (error) {
        toast.error(error.message);
        return { error };
      }
      toast.success("Feedback saved");
      setFeedback((p) => ({ ...p, existed: true }));
      return { error: null };
    },
    [sessionId, peerCoachId, peerCoacheeId]
  );

  return { feedback, setFeedback, reload: load, save };
}
