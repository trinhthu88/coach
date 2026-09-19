import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Admin -> Cohort -> Triads read model. Three independent reads, so a
 * failure of the operational data (groups / learners) never turns the
 * programme requirement into "0 required":
 *   1. requirement — programme required Triad count + the cohort's
 *      cumulative Triad due dates (admin_cohort_triad_requirement)
 *   2. groups      — cohort-level groups, members and numbered sessions
 *                    (admin_cohort_triad_groups)
 *   3. learners    — each learner's canonical Triad completion, the same
 *                    projection Learner and Sponsor read
 *                    (admin_cohort_triad_learners -> canonical_triad_completion)
 * Nothing here computes a completion, a due date or an overdue state.
 */

export interface AdminTriadMilestone {
  milestone: number;
  /** Cumulative deadline: `milestone` completed Triad sessions by this date. */
  dueOn: string;
}

export interface AdminTriadRequirement {
  programmeId: string;
  programmeName: string;
  requiredUnits: number;
  schedule: AdminTriadMilestone[];
  scheduleState: string;
}

export interface AdminTriadMember {
  enrollmentId: string;
  userId: string;
  fullName: string;
  memberOrder: number;
}

export interface AdminTriadSession {
  id: string;
  sessionNumber: number;
  status: "proposed" | "confirmed" | "completed" | "cancelled";
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  reflectionCount: number;
}

export interface AdminTriadGroup {
  id: string;
  assignedBy: "auto" | "admin";
  groupLanguage: string;
  isActive: boolean;
  createdAt: string;
  closedAt: string | null;
  members: AdminTriadMember[];
  sessions: AdminTriadSession[];
}

export interface AdminTriadLearner {
  enrollmentId: string;
  userId: string;
  fullName: string;
  spokenLanguages: string[];
  programmeId: string;
  enrollmentStatus: string;
  isEligible: boolean;
  activeGroupId: string | null;
  requiredUnits: number;
  rawCompletedSessions: number;
  completedUnits: number;
  dueUnits: number;
  overdueUnits: number;
  nextDueOn: string | null;
}

export const ADMIN_COHORT_TRIADS_KEY = "admin-cohort-triads";

export function useAdminCohortTriadRequirement(cohortId: string | undefined) {
  const query = useQuery({
    queryKey: [ADMIN_COHORT_TRIADS_KEY, "requirement", cohortId],
    queryFn: async (): Promise<AdminTriadRequirement[]> => {
      const { data, error } = await supabase.rpc("admin_cohort_triad_requirement", { p_cohort_id: cohortId as string });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        programmeId: row.programme_id,
        programmeName: row.programme_name,
        requiredUnits: row.required_units,
        schedule: ((row.schedule ?? []) as unknown as { milestone: number; due_on: string }[]).map((m) => ({ milestone: m.milestone, dueOn: m.due_on })),
        scheduleState: row.schedule_state,
      }));
    },
    enabled: !!cohortId,
  });
  return { requirements: query.data ?? null, loading: query.isLoading, error: query.isError, refetch: query.refetch };
}

interface RawSession {
  id: string;
  session_number: number;
  status: AdminTriadSession["status"];
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  reflection_count: number;
}

export function useAdminCohortTriadGroups(cohortId: string | undefined) {
  const query = useQuery({
    queryKey: [ADMIN_COHORT_TRIADS_KEY, "groups", cohortId],
    queryFn: async (): Promise<AdminTriadGroup[]> => {
      const { data, error } = await supabase.rpc("admin_cohort_triad_groups", { p_cohort_id: cohortId as string });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.triad_group_id,
        assignedBy: row.assigned_by as AdminTriadGroup["assignedBy"],
        groupLanguage: row.group_language,
        isActive: row.is_active,
        createdAt: row.created_at,
        closedAt: row.closed_at,
        members: ((row.members ?? []) as unknown as { enrollment_id: string; user_id: string; full_name: string; member_order: number }[]).map((m) => ({
          enrollmentId: m.enrollment_id,
          userId: m.user_id,
          fullName: m.full_name,
          memberOrder: m.member_order,
        })),
        sessions: ((row.sessions ?? []) as unknown as RawSession[]).map((s) => ({
          id: s.id,
          sessionNumber: s.session_number,
          status: s.status,
          scheduledStartTime: s.scheduled_start_time,
          scheduledEndTime: s.scheduled_end_time,
          reflectionCount: s.reflection_count,
        })),
      }));
    },
    enabled: !!cohortId,
  });
  return { groups: query.data ?? [], loading: query.isLoading, error: query.isError, refetch: query.refetch };
}

export function useAdminCohortTriadLearners(cohortId: string | undefined) {
  const query = useQuery({
    queryKey: [ADMIN_COHORT_TRIADS_KEY, "learners", cohortId],
    queryFn: async (): Promise<AdminTriadLearner[]> => {
      const { data, error } = await supabase.rpc("admin_cohort_triad_learners", { p_cohort_id: cohortId as string });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        enrollmentId: row.enrollment_id,
        userId: row.user_id,
        fullName: row.full_name,
        spokenLanguages: row.spoken_languages ?? [],
        programmeId: row.programme_id,
        enrollmentStatus: row.enrollment_status,
        isEligible: row.is_eligible,
        activeGroupId: row.active_group_id,
        requiredUnits: row.required_units,
        rawCompletedSessions: row.raw_completed_sessions,
        completedUnits: row.completed_units,
        dueUnits: row.due_units,
        overdueUnits: row.overdue_units,
        nextDueOn: row.next_due_on,
      }));
    },
    enabled: !!cohortId,
  });
  return { learners: query.data ?? [], loading: query.isLoading, error: query.isError, refetch: query.refetch };
}

/** Cohort-scoped Admin Triad actions. */
export function useAdminTriadMutations(cohortId: string | undefined) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [ADMIN_COHORT_TRIADS_KEY] });

  const runAutoAssign = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("triad-auto-assign", { body: { cohort_id: cohortId } });
      if (error) throw error;
      return data as { groups: number; dyads: number; flagged: number };
    },
    onSettled: invalidate,
  });

  const sendReminders = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("triad-reminders", { body: { cohort_id: cohortId } });
      if (error) throw error;
    },
  });

  const createGroup = useMutation({
    mutationFn: async ({ enrollmentIds, language }: { enrollmentIds: string[]; language: string }) => {
      const { error } = await supabase.rpc("admin_triad_create_group", {
        p_cohort_id: cohortId as string,
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
    autoAssignRunning: runAutoAssign.isPending,
    remindersSending: sendReminders.isPending,
    isPending: createGroup.isPending || changeMember.isPending || setGroupActive.isPending,
  };
}
