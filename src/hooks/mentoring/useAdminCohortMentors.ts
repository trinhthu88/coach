import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const ADMIN_COHORT_MENTORS_KEY = "admin-cohort-mentors";

export interface CohortMentorRow {
  mentorUserId: string;
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
 * Admin view of a cohort's Mentoring assignments: which Coaches act as Mentor
 * here, plus every other Coach who could.
 *
 * A Mentor is not a user type. It is a Coach with a cohort Mentoring
 * assignment, so the candidate population is the SAME Coach population
 * useAdminCohortCoaches draws on. This hook previously listed mentor_profiles
 * rows, which is why a system full of Coaches showed "no mentors exist yet".
 *
 * Coaching and Mentoring assignments stay independent: appearing here says
 * nothing about cohort_coach_assignments, and nothing is copied between them.
 */
export function useAdminCohortMentors(cohortId: string | undefined) {
  return useQuery({
    queryKey: [ADMIN_COHORT_MENTORS_KEY, cohortId],
    enabled: !!cohortId,
    queryFn: async (): Promise<CohortMentorRow[]> => {
      const [{ data: assignments, error: aErr }, { data: coachRoles, error: rErr }] =
        await Promise.all([
          supabase
            .from("cohort_mentors")
            .select("mentor_user_id, is_active, assigned_at")
            .eq("cohort_id", cohortId!),
          supabase.from("user_roles").select("user_id").eq("role", "coach"),
        ]);
      if (aErr) throw aErr;
      if (rErr) throw rErr;

      const assignedById = new Map((assignments ?? []).map((a) => [a.mentor_user_id, a]));
      const roleIds = Array.from(new Set((coachRoles ?? []).map((r) => r.user_id)));
      const ids = Array.from(
        new Set([
          ...roleIds,
          // Anyone already assigned stays listed even if their Coach role or
          // account status has since changed, so the Admin can see and undo it.
          ...assignedById.keys(),
        ]),
      );
      if (ids.length === 0) return [];

      const [{ data: profiles, error: pErr }, { data: coachProfiles, error: cpErr }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, status").in("id", ids),
        supabase.from("coach_profiles").select("id, title").in("id", ids),
      ]);
      if (pErr) throw pErr;
      if (cpErr) throw cpErr;

      const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      const activeCoachIds = new Set(
        roleIds.filter((id) => profileById.get(id)?.status === "active"),
      );
      const visibleIds = ids.filter((id) => assignedById.has(id) || activeCoachIds.has(id));

      return visibleIds
        .map((id) => {
          const a = assignedById.get(id);
          const profile = profileById.get(id);
          return {
            mentorUserId: id,
            fullName: profile?.full_name ?? "Coach",
            title: coachProfiles?.find((p) => p.id === id)?.title ?? null,
            isActive: !!a?.is_active,
            accountActive: profile?.status === "active",
            assignedAt: a?.assigned_at ?? null,
            isCandidate: !a,
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
