import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export interface TrainingWeekListItem {
  id: string;
  week_number: number;
  title: string;
  title_vi: string | null;
  subtitle: string | null;
  subtitle_vi: string | null;
  unlock_date: string | null;
  locked: boolean;
  viewed_at: string | null;
  completed_at: string | null;
}

/**
 * The current user's active programme's training weeks, via
 * get_my_training_weeks() — a published-but-not-yet-unlocked week still
 * comes back (locked: true, title only) so the list can grey it out with
 * its unlock date; an unpublished (is_visible = false) week never does.
 */
export function useTrainingWeeks() {
  const { user } = useAuth();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["training-weeks", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_training_weeks");
      if (error) throw error;
      return (data ?? []) as TrainingWeekListItem[];
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const weeks = data ?? [];
  // "Current" = the earliest unlocked week not yet completed; once every
  // unlocked week is done, fall back to the most recently unlocked one.
  const currentWeek =
    weeks.find((w) => !w.locked && !w.completed_at) ??
    [...weeks].reverse().find((w) => !w.locked) ??
    null;

  return { weeks, currentWeek, loading: !!user && isLoading, refetch };
}
