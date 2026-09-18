import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/context/AuthContext";
import type { Tables } from "@/integrations/supabase/types";
import type { SessionStatus } from "@/lib/sessionStatusMeta";
import { withEnrollmentActions, type EnrollmentActionItem } from "@/lib/enrollmentActions";
import { fetchTriadMembers, type TriadMember } from "@/hooks/triads/useTriadMembers";

export type SessionKind =
  | "coaching"
  | "peer-give"
  | "peer-receive"
  | "coachee-peer-give"
  | "coachee-peer-receive"
  | "mentoring-mentor"
  | "mentoring-mentee"
  | "triad";

export interface TriadSessionContext {
  groupId: string;
  role: "coach" | "coachee" | "observer" | null;
  roundNumber: number | null;
  roundTitle: string | null;
  weekNumber: number | null;
  participantIds: string[];
  participantNames: string[];
  meetingUrl: string | null;
  proposedStartTime: string | null;
  proposedEndTime: string | null;
}

export interface SessionRow {
  id: string;
  coach_id: string;
  coachee_id: string;
  topic: string;
  start_time: string | null;
  duration_minutes: number | null;
  status: SessionStatus | "proposed";
  enrollment_id: string | null;
  programmeName: string | null;
  cohortName: string | null;
  enrollment_actions: import("@/lib/enrollmentActions").EnrollmentActionItem[];
  coachee_rating: number | null;
  coachee_rating_comment: string | null;
  kind: SessionKind;
  coach: { full_name: string; email: string; avatar_url: string | null } | null;
  coachee: { full_name: string; email: string; avatar_url: string | null } | null;
  triad: TriadSessionContext | null;
}

export interface SessionEnrollmentContext {
  programmeName: string | null;
  cohortName: string | null;
}

export function attachEnrollmentContext<T extends { enrollment_id?: string | null }>(
  rows: T[],
  contexts: Record<string, SessionEnrollmentContext>
): (T & SessionEnrollmentContext)[] {
  return rows.map((row) => ({
    ...row,
    programmeName: row.enrollment_id ? contexts[row.enrollment_id]?.programmeName ?? null : null,
    cohortName: row.enrollment_id ? contexts[row.enrollment_id]?.cohortName ?? null : null,
  }));
}

export type TriadSessionSourceRow = Tables<"triad_sessions"> & {
  triad_groups: {
    id: string;
    member_1_id: string;
    member_2_id: string;
    member_3_id: string | null;
    round_number: number | null;
    triad_rounds: {
      round_number: number;
      title: string | null;
      training_weeks: { week_number: number } | null;
    } | null;
  } | null;
};

export function getTriadRole(
  session: Pick<TriadSessionSourceRow, "coach_enrollment_id" | "coachee_enrollment_id" | "observer_enrollment_id">,
  enrollmentIds: ReadonlySet<string>
): TriadSessionContext["role"] {
  if (enrollmentIds.has(session.coach_enrollment_id)) return "coach";
  if (enrollmentIds.has(session.coachee_enrollment_id)) return "coachee";
  if (session.observer_enrollment_id && enrollmentIds.has(session.observer_enrollment_id)) return "observer";
  return null;
}

export function normalizeTriadSession(
  session: TriadSessionSourceRow,
  enrollmentIds: ReadonlySet<string>
) {
  const group = session.triad_groups;
  const round = group?.triad_rounds;
  const role = getTriadRole(session, enrollmentIds);
  return {
    ...session,
    enrollment_actions: [] as EnrollmentActionItem[],
    coach_id: "",
    coachee_id: "",
    topic: round?.title ?? "",
    start_time: session.start_time ?? session.proposed_start_time,
    duration_minutes: null,
    enrollment_id:
      role === "coach"
        ? session.coach_enrollment_id
        : role === "coachee"
          ? session.coachee_enrollment_id
          : session.observer_enrollment_id,
    coachee_rating: null,
    coachee_rating_comment: null,
    status: session.status as SessionRow["status"],
    kind: "triad" as const,
    triad: {
      groupId: session.triad_group_id,
      role,
      roundNumber: round?.round_number ?? group?.round_number ?? null,
      roundTitle: round?.title ?? null,
      weekNumber: round?.training_weeks?.week_number ?? null,
      participantIds: group
        ? [group.member_1_id, group.member_2_id, group.member_3_id].filter(Boolean)
        : [],
      participantNames: [],
      meetingUrl: session.meeting_url,
      proposedStartTime: session.proposed_start_time,
      proposedEndTime: session.proposed_end_time,
    } satisfies TriadSessionContext,
  };
}

