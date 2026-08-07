import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { GoalRating, SessionGoalRating } from "./types";

/**
 * Owns per-goal self ratings (`coachee_goal_ratings`) and the per-session
 * rating snapshots (`session_goal_ratings`) that feed the goal wheel.
 * Shared between the coachee and coach "my journey" views.
 */
export function useJourneyRatings(coacheeId: string | undefined) {
  const [ratings, setRatings] = useState<Record<string, GoalRating>>({});
  const [sessionRatings, setSessionRatings] = useState<SessionGoalRating[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!coacheeId) return;
    setLoading(true);
    const [{ data: gr }, { data: sgr }] = await Promise.all([
      supabase.from("coachee_goal_ratings").select("*").eq("coachee_id", coacheeId),
      supabase.from("session_goal_ratings").select("*").eq("coachee_id", coacheeId),
    ]);
    const rmap: Record<string, GoalRating> = {};
    for (const row of gr || []) rmap[row.goal_id] = row;
    setRatings(rmap);
    setSessionRatings(sgr || []);
    setLoading(false);
  }, [coacheeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveRating = useCallback(
    async (
      goalId: string,
      patch: Partial<{ start_rating: number; current_rating: number; target_rating: number }>
    ) => {
      if (!coacheeId) return;
      const existing = ratings[goalId];
      const merged = {
        goal_id: goalId,
        coachee_id: coacheeId,
        start_rating: existing?.start_rating ?? 30,
        current_rating: existing?.current_rating ?? 30,
        target_rating: existing?.target_rating ?? 80,
        current_updated_at: existing?.current_updated_at ?? new Date().toISOString(),
        ...patch,
      };
      if (patch.current_rating !== undefined) {
        merged.current_updated_at = new Date().toISOString();
      }
      setRatings((prev) => ({
        ...prev,
        [goalId]: { ...(existing as GoalRating), ...merged, id: existing?.id ?? "" },
      }));
      const { data, error } = await supabase
        .from("coachee_goal_ratings")
        .upsert(merged, { onConflict: "goal_id" })
        .select()
        .single();
      if (error) {
        toast.error(error.message);
        return;
      }
      if (data) setRatings((prev) => ({ ...prev, [goalId]: data }));
    },
    [coacheeId, ratings]
  );

  return { ratings, sessionRatings, loading, refresh, saveRating };
}
