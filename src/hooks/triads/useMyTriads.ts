import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { fetchTriadMembers, type TriadMember } from "./useTriadMembers";

export interface TriadMemberProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

function toMemberProfiles(members: TriadMember[] | undefined): TriadMemberProfile[] {
  return (members ?? []).map((m) => ({ id: m.id, full_name: m.full_name, avatar_url: m.avatar_url }));
}

export interface TriadGroupMembers {
  id: string;
  member_1_id: string;
  member_2_id: string;
  member_3_id: string | null;
}

export interface TriadSessionRow {
  id: string;
  status: "proposed" | "confirmed" | "completed" | "cancelled";
  proposed_start_time: string | null;
  proposed_end_time: string | null;
  proposed_by: string;
  member_1_response: "pending" | "accepted" | "declined";
  member_2_response: "pending" | "accepted" | "declined";
  member_3_response: "pending" | "accepted" | "declined" | null;
  meeting_url: string | null;
  notes: string | null;
}

export interface TriadRoundEntry {
  /** The admin-configured round. Null for groups created before rounds existed (triad_round_id IS NULL) — their sessions are still real history. */
  round: {
    id: string;
    round_number: number;
    title: string;
    title_vi: string | null;
    completion_deadline: string;
    training_week_id: string | null;
    training_weeks: { title: string; title_vi: string | null; week_number: number } | null;
  } | null;
  /** round.round_number, else the group's own round_number. */
  roundNumber: number | null;
  group: TriadGroupMembers & { group_language: string };
  session: TriadSessionRow | null;
  members: TriadMemberProfile[];
  reflectionSubmitted: boolean;
}

/**
 * All of the current user's active triad groups across every round in
 * their programme(s). Each group carries at most one "current" session
 * (the most recently created one) — a new session only gets created if an
 * admin re-runs auto-assign after the previous one was cleared.
 */
export function useMyTriads() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["my-triads", user?.id],
    queryFn: async (): Promise<TriadRoundEntry[]> => {
      const uid = user!.id;
      const { data: groups, error } = await supabase
        .from("triad_groups")
        .select(
          "id, group_language, member_1_id, member_2_id, member_3_id, " +
            "triad_rounds(id, round_number, title, title_vi, completion_deadline, training_week_id, training_weeks(title, title_vi, week_number)), " +
            "triad_sessions(id, status, proposed_start_time, proposed_end_time, proposed_by, member_1_response, member_2_response, member_3_response, meeting_url, notes, created_at)",
        )
        .or(`member_1_id.eq.${uid},member_2_id.eq.${uid},member_3_id.eq.${uid}`)
        .eq("is_active", true);
      if (error) throw error;

      interface RawTriadGroupRow {
        id: string;
        group_language: string;
        member_1_id: string;
        member_2_id: string;
        member_3_id: string | null;
        triad_rounds: TriadRoundEntry["round"];
        triad_sessions: (TriadSessionRow & { created_at: string })[];
      }
      const rows = (groups ?? []) as unknown as RawTriadGroupRow[];

      // Co-member identity from the one canonical Triad member source.
      const membersByGroup = await fetchTriadMembers(rows.map((g) => g.id));

      const sessionsById = new Map<string, TriadSessionRow>();
      const latestSessionByGroup = new Map<string, TriadSessionRow>();
      for (const g of rows) {
        const sessions = g.triad_sessions ?? [];
        const latest = [...sessions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
        if (latest) {
          sessionsById.set(latest.id, latest);
          latestSessionByGroup.set(g.id, latest);
        }
      }

      const sessionIds = [...sessionsById.keys()];
      const { data: reflections } = sessionIds.length
        ? await supabase
            .from("triad_reflections")
            .select("triad_session_id")
            .eq("participant_id", uid)
            .in("triad_session_id", sessionIds)
        : { data: [] };
      const reflectedSessionIds = new Set((reflections ?? []).map((r) => r.triad_session_id as string));

      return rows
        // Pre-redesign (v1) groups had no round at all — triad_round_id was
        // added nullable so those historical rows weren't force-migrated,
        // but they don't fit the round-based UI (no round_number, no
        // deadline). Their embedded triad_rounds comes back null since
        // there's no row to join to, not an empty object, so skip them here
        // rather than crash on `.round.round_number` below.
        .filter((g) => g.triad_rounds != null)
        .map((g) => {
          const session = latestSessionByGroup.get(g.id) ?? null;
          return {
            round: g.triad_rounds,
            roundNumber: g.triad_rounds?.round_number ?? null,
            group: { id: g.id, group_language: g.group_language, member_1_id: g.member_1_id, member_2_id: g.member_2_id, member_3_id: g.member_3_id },
            session,
            members: toMemberProfiles(membersByGroup.get(g.id)),
            reflectionSubmitted: session ? reflectedSessionIds.has(session.id) : false,
          };
        })
        .sort((a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0));
    },
    enabled: !!user,
  });

  return { rounds: query.data ?? [], loading: query.isLoading, error: query.isError, refetch: query.refetch };
}

/**
 * One triad session resolved by id — for the session detail route. Unlike
 * useMyTriads (current round-based groups, latest session per group), this
 * resolves ANY triad session the learner belongs to, including sessions in
 * legacy groups with no configured round and earlier sessions of a group,
 * so every triad row shown in Your Sessions / session history can open.
 */
export function useTriadSessionEntry(sessionId: string | undefined) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["triad-session-entry", sessionId, user?.id],
    queryFn: async (): Promise<TriadRoundEntry | null> => {
      const uid = user!.id;
      const { data: row, error } = await supabase
        .from("triad_sessions")
        .select(
          "id, status, proposed_start_time, proposed_end_time, proposed_by, member_1_response, member_2_response, member_3_response, meeting_url, notes, " +
            "triad_groups(id, group_language, member_1_id, member_2_id, member_3_id, round_number, " +
            "triad_rounds(id, round_number, title, title_vi, completion_deadline, training_week_id, training_weeks(title, title_vi, week_number)))",
        )
        .eq("id", sessionId as string)
        .maybeSingle();
      if (error) throw error;
      if (!row) return null;

      interface RawSession extends TriadSessionRow {
        triad_groups:
          | (TriadGroupMembers & { group_language: string; round_number: number | null; triad_rounds: TriadRoundEntry["round"] })
          | null;
      }
      const raw = row as unknown as RawSession;
      const group = raw.triad_groups;
      if (!group) return null;
      const memberIds = [group.member_1_id, group.member_2_id, group.member_3_id].filter(Boolean) as string[];
      if (!memberIds.includes(uid)) return null;

      const [membersByGroup, { data: reflections }] = await Promise.all([
        fetchTriadMembers([group.id]),
        supabase.from("triad_reflections").select("id").eq("participant_id", uid).eq("triad_session_id", raw.id),
      ]);
      const { triad_groups: _group, ...session } = raw;
      return {
        round: group.triad_rounds ?? null,
        roundNumber: group.triad_rounds?.round_number ?? group.round_number ?? null,
        group: {
          id: group.id,
          group_language: group.group_language,
          member_1_id: group.member_1_id,
          member_2_id: group.member_2_id,
          member_3_id: group.member_3_id,
        },
        session: session as TriadSessionRow,
        members: toMemberProfiles(membersByGroup.get(group.id)),
        reflectionSubmitted: (reflections ?? []).length > 0,
      };
    },
    enabled: !!user && !!sessionId,
  });

  return { entry: query.data ?? null, loading: query.isLoading, error: query.isError, refetch: query.refetch };
}
