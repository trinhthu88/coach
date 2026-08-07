import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

export type Reflection = Tables<"coachee_reflections">;

/**
 * Owns private coachee reflections. Shared between the coachee and coach
 * "my journey" views.
 */
export function useJourneyReflections(coacheeId: string | undefined) {
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!coacheeId) return;
    setLoading(true);
    const { data } = await supabase
      .from("coachee_reflections")
      .select("*")
      .eq("coachee_id", coacheeId)
      .order("created_at", { ascending: false });
    setReflections(data || []);
    setLoading(false);
  }, [coacheeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addReflection = useCallback(
    async (body: string, mood: string) => {
      if (!body.trim() || !coacheeId) return;
      const { error } = await supabase.from("coachee_reflections").insert({
        coachee_id: coacheeId,
        body: body.trim(),
        mood: mood.trim() || null,
      });
      if (error) {
        toast.error(error.message);
        return false;
      }
      await refresh();
      return true;
    },
    [coacheeId, refresh]
  );

  const deleteReflection = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("coachee_reflections").delete().eq("id", id);
      if (error) {
        toast.error(error.message);
        return;
      }
      refresh();
    },
    [refresh]
  );

  return { reflections, loading, refresh, addReflection, deleteReflection };
}
