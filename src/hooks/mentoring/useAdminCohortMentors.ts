import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const ADMIN_COHORT_MENTORS_KEY = "admin-cohort-mentors";

export interface CohortMentorRow {
  mentorUserId: string;
  fullName: string;
  isActive: boolean;
  /** The mentor's own profile flag. An inactive profile is unbookable even if assigned. */
  profileActive: boolean;
  assignedAt: string | null;
}

/**
 * Admin view of a cohort's mentor pool: who is assigned, plus every other
 * active mentor who could be.
 *
 * This is the programme Mentoring assignment mechanism. The user-global
 * mentoring_allowlist no longer governs it — a mentor delivers for a COHORT,
 * and every learner enrolled in that cohort may book any of them.
 */
export function useAdminCohortMentors(cohortId: string | undefined) {
  return useQuery({
    queryKey: [ADMIN_COHORT_MENTORS_KEY, cohortId],
    enabled: !!cohortId,
    queryFn: async (): Promise<CohortMentorRow[]> => {
      const [{ data: assignments, error: aErr }, { data: profiles, error: pErr }] =
        await Promise.all([
          supabase
            .from("cohort_mentors")
            .select("mentor_user_id, is_active, assigned_at")
            .eq("cohort_id", cohortId!),
          supabase.from("mentor_profiles").select("coach_user_id, is_active"),
        ]);
      if (aErr) throw aErr;
      if (pErr) throw pErr;

      const assignedById = new Map((assignments ?? []).map((a) => [a.mentor_user_id, a]));
      const ids = Array.from(
        new Set([
          ...(profiles ?? []).map((p) => p.coach_user_id),
          ...assignedById.keys(),
        ]),
      );
      if (ids.length === 0) return [];

      const { data: names } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);

      return ids
        .map((id) => {
          const a = assignedById.get(id);
          return {
            mentorUserId: id,
            fullName: names?.find((n) => n.id === id)?.full_name ?? "Mentor",
            isActive: !!a?.is_active,
            profileActive: !!profiles?.find((p) => p.coach_user_id === id)?.is_active,
            assignedAt: a?.assigned_at ?? null,
          };
        })
        .sort((x, y) => {
          if (x.isActive !== y.isActive) return x.isActive ? -1 : 1;
          return x.fullName.localeCompare(y.fullName);
        });
    },
  });
}

/**
 * Assign or unassign a mentor for a cohort.
 *
 * Unassigning deactivates rather than deletes, so the record of who delivered
 * Mentoring for a cohort survives. Sessions already booked with that mentor
 * keep working: the pool check gates new bookings and mentor changes only.
 */
export function useSetCohortMentorAssignment(cohortId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ mentorUserId, active }: { mentorUserId: string; active: boolean }) => {
      const { error } = await supabase.from("cohort_mentors").upsert(
        {
          cohort_id: cohortId!,
          mentor_user_id: mentorUserId,
          is_active: active,
          assigned_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        },
        { onConflict: "cohort_id,mentor_user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADMIN_COHORT_MENTORS_KEY, cohortId] });
      // The pool decides who a learner may book, so every Mentoring reader
      // that depends on it has to be refreshed too.
      queryClient.invalidateQueries({ queryKey: ["mentoring-receive-card"] });
      queryClient.invalidateQueries({ queryKey: ["mentors-for-enrollment"] });
    },
  });
}
