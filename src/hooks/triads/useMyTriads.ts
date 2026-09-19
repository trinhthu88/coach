import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { fetchTriadMembers, type TriadMember } from "./useTriadMembers";

export type TriadResponse = "pending" | "accepted" | "declined";
export type TriadSessionStatus = "proposed" | "confirmed" | "completed" | "cancelled";

export interface TriadMemberProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  /** Display order within the group (not a role — every member rotates roles). */
  slot: number;
  isSelf: boolean;
}

export interface TriadAlternativeView {
  id: string;
  proposedBySlot: number | null;
  startTime: string;
  endTime: string;
  myResponse: TriadResponse | null;
}

export interface TriadSessionView {
  id: string;
  /** Position within the group's sessions, in time order. */
  sessionNumber: number;
  status: TriadSessionStatus;
  /** The session's current effective time (proposed until everyone accepts, then agreed). */
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  meetingUrl: string | null;
  createdAt: string;
  /** Server rule: confirmed and its time has started. */
  canComplete: boolean;
  myResponse: TriadResponse | null;
  responses: { slot: number; response: TriadResponse }[];
  reflectionSubmitted: boolean;
  reflectionSatisfaction: number | null;
  /** Candidate replacement times — never the session time until every member accepts one. */
  pendingAlternatives: TriadAlternativeView[];
}

export interface TriadGroupEntry {
  enrollmentId: string;
  groupId: string;
  /** The cohort Triad requirement this group was assigned for ("Triad N"). */
  requirementId: string;
  unitNumber: number;
  /** That requirement's deadline. */
  dueOn: string;
  cohortId: string;
  groupLanguage: string;
  isActive: boolean;
  closedAt: string | null;
  createdAt: string;
  memberCount: number;
  mySlot: number;
  /** Every session of the group (normally one; a cancelled one may be replaced). */
  sessions: TriadSessionView[];
  /** The group's current session: the open one, else the latest. */
  session: TriadSessionView | null;
  members: TriadMemberProfile[];
}

interface RawSession {
  id: string;
  session_number: number;
  status: TriadSessionStatus;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  meeting_url: string | null;
  created_at: string;
  can_complete: boolean;
  my_response: TriadResponse | null;
  responses: { member_slot: number; response: TriadResponse }[];
  reflection_submitted: boolean;
  reflection_satisfaction: number | null;
  pending_proposals: { id: string; proposed_by_member_slot: number | null; start_time: string; end_time: string; my_response: TriadResponse | null }[];
}

function toSession(raw: RawSession): TriadSessionView {
  return {
    id: raw.id,
    sessionNumber: raw.session_number,
    status: raw.status,
    scheduledStartTime: raw.scheduled_start_time,
    scheduledEndTime: raw.scheduled_end_time,
    meetingUrl: raw.meeting_url,
    createdAt: raw.created_at,
    canComplete: raw.can_complete,
    myResponse: raw.my_response,
    responses: (raw.responses ?? []).map((r) => ({ slot: r.member_slot, response: r.response })),
    reflectionSubmitted: raw.reflection_submitted,
    reflectionSatisfaction: raw.reflection_satisfaction,
    pendingAlternatives: (raw.pending_proposals ?? []).map((p) => ({
      id: p.id,
      proposedBySlot: p.proposed_by_member_slot,
      startTime: p.start_time,
      endTime: p.end_time,
      myResponse: p.my_response,
    })),
  };
}

function currentSession(sessions: TriadSessionView[]): TriadSessionView | null {
  const open = sessions.filter((s) => s.status === "proposed" || s.status === "confirmed");
  return open[open.length - 1] ?? sessions[sessions.length - 1] ?? null;
}

function toMembers(members: TriadMember[] | undefined): TriadMemberProfile[] {
  return (members ?? []).map((m) => ({ id: m.id, full_name: m.full_name, avatar_url: m.avatar_url, slot: m.slot, isSelf: m.isSelf }));
}

/**
 * THE learner Triad read model: learner_triad_overview (the learner's
 * groups — one per Triad requirement, plus closed historical ones — with
 * numbered sessions, responses, alternatives and own reflection state) +
 * learner_triad_members for names. Nothing here computes a date, a
 * completion or an overdue state (see useMyTriadStatus).
 */
