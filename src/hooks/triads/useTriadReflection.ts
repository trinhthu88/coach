import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export interface TriadReflectionInput {
  learned_as_coach: string;
  will_use_as_coach: string;
  learned_as_coachee: string;
  will_use_as_coachee: string;
  learned_as_observer: string;
  will_use_as_observer: string;
  satisfaction_rating: number;
}

// Not `extends TriadReflectionInput`: the DB columns are all nullable
// (no NOT NULL constraint — see 20260903130200_triad_reflections.sql), so a
// row read back can genuinely have nulls even though submitReflection()
// always writes full non-null text via TriadReflectionInput.
export interface TriadReflectionRow {
  id: string;
  triad_session_id: string;
  participant_id: string;
  submitted_at: string;
  learned_as_coach: string | null;
  will_use_as_coach: string | null;
  learned_as_coachee: string | null;
  will_use_as_coachee: string | null;
  learned_as_observer: string | null;
  will_use_as_observer: string | null;
  satisfaction_rating: number | null;
}

/** The current user's own reflection for a session — locked (insert-only) once submitted. */
export function useMyTriadReflection(sessionId: string | undefined) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["triad-reflection-mine", sessionId, user?.id],
    queryFn: async (): Promise<TriadReflectionRow | null> => {
      const { data, error } = await supabase
        .from("triad_reflections")
        .select("*")
        .eq("triad_session_id", sessionId as string)
        .eq("participant_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!sessionId && !!user,
  });
  return { reflection: query.data ?? null, loading: query.isLoading };
}

/** All members' reflections for a session — RLS only returns rows once every member has submitted. */
export function useGroupReflections(sessionId: string | undefined) {
  const query = useQuery({
    queryKey: ["triad-reflection-group", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("triad_reflections")
        .select("*, profiles(full_name, avatar_url)")
        .eq("triad_session_id", sessionId as string);
      if (error) throw error;
      return (data ?? []) as (TriadReflectionRow & { profiles: { full_name: string; avatar_url: string | null } })[];
    },
    enabled: !!sessionId,
  });
  return { reflections: query.data ?? [], loading: query.isLoading };
}

export function useTriadReflection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const submitReflection = useMutation({
    mutationFn: async ({ sessionId, data }: { sessionId: string; data: TriadReflectionInput }) => {
      const { error } = await supabase.from("triad_reflections").insert({
        triad_session_id: sessionId,
        participant_id: user!.id,
        ...data,
      });
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      queryClient.invalidateQueries({ queryKey: ["triad-reflection-mine", vars.sessionId] });
      queryClient.invalidateQueries({ queryKey: ["triad-reflection-group", vars.sessionId] });
      queryClient.invalidateQueries({ queryKey: ["my-triads"] });
    },
  });

  return { submitReflection: submitReflection.mutateAsync, submitting: submitReflection.isPending };
}
