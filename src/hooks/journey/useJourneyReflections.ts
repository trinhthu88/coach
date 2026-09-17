import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";

export type Reflection = Tables<"coachee_reflections">;

async function fetchReflections(coacheeId: string, enrollmentId: string): Promise<Reflection[]> {
  const { data } = await supabase
    .from("coachee_reflections")
    .select("*")
    .eq("coachee_id", coacheeId)
    .eq("enrollment_id", enrollmentId)
    .order("created_at", { ascending: false });
  return data || [];
}

/**
 * Owns private coachee reflections, scoped to coachee_id + enrollment_id —
 * a learner's private journal from one programme must never surface under
 * a different enrollment. Shared between the coachee and coach "my
 * journey" views.
 */
export function useJourneyReflections(coacheeId: string | undefined, initialEnrollmentId?: string | null) {
  const queryClient = useQueryClient();
  const { selectedEnrollment } = useEnrollmentContext(coacheeId, initialEnrollmentId);
  const enrollmentId = selectedEnrollment?.id;
  const queryKey = ["journey-reflections", coacheeId, enrollmentId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchReflections(coacheeId as string, enrollmentId as string),
    enabled: !!coacheeId && !!enrollmentId,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: async ({ body, mood }: { body: string; mood: string }) => {
      if (!enrollmentId) throw new Error("An enrollment is required to save a reflection");
      const { error } = await supabase.from("coachee_reflections").insert({
        coachee_id: coacheeId as string,
        enrollment_id: enrollmentId,
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
    loading: !!coacheeId && (!enrollmentId || isLoading),
    refresh: () => queryClient.invalidateQueries({ queryKey }),
    addReflection,
    deleteReflection,
  };
}
