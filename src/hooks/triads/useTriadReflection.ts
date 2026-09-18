import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";

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
  const { selectedEnrollment } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const query = useQuery({
    queryKey: ["triad-reflection-mine", sessionId, user?.id, enrollmentId],
    queryFn: async (): Promise<TriadReflectionRow | null> => {
      const { data, error } = await supabase
        .from("triad_reflections")
        .select("*")
        .eq("triad_session_id", sessionId as string)
        .eq("participant_id", user!.id)
        .eq("enrollment_id", enrollmentId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!sessionId && !!user && !!enrollmentId,
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
  const { selectedEnrollment } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const queryClient = useQueryClient();

  const submitReflection = useMutation({
    mutationFn: async ({ sessionId, data }: { sessionId: string; data: TriadReflectionInput }) => {
      if (!enrollmentId) throw new Error("Select an enrollment before submitting a triad reflection");
      const { error } = await supabase.from("triad_reflections").insert({
        triad_session_id: sessionId,
        participant_id: user!.id,
        enrollment_id: enrollmentId,
        ...data,
      });
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      queryClient.invalidateQueries({ queryKey: ["triad-reflection-mine", vars.sessionId, user?.id, enrollmentId] });
      queryClient.invalidateQueries({ queryKey: ["triad-reflection-group", vars.sessionId] });
      queryClient.invalidateQueries({ queryKey: ["my-triads"] });
      queryClient.invalidateQueries({ queryKey: ["triad-session-entry"] });
      queryClient.invalidateQueries({ queryKey: ["triad-reflection-statuses"] });
      queryClient.invalidateQueries({ queryKey: ["learner-reflection-feed"] });
    },
  });

  return { submitReflection: submitReflection.mutateAsync, submitting: submitReflection.isPending };
}

export interface TriadReflectionStatus {
  sessionId: string;
  submittedAt: string | null;
  selfRating: number | null;
}

/**
 * The learner's own self-rating / self-reflection status per Triad session,
 * read from the original triad_reflections records (one row per participant
 * per session). Used by the Triads "Rounds" list; independent of whether the
 * reflection has any text (the learner_reflection_feed only carries text).
 */
export function useMyTriadReflectionStatuses(sessionIds: string[]) {
  const { user } = useAuth();
  const ids = Array.from(new Set(sessionIds)).sort();
  const query = useQuery({
    queryKey: ["triad-reflection-statuses", user?.id, ids],
    queryFn: async (): Promise<Map<string, TriadReflectionStatus>> => {
      const { data, error } = await supabase
        .from("triad_reflections")
        .select("triad_session_id, satisfaction_rating, submitted_at")
        .eq("participant_id", user!.id)
        .in("triad_session_id", ids);
      if (error) throw error;
      return new Map(
        (data ?? []).map((row) => [
          row.triad_session_id as string,
          { sessionId: row.triad_session_id as string, submittedAt: row.submitted_at as string | null, selfRating: row.satisfaction_rating as number | null },
        ])
      );
    },
    enabled: !!user && ids.length > 0,
  });
  return { statuses: query.data ?? new Map<string, TriadReflectionStatus>(), loading: query.isLoading && ids.length > 0, error: query.isError };
}