async function fetchSessionsData(userId: string, role: AppRole): Promise<SessionRow[]> {
  type Enriched<T extends { id: string; enrollment_id?: string | null }> = T & {
    enrollment_actions: EnrollmentActionItem[];
  };
  let sess: Enriched<Tables<"sessions">>[] = [];
  let peer: Enriched<Tables<"peer_sessions">>[] = [];
  let coacheePeer: Enriched<Tables<"coachee_peer_sessions">>[] = [];
  let mentoring: Enriched<Tables<"mentoring_sessions">>[] = [];
  let triads: TriadSessionSourceRow[] = [];
  const enrollmentRoleById = new Set<string>();

  if (role === "coach" || role === "coachee") {
    const col = role === "coach" ? "coach_id" : "coachee_id";
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .eq(col, userId)
      .order("start_time", { ascending: false });
    sess = await withEnrollmentActions(data || [], "coaching");
  }

  if (role === "coach") {
    const { data } = await supabase
      .from("peer_sessions")
      .select("*")
      .or(`peer_coach_id.eq.${userId},peer_coachee_id.eq.${userId}`)
      .order("start_time", { ascending: false });
    peer = await withEnrollmentActions(data || [], "peer_coaching");
  }

  if (role === "coachee") {
    const { data } = await supabase
      .from("coachee_peer_sessions")
      .select("*")
      .or(`peer_provider_id.eq.${userId},peer_receiver_id.eq.${userId}`)
      .order("start_time", { ascending: false });
    coacheePeer = await withEnrollmentActions(data || [], "coachee_peer_coaching");
  }

  // Mentoring: a mentee can be either role (coach or coachee, RULES.md §3
  // Relationship 4), and a coach can also be a mentor giving sessions —
  // so this queries both mentor_id and mentee_id rather than switching
  // column by role the way the blocks above do.
  if (role === "coach" || role === "coachee") {
    const { data } = await supabase
      .from("mentoring_sessions")
      .select("*")
      .or(`mentor_id.eq.${userId},mentee_id.eq.${userId}`)
      .order("start_time", { ascending: false });
    mentoring = await withEnrollmentActions(data || [], "mentoring");
  }

  if (role === "coach" || role === "coachee") {
    // Triads are linked to enrollments rather than directly to the
    // participant's user id. Fetch all of this learner's enrollment ids first
    // so sessions from another participant or unrelated programme cannot leak
    // into the unified list.
    const { data: enrollments } = await supabase
      .from("programme_enrollments")
      .select("id")
      .eq("user_id", userId);
    const enrollmentIds = (enrollments ?? []).map((enrollment) => enrollment.id);
    enrollmentIds.forEach((id) => enrollmentRoleById.add(id));
    if (enrollmentIds.length > 0) {
      const membershipFilter = enrollmentIds
        .flatMap((id) => [
          `coach_enrollment_id.eq.${id}`,
          `coachee_enrollment_id.eq.${id}`,
          `observer_enrollment_id.eq.${id}`,
        ])
        .join(",");
      const { data } = await supabase
        .from("triad_sessions")
        .select(
          "id, status, start_time, proposed_start_time, proposed_end_time, meeting_url, notes, proposed_by, member_1_response, member_2_response, member_3_response, created_at, updated_at, triad_group_id, coach_enrollment_id, coachee_enrollment_id, observer_enrollment_id, triad_groups(id, member_1_id, member_2_id, member_3_id, round_number, triad_rounds(round_number, title, training_weeks(week_number)))"
        )
        .or(membershipFilter)
        .order("start_time", { ascending: false, nullsFirst: false });
      triads = (data ?? []) as unknown as TriadContextRow[];
    }
  }

  const allRows = [
    ...sess.map((s) => ({ ...s, kind: "coaching" as SessionKind })),
    ...peer.map((s) => ({
      ...s,
      coach_id: s.peer_coach_id,
      coachee_id: s.peer_coachee_id,
      kind: (s.peer_coach_id === userId ? "peer-give" : "peer-receive") as SessionKind,
    })),
    ...coacheePeer.map((s) => ({
      ...s,
      coach_id: s.peer_provider_id,
      coachee_id: s.peer_receiver_id,
      coach_notes: s.provider_notes,
      coachee_notes: s.receiver_notes,
      coachee_rating: s.receiver_rating,
      coachee_rating_comment: s.receiver_rating_comment,
      kind: (s.peer_provider_id === userId ? "coachee-peer-give" : "coachee-peer-receive") as SessionKind,
    })),
    // mentoring_sessions has no rating column (mentors give written ICF
    // feedback instead, via mentoring_feedback — see MentoringSessionDetail).
    ...mentoring.map((s) => ({
      ...s,
      coach_id: s.mentor_id,
      coachee_id: s.mentee_id,
      coach_notes: s.mentor_notes,
      coachee_notes: s.mentee_notes,
      coachee_rating: null,
      coachee_rating_comment: null,
      kind: (s.mentor_id === userId ? "mentoring-mentor" : "mentoring-mentee") as SessionKind,
    })),
    ...triads.map((s) => normalizeTriadSession(s, enrollmentRoleById)),
  ].sort((a, b) => {
    const at = a.start_time ? new Date(a.start_time).getTime() : 0;
    const bt = b.start_time ? new Date(b.start_time).getTime() : 0;
    return bt - at;
  });

  const enrollmentIds = Array.from(new Set(allRows.map((row) => row.enrollment_id).filter((id): id is string => Boolean(id))));
  const enrollmentContexts: Record<string, SessionEnrollmentContext> = {};
  if (enrollmentIds.length > 0) {
    const { data: enrollmentRows } = await supabase.from("programme_enrollments").select("id, programmes(name), cohorts(name)").in("id", enrollmentIds);
    for (const row of enrollmentRows ?? []) {
      const programme = row.programmes as { name?: string | null } | null;
      const cohort = row.cohorts as { name?: string | null } | null;
      enrollmentContexts[row.id] = { programmeName: programme?.name ?? null, cohortName: cohort?.name ?? null };
    }
  }
  const rowsWithContext = attachEnrollmentContext(allRows, enrollmentContexts);

  const ids = Array.from(new Set(rowsWithContext.flatMap((s) => [s.coach_id, s.coachee_id]))).filter(Boolean);
  // Triad participant names come from the one canonical Triad member source
  // (membership from triad_groups), not from profiles discovery.
  const triadGroupIds = triads.map((session) => session.triad_group_id);
  const triadMembers = await fetchTriadMembers(triadGroupIds).catch(() => new Map<string, TriadMember[]>());
  let byId = new Map<string, Pick<Tables<"profiles">, "id" | "full_name" | "email" | "avatar_url">>();
  if (ids.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", ids);
    byId = new Map((profs || []).map((p) => [p.id, p]));
  }

  return rowsWithContext.map((s) => {
    const triad =
      s.kind === "triad" && s.triad
        ? {
            ...s.triad,
            participantNames: (triadMembers.get(s.triad.groupId) ?? []).map((member) => member.full_name),
          }
        : null;
    return {
      ...s,
      coach: byId.get(s.coach_id) || null,
      coachee: byId.get(s.coachee_id) || null,
      triad,
    };
  });
}

export function useSessionsData(userId: string | undefined, role: AppRole | null) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sessions-list", userId, role],
    queryFn: () => fetchSessionsData(userId as string, role as AppRole),
    enabled: !!userId,
    staleTime: 30_000,
  });

  return { sessions: data ?? [], loading: isLoading, reload: refetch };
}
