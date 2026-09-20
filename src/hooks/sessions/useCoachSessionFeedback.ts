import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CoachSessionFeedbackState {
  flag_for_admin: boolean;
  flag_notes: string;
  existed: boolean;
}

const EMPTY: CoachSessionFeedbackState = {
  flag_for_admin: false,
  flag_notes: "",
  existed: false,
};

async function fetchFeedback(sessionId: string, coachId: string): Promise<CoachSessionFeedbackState> {
  const { data } = await supabase
    .from("coach_session_feedback")
    .select("flag_for_admin, flag_notes")
    .eq("session_id", sessionId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (!data) return EMPTY;
  return {
    flag_for_admin: data.flag_for_admin,
    flag_notes: data.flag_notes ?? "",
    existed: true,
  };
}

/**
 * Optional Coach-only escalation on a Coaching session: flag for Admin, with a
 * note. Nothing here affects programme progress.
 *
 * quality_rating and engagement_level were retired by the 2026 Coaching
 * redesign -- the Coach no longer grades the learner, and neither value was
 * ever a legitimate input to completion. The columns are dropped by
 * supabase/deployment-2/20260920190000_coaching_retire_legacy.sql; this hook
 * already stops reading and writing them, so the drop finds no live caller.
 *
 * The Coach's ordinary session note belongs in coach_session_private_notes,
 * which stays the single Coach note system.
 */
export function useCoachSessionFeedback(sessionId: string | undefined, coachId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  const queryKey = ["coach-session-feedback", sessionId, coachId];
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchFeedback(sessionId as string, coachId as string),
    enabled: !!sessionId && !!coachId && enabled,
    staleTime: 30_000,
  });

  const save = async (state: Omit<CoachSessionFeedbackState, "existed">) => {
    if (!sessionId || !coachId) return { error: new Error("Missing session or coach id") };
    setSaving(true);
    const { error } = await supabase.from("coach_session_feedback").upsert(
      {
        session_id: sessionId,
        coach_id: coachId,
        flag_for_admin: state.flag_for_admin,
        flag_notes: state.flag_notes.trim() || null,
      },
      { onConflict: "session_id,coach_id" }
    );
    setSaving(false);
    if (!error) queryClient.invalidateQueries({ queryKey });
    return { error };
  };

  return { feedback: data ?? EMPTY, loading: isLoading, saving, save };
}
