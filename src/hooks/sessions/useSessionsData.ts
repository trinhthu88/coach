import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/context/AuthContext";
import type { Tables } from "@/integrations/supabase/types";
import type { SessionStatus } from "@/lib/sessionStatusMeta";
import { withEnrollmentActions, type EnrollmentActionItem } from "@/lib/enrollmentActions";

export type SessionKind =
  | "coaching"
  | "peer-give"
  | "peer-receive"
  | "coachee-peer-give"
  | "coachee-peer-receive"
  | "mentoring-mentor"
  | "mentoring-mentee";

export interface SessionRow {
  id: string;
  coach_id: string;
  coachee_id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: SessionStatus;
  enrollment_id: string | null;
  enrollment_actions: import("@/lib/enrollmentActions").EnrollmentActionItem[];
  coachee_rating: number | null;
  coachee_rating_comment: string | null;
  kind: SessionKind;
  coach: { full_name: string; email: string; avatar_url: string | null } | null;
  coachee: { full_name: string; email: string; avatar_url: string | null } | null;
}

async function fetchSessionsData(userId: string, role: AppRole): Promise<SessionRow[]> {
  type Enriched<T extends { id: string; enrollment_id?: string | null }> = T & {
    enrollment_actions: EnrollmentActionItem[];
  };
  let sess: Enriched<Tables<"sessions">>[] = [];
  let peer: Enriched<Tables<"peer_sessions">>[] = [];
  let coacheePeer: Enriched<Tables<"coachee_peer_sessions">>[] = [];
  let mentoring: Enriched<Tables<"mentoring_sessions">>[] = [];

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
  ].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

  const ids = Array.from(new Set(allRows.flatMap((s) => [s.coach_id, s.coachee_id])));
  let byId = new Map<string, Pick<Tables<"profiles">, "id" | "full_name" | "email" | "avatar_url">>();
  if (ids.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", ids);
    byId = new Map((profs || []).map((p) => [p.id, p]));
  }

  return allRows.map((s) => ({
    ...s,
    coach: byId.get(s.coach_id) || null,
    coachee: byId.get(s.coachee_id) || null,
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
