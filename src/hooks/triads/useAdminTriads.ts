import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AdminTriadMember {
  enrollment_id: string;
  user_id: string;
  full_name: string;
  member_order: number;
}

export interface AdminTriadGroup {
  id: string;
  assigned_by: "auto" | "admin";
  group_language: string;
  is_active: boolean;
  created_at: string;
  members: AdminTriadMember[];
  session: { id: string; status: string; scheduled_start_time: string | null; scheduled_end_time: string | null } | null;
  reflection_count: number;
}

/** One cohort Triad requirement unit, as Admin -> Cohort -> Triads shows it. */
export interface AdminTriadRequirement {
  requirementId: string;
  programmeId: string;
  unitNumber: number;
  /** Canonical due date (cohort_requirement_dates) — never entered here. */
  dueOn: string;
  requiredUnits: number;
  isOperational: boolean;
  assignmentStatus: "not_started" | "running" | "completed" | "failed";
  lastAssignmentRunAt: string | null;
  eligibleEnrollments: number;
  assignedEnrollments: number;
  completedEnrollments: number;
  /** Canonical: unit due, not yet completed (from canonical module progress). */
  overdueEnrollments: number;
  groups: AdminTriadGroup[];
}

export interface AdminTriadCandidate {
  enrollment_id: string;
  user_id: string;
  full_name: string;
  spoken_languages: string[];
  triad_group_id: string | null;
}

export const ADMIN_COHORT_TRIADS_KEY = "admin-cohort-triads";

/** The cohort's Triad requirement units with groups and canonical unit state. */
export function useAdminCohortTriads(cohortId: string | undefined) {
  const query = useQuery({
    queryKey: [ADMIN_COHORT_TRIADS_KEY, cohortId],
    queryFn: async (): Promise<AdminTriadRequirement[]> => {
      const { data, error } = await supabase.rpc("admin_cohort_triad_requirements", { p_cohort_id: cohortId as string });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        requirementId: row.cohort_requirement_date_id,
        programmeId: row.programme_id,
        unitNumber: row.unit_number,
        dueOn: row.due_on,
        requiredUnits: row.required_units,
        isOperational: row.is_operational,
        assignmentStatus: row.assignment_status as AdminTriadRequirement["assignmentStatus"],
        lastAssignmentRunAt: row.last_assignment_run_at,
        eligibleEnrollments: row.eligible_enrollments,
        assignedEnrollments: row.assigned_enrollments,
        completedEnrollments: row.completed_enrollments,
        overdueEnrollments: row.overdue_enrollments,
        groups: (row.groups ?? []) as unknown as AdminTriadGroup[],
      }));
    },
    enabled: !!cohortId,
  });
  return { requirements: query.data ?? [], loading: query.isLoading, error: query.isError, refetch: query.refetch };
}

/** Manual-assignment pool: ongoing enrollments of THIS requirement's cohort only. */
export function useAdminTriadCandidates(requirementId: string | undefined) {
  const query = useQuery({
    queryKey: ["admin-triad-candidates", requirementId],
    queryFn: async (): Promise<AdminTriadCandidate[]> => {
      const { data, error } = await supabase.rpc("admin_triad_requirement_candidates", { p_cohort_requirement_date_id: requirementId as string });
      if (error) throw error;
      return (data ?? []).map((c) => ({
        enrollment_id: c.enrollment_id,
        user_id: c.user_id,
        full_name: c.full_name,
        spoken_languages: c.spoken_languages ?? [],
        triad_group_id: c.triad_group_id,
      }));
    },
    enabled: !!requirementId,
  });
  return { candidates: query.data ?? [], loading: query.isLoading };
}

/** Requirement-scoped Admin Triad actions. */
export function useAdminTriadMutations(cohortId: string | undefined) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [ADMIN_COHORT_TRIADS_KEY, cohortId] });
    queryClient.invalidateQueries({ queryKey: ["admin-triad-candidates"] });
  };

  const runAutoAssign = useMutation({
    mutationFn: async (requirementId: string) => {
      const { data, error } = await supabase.functions.invoke("triad-auto-assign", { body: { cohort_requirement_date_id: requirementId } });
      if (error) throw error;
      return data as { groups: number; dyads: number; flagged: number };
    },
    onSettled: invalidate,
  });

  const sendReminders = useMutation({
    mutationFn: async (requirementId: string) => {
      const { error } = await supabase.functions.invoke("triad-reminders", { body: { cohort_requirement_date_id: requirementId } });
      if (error) throw error;
    },
  });

  const createGroup = useMutation({
    mutationFn: async ({ requirementId, enrollmentIds, language }: { requirementId: string; enrollmentIds: string[]; language: string }) => {
      const { error } = await supabase.rpc("admin_triad_create_group", {
        p_cohort_requirement_date_id: requirementId,
        p_enrollment_ids: enrollmentIds,
        p_group_language: language,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const changeMember = useMutation({
    mutationFn: async ({ groupId, removeEnrollmentId, addEnrollmentId }: { groupId: string; removeEnrollmentId: string | null; addEnrollmentId: string | null }) => {
      const { error } = await supabase.rpc("admin_triad_change_member", {
        p_group_id: groupId,
        p_remove_enrollment_id: removeEnrollmentId ?? undefined,
        p_add_enrollment_id: addEnrollmentId ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setGroupActive = useMutation({
    mutationFn: async ({ groupId, isActive }: { groupId: string; isActive: boolean }) => {
      const { error } = await supabase.rpc("admin_triad_set_group_active", { p_group_id: groupId, p_is_active: isActive });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    runAutoAssign: runAutoAssign.mutateAsync,
    sendReminders: sendReminders.mutateAsync,
    createGroup: createGroup.mutateAsync,
    changeMember: changeMember.mutateAsync,
    setGroupActive: setGroupActive.mutateAsync,
    runningAutoAssignFor: runAutoAssign.isPending ? runAutoAssign.variables : null,
    sendingRemindersFor: sendReminders.isPending ? sendReminders.variables : null,
    isPending: createGroup.isPending || changeMember.isPending || setGroupActive.isPending,
  };
}
