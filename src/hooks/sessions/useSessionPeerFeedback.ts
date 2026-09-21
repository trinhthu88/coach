import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hasAnyCompetencyRating, type PeerFeedbackState } from "./types";

interface UseSessionPeerFeedbackOptions {
  sessionId: string | undefined;
  isPeer: boolean;
  peerCoachId: string | undefined;
  peerCoacheeId: string | undefined;
}

// Unrated until the rater moves a slider: no value is ever persisted that the
// user did not set (the slider may sit at its midpoint visually).
const DEFAULT_STATE: PeerFeedbackState = {
  ethical_practice: null,
  coaching_mindset: null,
  maintains_agreements: null,
  trust_safety: null,
  maintains_presence: null,
  listens_actively: null,
  evokes_awareness: null,
  facilitates_growth: null,
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
    ethical_practice: fb.ethical_practice ?? null,
    coaching_mindset: fb.coaching_mindset ?? null,
    maintains_agreements: fb.maintains_agreements ?? null,
    trust_safety: fb.trust_safety ?? null,
    maintains_presence: fb.maintains_presence ?? null,
    listens_actively: fb.listens_actively ?? null,
    evokes_awareness: fb.evokes_awareness ?? null,
    facilitates_growth: fb.facilitates_growth ?? null,
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
  const { t } = useTranslation("sessions");
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
    if (!hasAnyCompetencyRating(state)) {
      const error = new Error(t("detail.peerFeedback.rateAtLeastOne"));
      toast.error(error.message);
      return { error };
    }
    try {
      await saveMutation.mutateAsync(state);
      toast.success(t("detail.toast.feedbackSaved"));
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
