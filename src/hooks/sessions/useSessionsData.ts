import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/context/AuthContext";
import type { Tables } from "@/integrations/supabase/types";
import type { SessionStatus } from "@/lib/sessionStatusMeta";
import { withEnrollmentActions, type EnrollmentActionItem } from "@/lib/enrollmentActions";
import { fetchMyTriads, type TriadGroupEntry, type TriadSessionView } from "@/hooks/triads/useMyTriads";

export type SessionKind =
  | "coaching"
  | "peer-give"
  | "peer-receive"
  | "coachee-peer-give"
  | "coachee-peer-receive"
  | "mentoring-mentor"
  | "mentoring-mentee"
  | "triad";

/** A Triad session in the unified list. Every member practises every role, so there is no per-session role. */
export interface TriadSessionContext {
  groupId: string;
  /** The Triad requirement of the session's group ("Triad N"). */
  unitNumber: number;
  participantIds: string[];
  participantNames: string[];
  meetingUrl: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
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
  /**
   * Which cohort Coaching requirement this session fulfils ("Coaching 2").
   * Null for peer/mentoring/triad rows and for legacy Coaching sessions that
   * predate the requirement link -- attribution is never invented for those.
   */
  coachingRequirementOrdinal: number | null;
  coachingRequirementDueOn: string | null;
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

export interface CoachingRequirementContext {
  ordinal: number;
  dueOn: string;
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

/** One Triad session of one of the learner's groups, as a unified session row. */
export function normalizeTriadSession(group: TriadGroupEntry, session: TriadSessionView) {
  return {
    id: session.id,
    enrollment_actions: [] as EnrollmentActionItem[],
    coach_id: "",
    coachee_id: "",
    topic: "",
    start_time: session.scheduledStartTime,
    duration_minutes: null,
    enrollment_id: group.enrollmentId,
    coachee_rating: null,
    coachee_rating_comment: null,
    status: session.status as SessionRow["status"],
    kind: "triad" as const,
    triad: {
      groupId: group.groupId,
      unitNumber: group.unitNumber,
      participantIds: group.members.map((m) => m.id),
      participantNames: group.members.map((m) => m.full_name),
      meetingUrl: session.meetingUrl,
      scheduledStartTime: session.scheduledStartTime,
      scheduledEndTime: session.scheduledEndTime,
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
  let triads: ReturnType<typeof normalizeTriadSession>[] = [];

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
    // Triads: every session of every group the learner's enrollments belong
    // to (canonical membership), from the one learner Triad read model.
    // Like every other source here, a failed Triad read must not hide the
    // learner's other sessions.
    const groups = await fetchMyTriads(null).catch((error) => {
      console.error("Triad sessions failed to load", error);
      return [];
    });
    triads = groups.flatMap((group) => group.sessions.map((session) => normalizeTriadSession(group, session)));
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
    ...triads,
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
  // Which Coaching requirement each session fulfils, so the Coach can see
  // WHICH programme unit an incoming request is for rather than just a date.
  //
  // Read through canonical_coaching_requirement_fulfilment rather than
  // cohort_requirement_dates: the requirement schedule has exactly one table
  // reader (the Admin schedule hook) so that no surface can reconstruct it,
  // and this function already maps session -> requirement for us.
  //
  // The requirement label is decoration on top of the session list: if this
  // lookup fails the rows must still render unlabelled, rather than the whole
  // list disappearing over a missing ordinal.
  const requirementBySession: Record<string, CoachingRequirementContext> = {};
  await Promise.all(
    enrollmentIds.map(async (enrollmentId) => {
      try {
        const { data } = await supabase.rpc("canonical_coaching_requirement_fulfilment", {
          p_enrollment_id: enrollmentId,
        });
        for (const row of data ?? []) {
          if (row.session_id && row.ordinal != null && row.due_on) {
            requirementBySession[row.session_id] = { ordinal: row.ordinal, dueOn: row.due_on };
          }
        }
      } catch (error) {
        console.error("Coaching requirement context failed to load", error);
      }
    }),
  );

  const rowsWithContext = attachEnrollmentContext(allRows, enrollmentContexts).map((row) => {
    const req = requirementBySession[row.id];
    return {
      ...row,
      coachingRequirementOrdinal: req?.ordinal ?? null,
      coachingRequirementDueOn: req?.dueOn ?? null,
    };
  });

  const ids = Array.from(new Set(rowsWithContext.flatMap((s) => [s.coach_id, s.coachee_id]))).filter(Boolean);
  let byId = new Map<string, Pick<Tables<"profiles">, "id" | "full_name" | "email" | "avatar_url">>();
  if (ids.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", ids);
    byId = new Map((profs || []).map((p) => [p.id, p]));
  }

  return rowsWithContext.map((s) => ({
    ...s,
    coach: byId.get(s.coach_id) || null,
    coachee: byId.get(s.coachee_id) || null,
    // Triad participant names come from the one canonical Triad member source.
    triad: s.kind === "triad" && "triad" in s ? (s.triad as TriadSessionContext) : null,
  }));
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
