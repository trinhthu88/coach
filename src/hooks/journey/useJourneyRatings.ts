import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import type { GoalRating, SessionGoalRating } from "./types";

type GoalRatingUpsert = Database["public"]["Tables"]["coachee_goal_ratings"]["Insert"];

interface JourneyRatingsData {
  ratings: Record<string, GoalRating>;
  sessionRatings: SessionGoalRating[];
}

async function fetchJourneyRatings(coacheeId: string): Promise<JourneyRatingsData> {
  const [{ data: gr }, { data: sgr }] = await Promise.all([
    supabase.from("coachee_goal_ratings").select("*").eq("coachee_id", coacheeId),
    supabase.from("session_goal_ratings").select("*").eq("coachee_id", coacheeId),
  ]);
  const ratings: Record<string, GoalRating> = {};
  for (const row of gr || []) ratings[row.goal_id] = row;
  return { ratings, sessionRatings: sgr || [] };
}

/**
 * Owns per-goal self ratings (`coachee_goal_ratings`) and the per-session
 * rating snapshots (`session_goal_ratings`) that feed the goal wheel.
 * Shared between the coachee and coach "my journey" views.
 */
export function useJourneyRatings(coacheeId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["journey-ratings", coacheeId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchJourneyRatings(coacheeId as string),
    enabled: !!coacheeId,
    staleTime: 30_000,
  });
  const ratings = data?.ratings ?? {};
  const sessionRatings = data?.sessionRatings ?? [];

  const saveMutation = useMutation({
    mutationFn: async (merged: GoalRatingUpsert) => {
      const { data: saved, error } = await supabase
        .from("coachee_goal_ratings")
        .upsert(merged, { onConflict: "goal_id" })
        .select()
        .single();
      if (error) throw error;
      return saved;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKey, (prev: JourneyRatingsData | undefined) =>
        prev ? { ...prev, ratings: { ...prev.ratings, [saved.goal_id]: saved } } : prev
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed"),
  });

  const saveRating = async (
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
    // Optimistic local update, same as before the migration — not rolled
    // back on error, the toast is the only failure signal.
    queryClient.setQueryData(queryKey, (prev: JourneyRatingsData | undefined) =>
      prev
        ? {
            ...prev,
            ratings: {
              ...prev.ratings,
              [goalId]: { ...(existing as GoalRating), ...merged, id: existing?.id ?? "" },
            },
          }
        : prev
    );
    await saveMutation.mutateAsync(merged).catch(() => {});
  };

  return {
    ratings,
    sessionRatings,
    loading: isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
    saveRating,
  };
}
