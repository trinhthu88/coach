import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TriadRoundRow {
  id: string;
  programme_id: string;
  round_number: number;
  title: string;
  title_vi: string | null;
  training_week_id: string | null;
  completion_deadline: string;
  auto_assign_date: string;
  auto_assign_status: "pending" | "running" | "completed" | "failed";
  is_visible: boolean;
}

export interface TriadGroupAdminRow {
  id: string;
  triad_round_id: string;
  member_1_id: string;
  member_2_id: string;
  member_3_id: string | null;
  assigned_by: "auto" | "admin";
  group_language: string;
  is_active: boolean;
  session: { id: string; status: string; proposed_start_time: string | null } | null;
  reflectionCount: number;
}

export interface TriadParticipant {
  id: string;
  full_name: string;
  spoken_languages: string[];
}

/** All triad rounds for a programme, newest round_number first — admin sees hidden rounds too. */
export function useAdminTriadRounds(programmeId: string | undefined) {
  const query = useQuery({
    queryKey: ["admin-triad-rounds", programmeId],
    queryFn: async (): Promise<TriadRoundRow[]> => {
      const { data, error } = await supabase
        .from("triad_rounds")
        .select("*")
        .eq("programme_id", programmeId as string)
        .order("round_number", { ascending: false });
      if (error) throw error;
      return data as TriadRoundRow[];
    },
    enabled: !!programmeId,
  });
  return { rounds: query.data ?? [], loading: query.isLoading, refetch: query.refetch };
}

