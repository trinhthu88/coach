import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

export type Reflection = Tables<"coachee_reflections">;

async function fetchReflections(coacheeId: string): Promise<Reflection[]> {
  const { data } = await supabase
    .from("coachee_reflections")
    .select("*")
    .eq("coachee_id", coacheeId)
    .order("created_at", { ascending: false });
  return data || [];
}

/**
 * Owns private coachee reflections. Shared between the coachee and coach
 * "my journey" views.
 */
export function useJourneyReflections(coacheeId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["journey-reflections", coacheeId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchReflections(coacheeId as string),
    enabled: !!coacheeId,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: async ({ body, mood }: { body: string; mood: string }) => {
      const { error } = await supabase.from("coachee_reflections").insert({
        coachee_id: coacheeId as string,
        body: body.trim(),
        mood: mood.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("coachee_reflections").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed"),
  });

  const addReflection = async (body: string, mood: string) => {
    if (!body.trim() || !coacheeId) return false;
    try {
      await addMutation.mutateAsync({ body, mood });
      return true;
    } catch {
      return false;
    }
  };

  const deleteReflection = async (id: string) => {
    await deleteMutation.mutateAsync(id).catch(() => {});
  };

  return {
    reflections: data ?? [],
    loading: isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
    addReflection,
    deleteReflection,
  };
}
