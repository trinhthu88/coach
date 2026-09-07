import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export interface TriadMemberProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
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
  round: {
    id: string;
    round_number: number;
    title: string;
    title_vi: string | null;
    completion_deadline: string;
    training_week_id: string | null;
    training_weeks: { title: string; title_vi: string | null; week_number: number } | null;
  };
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

      const memberIds = new Set<string>();
      for (const g of rows) {
        for (const id of [g.member_1_id, g.member_2_id, g.member_3_id]) if (id) memberIds.add(id);
      }
      const { data: profiles } = memberIds.size
        ? await supabase.from("profiles").select("id, full_name, avatar_url").in("id", [...memberIds])
        : { data: [] };
      const profileById = new Map((profiles ?? []).map((p) => [p.id, p as TriadMemberProfile]));

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
          const memberIdList = [g.member_1_id, g.member_2_id, g.member_3_id].filter(Boolean) as string[];
          const session = latestSessionByGroup.get(g.id) ?? null;
          return {
            round: g.triad_rounds,
            group: { id: g.id, group_language: g.group_language, member_1_id: g.member_1_id, member_2_id: g.member_2_id, member_3_id: g.member_3_id },
            session,
            members: memberIdList.map((id) => profileById.get(id)).filter(Boolean) as TriadMemberProfile[],
            reflectionSubmitted: session ? reflectedSessionIds.has(session.id) : false,
          };
        })
        .sort((a, b) => a.round.round_number - b.round.round_number);
    },
    enabled: !!user,
  });

  return { rounds: query.data ?? [], loading: query.isLoading, error: query.isError, refetch: query.refetch };
}