/** Every group in a round, with its most recent session and reflection completion count. */
export function useAdminTriadGroups(roundId: string | undefined) {
  const query = useQuery({
    queryKey: ["admin-triad-groups", roundId],
    queryFn: async (): Promise<TriadGroupAdminRow[]> => {
      const { data: groups, error } = await supabase
        .from("triad_groups")
        .select(
          "id, triad_round_id, member_1_id, member_2_id, member_3_id, assigned_by, group_language, is_active, " +
            "triad_sessions(id, status, proposed_start_time, created_at)",
        )
        .eq("triad_round_id", roundId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;

      interface RawGroupRow {
        id: string;
        triad_round_id: string;
        member_1_id: string;
        member_2_id: string;
        member_3_id: string | null;
        assigned_by: "auto" | "admin";
        group_language: string;
        is_active: boolean;
        triad_sessions: { id: string; status: string; proposed_start_time: string | null; created_at: string }[];
      }
      const rows = (groups ?? []) as unknown as RawGroupRow[];
      const sessionByGroup = new Map<string, { id: string; status: string; proposed_start_time: string | null }>();
      const allSessionIds: string[] = [];
      for (const g of rows) {
        const sessions = (g.triad_sessions ?? []) as { id: string; status: string; proposed_start_time: string | null; created_at: string }[];
        const latest = [...sessions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
        if (latest) {
          sessionByGroup.set(g.id, latest);
          allSessionIds.push(latest.id);
        }
      }

      const reflectionCountBySession = new Map<string, number>();
      if (allSessionIds.length > 0) {
        const { data: reflections } = await supabase
          .from("triad_reflections")
          .select("triad_session_id")
          .in("triad_session_id", allSessionIds);
        for (const r of reflections ?? []) {
          const id = r.triad_session_id as string;
          reflectionCountBySession.set(id, (reflectionCountBySession.get(id) ?? 0) + 1);
        }
      }

      return rows.map((g) => {
        const session = sessionByGroup.get(g.id) ?? null;
        return {
          id: g.id,
          triad_round_id: g.triad_round_id,
          member_1_id: g.member_1_id,
          member_2_id: g.member_2_id,
          member_3_id: g.member_3_id,
          assigned_by: g.assigned_by,
          group_language: g.group_language,
          is_active: g.is_active,
          session,
          reflectionCount: session ? reflectionCountBySession.get(session.id) ?? 0 : 0,
        };
      });
    },
    enabled: !!roundId,
  });
  return { groups: query.data ?? [], loading: query.isLoading, refetch: query.refetch };
}

/** Active enrollees for a programme — the pool admin picks manual group members from. */
export function useAdminTriadParticipants(programmeId: string | undefined) {
  const query = useQuery({
    queryKey: ["admin-triad-participants", programmeId],
    queryFn: async (): Promise<TriadParticipant[]> => {
      const { data: enrollments, error } = await supabase
        .from("programme_enrollments")
        .select("user_id")
        .eq("programme_id", programmeId as string)
        .eq("status", "active");
      if (error) throw error;
      const userIds = [...new Set((enrollments ?? []).map((e) => e.user_id as string))];
      if (userIds.length === 0) return [];
      const { data: profiles, error: profileErr } = await supabase
        .from("profiles")
        .select("id, full_name, spoken_languages")
        .in("id", userIds);
      if (profileErr) throw profileErr;
      return ((profiles ?? []) as TriadParticipant[]).sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
    enabled: !!programmeId,
  });
  return { participants: query.data ?? [], loading: query.isLoading };
}

export interface CreateTriadRoundInput {
  programme_id: string;
  round_number: number;
  title: string;
  title_vi: string | null;
  training_week_id: string | null;
  completion_deadline: string;
  auto_assign_date: string;
  is_visible: boolean;
}

/** Mutations for the admin triads page. */
export function useAdminTriadMutations() {
  const queryClient = useQueryClient();

  const invalidateRounds = (programmeId?: string) =>
    queryClient.invalidateQueries({ queryKey: ["admin-triad-rounds", programmeId] });
  const invalidateGroups = (roundId?: string) =>
    queryClient.invalidateQueries({ queryKey: ["admin-triad-groups", roundId] });

  const createRound = useMutation({
    mutationFn: async (input: CreateTriadRoundInput) => {
      const { error } = await supabase.from("triad_rounds").insert(input);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => invalidateRounds(vars.programme_id),
  });

  const setRoundVisible = useMutation({
    mutationFn: async ({ roundId, isVisible, programmeId }: { roundId: string; isVisible: boolean; programmeId: string }) => {
      const { error } = await supabase.from("triad_rounds").update({ is_visible: isVisible }).eq("id", roundId);
      if (error) throw error;
      return programmeId;
    },
    onSuccess: (programmeId) => invalidateRounds(programmeId),
  });

  const runAutoAssign = useMutation({
    mutationFn: async (roundId: string) => {
      const { data, error } = await supabase.functions.invoke("triad-auto-assign", { body: { round_id: roundId } });
      if (error) throw error;
      return data as { groups: number; dyads: number; flagged: number };
    },
    onSuccess: (_r, roundId) => invalidateGroups(roundId),
  });

  const sendReminders = useMutation({
    mutationFn: async (roundId: string) => {
      const { error } = await supabase.functions.invoke("triad-reminders", { body: { round_id: roundId } });
      if (error) throw error;
    },
  });

  const createGroup = useMutation({
    mutationFn: async ({
      roundId,
      programmeId,
      memberIds,
      language,
    }: {
      roundId: string;
      programmeId: string;
      memberIds: [string, string, string | null];
      language: string;
    }) => {
      const { data: group, error } = await supabase
        .from("triad_groups")
        .insert({
          triad_round_id: roundId,
          programme_id: programmeId,
          member_1_id: memberIds[0],
          member_2_id: memberIds[1],
          member_3_id: memberIds[2],
          assigned_by: "admin",
          group_language: language,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: sessionErr } = await supabase.from("triad_sessions").insert({
        triad_group_id: group.id,
        proposed_by: "system",
        status: "proposed",
        member_3_response: memberIds[2] ? "pending" : null,
      });
      if (sessionErr) throw sessionErr;
    },
    onSuccess: (_r, vars) => invalidateGroups(vars.roundId),
  });

  const reassignMember = useMutation({
    mutationFn: async ({
      groupId,
      slot,
      newMemberId,
    }: {
      groupId: string;
      roundId: string;
      slot: 1 | 2 | 3;
      newMemberId: string;
    }) => {
      const column = `member_${slot}_id`;
      const { error } = await supabase.from("triad_groups").update({ [column]: newMemberId }).eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => invalidateGroups(vars.roundId),
  });

  const setGroupActive = useMutation({
    mutationFn: async ({ groupId, isActive }: { groupId: string; roundId: string; isActive: boolean }) => {
      const { error } = await supabase.from("triad_groups").update({ is_active: isActive }).eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => invalidateGroups(vars.roundId),
  });

  return {
    createRound: createRound.mutateAsync,
    setRoundVisible: setRoundVisible.mutateAsync,
    runAutoAssign: runAutoAssign.mutateAsync,
    sendReminders: sendReminders.mutateAsync,
    createGroup: createGroup.mutateAsync,
    reassignMember: reassignMember.mutateAsync,
    setGroupActive: setGroupActive.mutateAsync,
    isRunningAutoAssign: runAutoAssign.isPending,
    isSendingReminders: sendReminders.isPending,
    isPending:
      createRound.isPending ||
      setRoundVisible.isPending ||
      createGroup.isPending ||
      reassignMember.isPending ||
      setGroupActive.isPending,
  };
}
