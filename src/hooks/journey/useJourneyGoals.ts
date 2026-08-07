import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Goal, Milestone } from "./types";

/**
 * Owns coachee goals + milestones (CRUD) for the journey pages.
 * Shared between the coachee and coach "my journey" views — both operate
 * on the same `coachee_goals` / `coachee_milestones` tables keyed by
 * `coacheeId` (a coach viewing their own journey passes their own id).
 */
export function useJourneyGoals(coacheeId: string | undefined, onChanged?: () => void) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!coacheeId) return;
    setLoading(true);
    const [{ data: g }, { data: m }] = await Promise.all([
      supabase.from("coachee_goals").select("*").eq("coachee_id", coacheeId).order("created_at"),
      supabase.from("coachee_milestones").select("*").eq("coachee_id", coacheeId).order("created_at"),
    ]);
    setGoals(g || []);
    setMilestones(m || []);
    setLoading(false);
  }, [coacheeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addGoal = useCallback(
    async (payload: { title: string; description: string | null; target_date: string | null }) => {
      if (!coacheeId) return;
      const { error } = await supabase.from("coachee_goals").insert({
        coachee_id: coacheeId,
        title: payload.title,
        description: payload.description,
        target_date: payload.target_date,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      onChanged ? onChanged() : refresh();
    },
    [coacheeId, onChanged, refresh]
  );

  const deleteGoal = useCallback(
    async (goalId: string) => {
      const { error } = await supabase.from("coachee_goals").delete().eq("id", goalId);
      if (error) {
        toast.error(error.message);
        return;
      }
      onChanged ? onChanged() : refresh();
    },
    [onChanged, refresh]
  );

  const addMilestone = useCallback(
    async (payload: { goal_id: string; title: string; target_date: string | null }) => {
      if (!coacheeId) return;
      const { error } = await supabase.from("coachee_milestones").insert({
        goal_id: payload.goal_id,
        coachee_id: coacheeId,
        title: payload.title,
        target_date: payload.target_date,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      onChanged ? onChanged() : refresh();
    },
    [coacheeId, onChanged, refresh]
  );

  const deleteMilestone = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("coachee_milestones").delete().eq("id", id);
      if (error) {
        toast.error(error.message);
        return;
      }
      onChanged ? onChanged() : refresh();
    },
    [onChanged, refresh]
  );

  const toggleMilestone = useCallback(
    async (m: Milestone) => {
      const { error } = await supabase
        .from("coachee_milestones")
        .update({ is_done: !m.is_done, done_at: !m.is_done ? new Date().toISOString() : null })
        .eq("id", m.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      onChanged ? onChanged() : refresh();
    },
    [onChanged, refresh]
  );

  // Silently syncs a milestone's done state (used for auto-complete-on-actions
  // logic) and updates local state without a full refresh/toast noise.
  const syncMilestoneDone = useCallback(async (id: string, done: boolean) => {
    const { error } = await supabase
      .from("coachee_milestones")
      .update({ is_done: done, done_at: done ? new Date().toISOString() : null })
      .eq("id", id);
    if (!error) {
      setMilestones((prev) =>
        prev.map((x) => (x.id === id ? { ...x, is_done: done, done_at: done ? new Date().toISOString() : null } : x))
      );
    }
  }, []);

  return {
    goals,
    milestones,
    loading,
    refresh,
    addGoal,
    deleteGoal,
    addMilestone,
    deleteMilestone,
    toggleMilestone,
    syncMilestoneDone,
  };
}
