import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const ADMIN_COHORT_COACHES_KEY = "admin-cohort-coaches";

export interface CohortCoachRow {
  coachId: string;
  fullName: string;
  title: string | null;
  isActive: boolean;
  /** The Coach's account state. An inactive account cannot deliver anything. */
  accountActive: boolean;
  assignedAt: string | null;
  /** True when this Coach has no assignment row yet (an available candidate). */
  isCandidate: boolean;
}

/**
 * Admin view of a cohort's Coach pool: who is assigned, plus every other Coach
 * who could be.
 *
 * This is the programme Coaching assignment mechanism. The learner-level
 * "Selected Coaches" allowlist no longer governs programme Coaching -- a Coach
 * delivers for a COHORT, and every learner in that cohort may book any of
 * them.
 *
 * The candidate population is Coach identity (user_roles.role = 'coach'), the
 * SAME population useAdminCohortMentors draws on: one provider identity, two
 * independent cohort assignments. Nothing is copied between them.
 */
export function useAdminCohortCoaches(cohortId: string | undefined) {
  return useQuery({
    queryKey: [ADMIN_COHORT_COACHES_KEY, cohortId],
    enabled: !!cohortId,
    queryFn: async (): Promise<CohortCoachRow[]> => {
      const [{ data: assignments, error: aErr }, { data: coachRoles, error: rErr }] =
        await Promise.all([
          supabase
            .from("cohort_coach_assignments")
            .select("coach_id, is_active, assigned_at")
            .eq("cohort_id", cohortId!),
          supabase.from("user_roles").select("user_id").eq("role", "coach"),
        ]);
      if (aErr) throw aErr;
      if (rErr) throw rErr;

      const assignedById = new Map(
        (assignments ?? []).map((a) => [a.coach_id, a]),
      );
      const ids = Array.from(
        new Set([...(coachRoles ?? []).map((r) => r.user_id), ...assignedById.keys()]),
      );
      if (ids.length === 0) return [];

      const [{ data: profiles }, { data: coachProfiles }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, status").in("id", ids),
        supabase.from("coach_profiles").select("id, title").in("id", ids),
      ]);

      return ids
        .map((id) => {
          const a = assignedById.get(id);
          const profile = profiles?.find((p) => p.id === id);
          return {
            coachId: id,
            fullName: profile?.full_name ?? "Coach",
            title: coachProfiles?.find((p) => p.id === id)?.title ?? null,
            isActive: !!a?.is_active,
            accountActive: profile?.status === "active",
            assignedAt: a?.assigned_at ?? null,
            isCandidate: !a,
          };
        })
        .sort((x, y) => {
          // Assigned first, then alphabetical, so the current pool reads as a
          // block rather than being scattered through the candidate list.
          if (x.isActive !== y.isActive) return x.isActive ? -1 : 1;
          return x.fullName.localeCompare(y.fullName);
        });
    },
  });
}

/**
 * Assign or unassign a Coach for a cohort.
 *
 * Unassigning flips is_active rather than deleting the row, so the history of
 * who delivered for a cohort survives. Sessions already booked with that Coach
 * keep working: the pool check only gates new bookings and Coach changes.
 */
export function useSetCohortCoachAssignment(cohortId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ coachId, active }: { coachId: string; active: boolean }) => {
      const { error } = await supabase.from("cohort_coach_assignments").upsert(
        {
          cohort_id: cohortId!,
          coach_id: coachId,
          is_active: active,
          assigned_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        },
        { onConflict: "cohort_id,coach_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADMIN_COHORT_COACHES_KEY, cohortId] });
      // The pool decides who a learner may book, so every Coaching reader that
      // depends on it has to be refreshed too.
      queryClient.invalidateQueries({ queryKey: ["coaching-coach-pool"] });
      queryClient.invalidateQueries({ queryKey: ["my-coach-card"] });
    },
  });
}
