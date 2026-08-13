import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Goal, Milestone } from "./types";

interface JourneyGoalsData {
  goals: Goal[];
  milestones: Milestone[];
}

async function fetchJourneyGoals(coacheeId: string): Promise<JourneyGoalsData> {
  const [{ data: g }, { data: m }] = await Promise.all([
    supabase.from("coachee_goals").select("*").eq("coachee_id", coacheeId).order("created_at"),
    supabase.from("coachee_milestones").select("*").eq("coachee_id", coacheeId).order("created_at"),
  ]);
  return { goals: g || [], milestones: m || [] };
}

/**
 * Owns coachee goals + milestones (CRUD) for the journey pages.
 * Shared between the coachee and coach "my journey" views — both operate
 * on the same `coachee_goals` / `coachee_milestones` tables keyed by
 * `coacheeId` (a coach viewing their own journey passes their own id).
 */
export function useJourneyGoals(coacheeId: string | undefined, onChanged?: () => void) {
  const queryClient = useQueryClient();
  const queryKey = ["journey-goals", coacheeId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchJourneyGoals(coacheeId as string),
    enabled: !!coacheeId,
    staleTime: 30_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  // onChanged is never actually passed by either consumer today (both call
  // useJourneyGoals(user?.id) with one arg) but the param is kept for API
  // compatibility — when present, it fully replaces the refresh, matching
  // the pre-migration behavior.
  const notifyChanged = () => (onChanged ? Promise.resolve(onChanged()) : refresh());

  const addGoalMutation = useMutation({
    mutationFn: async (payload: { title: string; description: string | null; target_date: string | null }) => {
      const { error } = await supabase.from("coachee_goals").insert({
        coachee_id: coacheeId as string,
        title: payload.title,
        description: payload.description,
        target_date: payload.target_date,
      });
      if (error) throw error;
    },
    onSuccess: notifyChanged,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed"),
  });

  const deleteGoalMutation = useMutation({
    mutationFn: async (goalId: string) => {
      const { error } = await supabase.from("coachee_goals").delete().eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: notifyChanged,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed"),
  });

  const addMilestoneMutation = useMutation({
    mutationFn: async (payload: { goal_id: string; title: string; target_date: string | null }) => {
      const { error } = await supabase.from("coachee_milestones").insert({
        goal_id: payload.goal_id,
        coachee_id: coacheeId as string,
        title: payload.title,
        target_date: payload.target_date,
      });
      if (error) throw error;
    },
    onSuccess: notifyChanged,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed"),
  });

  const deleteMilestoneMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("coachee_milestones").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: notifyChanged,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed"),
  });

  const toggleMilestoneMutation = useMutation({
    mutationFn: async (m: Milestone) => {
      const { error } = await supabase
        .from("coachee_milestones")
        .update({ is_done: !m.is_done, done_at: !m.is_done ? new Date().toISOString() : null })
        .eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: notifyChanged,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed"),
  });

  const addGoal = async (payload: { title: string; description: string | null; target_date: string | null }) => {
    if (!coacheeId) return false;
    return addGoalMutation.mutateAsync(payload).then(
      () => true,
      () => false
    );
  };

  const deleteGoal = async (goalId: string) => {
    await deleteGoalMutation.mutateAsync(goalId).catch(() => {});
  };

  const addMilestone = async (payload: { goal_id: string; title: string; target_date: string | null }) => {
    if (!coacheeId) return false;
    return addMilestoneMutation.mutateAsync(payload).then(
      () => true,
      () => false
    );
  };

  const deleteMilestone = async (id: string) => {
    await deleteMilestoneMutation.mutateAsync(id).catch(() => {});
  };

  const toggleMilestone = async (m: Milestone) => {
    await toggleMilestoneMutation.mutateAsync(m).catch(() => {});
  };

  // Silently syncs a milestone's done state (used for auto-complete-on-actions
  // logic) and patches the cache directly without a full refetch/toast noise.
  const syncMilestoneDone = async (id: string, done: boolean) => {
    const { error } = await supabase
      .from("coachee_milestones")
      .update({ is_done: done, done_at: done ? new Date().toISOString() : null })
      .eq("id", id);
    if (!error) {
      queryClient.setQueryData(queryKey, (prev: JourneyGoalsData | undefined) =>
        prev
          ? {
              ...prev,
              milestones: prev.milestones.map((x) =>
                x.id === id ? { ...x, is_done: done, done_at: done ? new Date().toISOString() : null } : x
              ),
            }
          : prev
      );
    }
  };

  return {
    goals: data?.goals ?? [],
    milestones: data?.milestones ?? [],
    loading: isLoading,
    refresh,
    addGoal,
    deleteGoal,
    addMilestone,
    deleteMilestone,
    toggleMilestone,
    syncMilestoneDone,
  };
}