export async function fetchMyTriads(enrollmentId: string | null): Promise<TriadGroupEntry[]> {
  const { data, error } = await supabase.rpc("learner_triad_overview", { p_enrollment_id: enrollmentId ?? undefined });
  if (error) throw error;
  const rows = data ?? [];
  const membersByGroup = await fetchTriadMembers(rows.map((r) => r.triad_group_id));
  return rows.map((row) => {
    const sessions = ((row.sessions ?? []) as unknown as RawSession[]).map(toSession);
    return {
      enrollmentId: row.enrollment_id,
      groupId: row.triad_group_id,
      requirementId: row.cohort_requirement_date_id,
      unitNumber: row.unit_number,
      dueOn: row.due_on,
      cohortId: row.cohort_id,
      groupLanguage: row.group_language,
      isActive: row.is_active,
      closedAt: row.closed_at,
      createdAt: row.created_at,
      memberCount: row.member_count,
      mySlot: row.my_member_slot,
      sessions,
      session: currentSession(sessions),
      members: toMembers(membersByGroup.get(row.triad_group_id)),
    };
  });
}

/** One required Triad ("Triad N") of the learner, with its own deadline and group. */
export interface TriadMilestoneView {
  milestone: number;
  requirementId: string;
  dueOn: string;
  trainingWeekId: string | null;
  isDue: boolean;
  /** Fulfilled by a completed session of THIS requirement's group. */
  satisfied: boolean;
  fulfilledOn: string | null;
  overdue: boolean;
  triadGroupId: string | null;
}

interface RawMilestone {
  milestone: number;
  cohort_requirement_date_id: string;
  due_on: string;
  training_week_id: string | null;
  is_due: boolean;
  satisfied: boolean;
  fulfilled_on: string | null;
  overdue: boolean;
  triad_group_id: string | null;
}

/** The learner's canonical Triad status — the same projection Admin and Sponsor read. */
export interface TriadStatusView {
  requiredUnits: number;
  completedUnits: number;
  rawCompletedSessions: number;
  dueUnits: number;
  overdueUnits: number;
  bookedUnits: number;
  paceStatus: string;
  nextDueOn: string | null;
  schedule: TriadMilestoneView[];
}

export async function fetchMyTriadStatus(enrollmentId: string): Promise<TriadStatusView | null> {
  const { data, error } = await supabase.rpc("learner_triad_status", { p_enrollment_id: enrollmentId });
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    requiredUnits: row.required_units,
    completedUnits: row.completed_units,
    rawCompletedSessions: row.raw_completed_sessions,
    dueUnits: row.due_units,
    overdueUnits: row.overdue_units,
    bookedUnits: row.booked_units,
    paceStatus: row.pace_status,
    nextDueOn: row.next_due_on,
    schedule: ((row.schedule ?? []) as unknown as RawMilestone[]).map((m) => ({
      milestone: m.milestone,
      requirementId: m.cohort_requirement_date_id,
      dueOn: m.due_on,
      trainingWeekId: m.training_week_id,
      isDue: m.is_due,
      satisfied: m.satisfied,
      fulfilledOn: m.fulfilled_on,
      overdue: m.overdue,
      triadGroupId: m.triad_group_id,
    })),
  };
}

export const MY_TRIAD_STATUS_KEY = "my-triad-status";

export function useMyTriadStatus(enrollmentId: string | null | undefined) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: [MY_TRIAD_STATUS_KEY, user?.id, enrollmentId ?? null],
    queryFn: () => fetchMyTriadStatus(enrollmentId as string),
    enabled: !!user && !!enrollmentId,
  });
  return { status: query.data ?? null, loading: !!enrollmentId && query.isLoading, error: query.isError, refetch: query.refetch };
}

export const MY_TRIADS_KEY = "my-triads";

/** The learner's Triad groups — for one enrollment, or across all of them when none is given. */
export function useMyTriads(enrollmentId?: string | null) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: [MY_TRIADS_KEY, user?.id, enrollmentId ?? null],
    queryFn: () => fetchMyTriads(enrollmentId ?? null),
    enabled: !!user,
  });
  return { groups: query.data ?? [], loading: query.isLoading, error: query.isError, refetch: query.refetch };
}

/**
 * One Triad session resolved by id — for the session detail route. Any
 * session of any group the learner belongs to opens (earlier sessions,
 * completed ones, inactive groups), from the same read model.
 */
export function useTriadSessionEntry(sessionId: string | undefined) {
  const { groups, loading, error, refetch } = useMyTriads(null);
  const group = sessionId ? groups.find((g) => g.sessions.some((s) => s.id === sessionId)) ?? null : null;
  const entry = group ? { ...group, session: group.sessions.find((s) => s.id === sessionId) ?? null } : null;
  return { entry, loading: !!sessionId && loading, error, refetch };
}

/** "Waiting on …": members whose response to the current time is still pending. */
export function pendingMembers(entry: Pick<TriadGroupEntry, "members">, responses: { slot: number; response: TriadResponse }[]) {
  const pendingSlots = new Set(responses.filter((r) => r.response === "pending").map((r) => r.slot));
  return entry.members.filter((m) => pendingSlots.has(m.slot) && !m.isSelf);
}
