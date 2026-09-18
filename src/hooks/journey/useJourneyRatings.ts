import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import type { Database } from "@/integrations/supabase/types";
import type { GoalRating, SessionGoalRating } from "./types";

type GoalRatingUpsert = Database["public"]["Tables"]["coachee_goal_ratings"]["Insert"];

export type GoalCheckin = Database["public"]["Tables"]["goal_checkins"]["Row"];

interface JourneyRatingsData {
  ratings: Record<string, GoalRating>;
  sessionRatings: SessionGoalRating[];
  /** Every goal_checkins row for the enrollment, newest first. */
  checkins: GoalCheckin[];
}

async function fetchJourneyRatings(coacheeId: string, enrollmentId: string): Promise<JourneyRatingsData> {
  const [{ data: gr, error: ratingsError }, { data: sgr, error: checkinsError }] = await Promise.all([
    supabase.from("coachee_goal_ratings").select("*").eq("coachee_id", coacheeId).eq("enrollment_id", enrollmentId),
    supabase.from("goal_checkins").select("*").eq("enrollment_id", enrollmentId),
  ]);
  if (ratingsError) throw ratingsError;
  if (checkinsError) throw checkinsError;
  const ratings: Record<string, GoalRating> = {};
  for (const row of gr || []) ratings[row.goal_id] = row;
  return {
    ratings,
    checkins: [...(sgr || [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    sessionRatings: (sgr || [])
      .filter((row): row is typeof row & { source_activity_id: string } => row.source_activity_id !== null)
      .map((row) => ({
        ...row,
        session_id: row.source_activity_id,
        rating: row.new_rating,
        coachee_id: coacheeId,
      })),
  };
}

/**
 * Owns per-goal self ratings (`coachee_goal_ratings`) and the per-session
 * rating snapshots (`session_goal_ratings`) that feed the goal wheel.
 * Shared between the coachee and coach "my journey" views.
 */
export function useJourneyRatings(coacheeId: string | undefined, initialEnrollmentId?: string | null) {
  const queryClient = useQueryClient();
  const { selectedEnrollment } = useEnrollmentContext(coacheeId, initialEnrollmentId);
  const enrollmentId = selectedEnrollment?.id;
  const queryKey = ["journey-ratings", coacheeId, enrollmentId];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchJourneyRatings(coacheeId as string, enrollmentId as string),
    enabled: !!coacheeId && !!enrollmentId,
    staleTime: 30_000,
  });
  const ratings = data?.ratings ?? {};
  const sessionRatings = data?.sessionRatings ?? [];
  const checkins = data?.checkins ?? [];

  const saveMutation = useMutation({
    mutationFn: async (merged: GoalRatingUpsert) => {
      if (!enrollmentId) throw new Error("An enrollment is required to save a goal rating");
      const { data: saved, error } = await supabase
        .from("coachee_goal_ratings")
        .upsert({ ...merged, enrollment_id: enrollmentId }, { onConflict: "enrollment_id,goal_id" })
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
    if (!coacheeId || !enrollmentId) return;
    const existing = ratings[goalId];
    const merged = {
      goal_id: goalId,
      coachee_id: coacheeId,
      enrollment_id: enrollmentId,
      start_rating: existing?.start_rating ?? null,
      current_rating: existing?.current_rating ?? null,
      target_rating: existing?.target_rating ?? null,
      current_updated_at: existing?.current_updated_at ?? new Date().toISOString(),
      ...patch,
    };
    if (patch.current_rating !== undefined) {
      merged.current_updated_at = new Date().toISOString();
    }
    await saveMutation.mutateAsync(merged).catch(() => {});
  };

  return {
    ratings,
    sessionRatings,
    checkins,
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? error)) : null,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
    saveRating,
  };
}
