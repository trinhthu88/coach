import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Admin -> Cohort -> Triads read model. EVERY REQUIRED TRIAD HAS ITS OWN
 * GROUP ASSIGNMENT: the cohort's Triad requirements ("Triad 1", "Triad 2",
 * … = cohort_requirement_dates) each get their own groups. Independent
 * reads, so a failure of the operational data never turns the programme
 * requirement into "0 required":
 *   1. requirement  — programme required Triad count + the cohort's Triad
 *                     deadlines (admin_cohort_triad_requirement)
 *   2. requirements — per Triad requirement: eligible / assigned / fulfilled
 *                     / overdue / reflections (admin_cohort_triad_requirements)
 *   3. groups       — every group with ITS requirement, members and sessions
 *                     (admin_cohort_triad_groups)
 *   4. learners     — each learner's canonical Triad completion, per
 *                     requirement, the same projection Learner and Sponsor
 *                     read (admin_cohort_triad_learners)
 *   5. candidates   — per requirement: eligible learners without an active
 *                     group for it, with their prior partners
 *                     (admin_triad_requirement_candidates)
 * Nothing here computes a completion, a due date or an overdue state.
 */

export interface AdminTriadMilestone {
  milestone: number;
  /** The deadline of Triad `milestone` (its own requirement). */
  dueOn: string;
}

export interface AdminTriadRequirementStats {
  requirementId: string;
  programmeId: string;
  unitNumber: number;
  dueOn: string;
  requiredUnits: number;
  eligible: number;
  assigned: number;
  fulfilled: number;
  overdue: number;
  activeGroups: number;
  reflectionsSubmitted: number;
  reflectionsExpected: number;
}

export interface AdminTriadCandidate {
  enrollmentId: string;
  userId: string;
  fullName: string;
  spokenLanguages: string[];
  priorPartnerEnrollmentIds: string[];
  priorPartnerNames: string[];
}

/** One Triad requirement of a learner (canonical_triad_completion.schedule). */
export interface AdminTriadLearnerRequirement {
  milestone: number;
  requirementId: string;
  dueOn: string;
  isDue: boolean;
  fulfilled: boolean;
  fulfilledOn: string | null;
  overdue: boolean;
  triadGroupId: string | null;
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
  requirementId: string;
  unitNumber: number;
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
  requiredUnits: number;
  rawCompletedSessions: number;
  completedUnits: number;
  dueUnits: number;
  overdueUnits: number;
  nextDueOn: string | null;
  requirements: AdminTriadLearnerRequirement[];
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
        requirementId: row.cohort_requirement_date_id,
        unitNumber: row.unit_number,
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

interface RawLearnerRequirement {
  milestone: number;
  cohort_requirement_date_id: string;
  due_on: string;
  is_due: boolean;
  fulfilled: boolean;
  fulfilled_on: string | null;
  overdue: boolean;
  triad_group_id: string | null;
}

export function useAdminCohortTriadRequirementStats(cohortId: string | undefined) {
  const query = useQuery({
    queryKey: [ADMIN_COHORT_TRIADS_KEY, "requirement-stats", cohortId],
    queryFn: async (): Promise<AdminTriadRequirementStats[]> => {
      const { data, error } = await supabase.rpc("admin_cohort_triad_requirements", { p_cohort_id: cohortId as string });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        requirementId: row.cohort_requirement_date_id,
        programmeId: row.programme_id,
        unitNumber: row.unit_number,
        dueOn: row.due_on,
        requiredUnits: row.required_units,
        eligible: row.eligible_enrollments,
        assigned: row.assigned_enrollments,
        fulfilled: row.fulfilled_enrollments,
        overdue: row.overdue_enrollments,
        activeGroups: row.active_groups,
        reflectionsSubmitted: row.reflections_submitted,
        reflectionsExpected: row.reflections_expected,
      }));
    },
    enabled: !!cohortId,
  });
  return { requirements: query.data ?? [], loading: query.isLoading, error: query.isError, refetch: query.refetch };
}

/** Eligible learners without an active group for this Triad requirement. */
export function useAdminTriadRequirementCandidates(requirementId: string | undefined) {
  const query = useQuery({
    queryKey: [ADMIN_COHORT_TRIADS_KEY, "candidates", requirementId],
    queryFn: async (): Promise<AdminTriadCandidate[]> => {
      const { data, error } = await supabase.rpc("admin_triad_requirement_candidates", {
        p_cohort_requirement_date_id: requirementId as string,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        enrollmentId: row.enrollment_id,
        userId: row.user_id,
        fullName: row.full_name,
        spokenLanguages: row.spoken_languages ?? [],
        priorPartnerEnrollmentIds: row.prior_partner_enrollment_ids ?? [],
        priorPartnerNames: row.prior_partner_names ?? [],
      }));
    },
    enabled: !!requirementId,
  });
  return { candidates: query.data ?? [], loading: query.isLoading, error: query.isError, refetch: query.refetch };
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
        requiredUnits: row.required_units,
        rawCompletedSessions: row.raw_completed_sessions,
        completedUnits: row.completed_units,
        dueUnits: row.due_units,
        overdueUnits: row.overdue_units,
        nextDueOn: row.next_due_on,
        requirements: ((row.requirements ?? []) as unknown as RawLearnerRequirement[]).map((r) => ({
          milestone: r.milestone,
          requirementId: r.cohort_requirement_date_id,
          dueOn: r.due_on,
          isDue: r.is_due,
          fulfilled: r.fulfilled,
          fulfilledOn: r.fulfilled_on,
          overdue: r.overdue,
          triadGroupId: r.triad_group_id,
        })),
      }));
    },
    enabled: !!cohortId,
  });
  return { learners: query.data ?? [], loading: query.isLoading, error: query.isError, refetch: query.refetch };
}

export interface AutoAssignResult {
  unit: number;
  groups: number;
  dyads: number;
  flagged: number;
  repeated_pairs: number;
}

/** Admin Triad actions. Assignment is always for ONE Triad requirement. */
export function useAdminTriadMutations(cohortId: string | undefined) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [ADMIN_COHORT_TRIADS_KEY] });

  const runAutoAssign = useMutation({
    mutationFn: async (requirementId: string) => {
      const { data, error } = await supabase.functions.invoke("triad-auto-assign", {
        body: { cohort_requirement_date_id: requirementId },
      });
      if (error) throw error;
      return data as AutoAssignResult;
    },
    onSettled: invalidate,
  });

  const sendReminders = useMutation({
    mutationFn: async (requirementId: string) => {
      const { error } = await supabase.functions.invoke("triad-reminders", {
        body: { cohort_id: cohortId, cohort_requirement_date_id: requirementId },
      });
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
    autoAssignRunning: runAutoAssign.isPending,
    remindersSending: sendReminders.isPending,
    isPending: createGroup.isPending || changeMember.isPending || setGroupActive.isPending,
  };
}
