import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EngagementLevel = "high" | "moderate" | "low" | "disengaged";

export interface CoachSessionFeedbackState {
  quality_rating: number | null;
  engagement_level: EngagementLevel | null;
  flag_for_admin: boolean;
  flag_notes: string;
  existed: boolean;
}

const EMPTY: CoachSessionFeedbackState = {
  quality_rating: null,
  engagement_level: null,
  flag_for_admin: false,
  flag_notes: "",
  existed: false,
};

async function fetchFeedback(sessionId: string, coachId: string): Promise<CoachSessionFeedbackState> {
  const { data } = await supabase
    .from("coach_session_feedback")
    .select("quality_rating, engagement_level, flag_for_admin, flag_notes")
    .eq("session_id", sessionId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (!data) return EMPTY;
  return {
    quality_rating: data.quality_rating,
    engagement_level: data.engagement_level as EngagementLevel | null,
    flag_for_admin: data.flag_for_admin,
    flag_notes: data.flag_notes ?? "",
    existed: true,
  };
}

/**
 * Optional coach-only feedback on a regular coaching session (quality
 * rating, engagement level, admin flag) — see coach_session_feedback and
 * CoachSessionFeedback.tsx (the form this backs).
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
        quality_rating: state.quality_rating,
        engagement_level: state.engagement_level,
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
