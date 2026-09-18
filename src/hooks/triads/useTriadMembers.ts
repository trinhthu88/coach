import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TriadMember {
  id: string;
  full_name: string;
  avatar_url: string | null;
  slot: number;
  isSelf: boolean;
}

export const TRIAD_MEMBERS_KEY = "triad-members";

/**
 * THE learner-side source of Triad co-member identity: learner_triad_members
 * reads membership from triad_groups (member_1/2/3) and display identity
 * (name, avatar — nothing else) from profiles, and returns rows only for
 * groups the caller belongs to. Every learner Triad surface that shows who
 * is in a group uses this — never profiles RLS discovery, session records,
 * cohort lists or cached names.
 */
export async function fetchTriadMembers(groupIds: string[]): Promise<Map<string, TriadMember[]>> {
  const ids = Array.from(new Set(groupIds.filter(Boolean)));
  const byGroup = new Map<string, TriadMember[]>();
  if (ids.length === 0) return byGroup;
  const { data, error } = await supabase.rpc("learner_triad_members", { p_group_ids: ids });
  if (error) {
    console.error("Triad members failed to load", { groupIds: ids, error });
    throw error;
  }
  for (const row of data ?? []) {
    const list = byGroup.get(row.triad_group_id) ?? [];
    list.push({ id: row.member_id, full_name: row.full_name, avatar_url: row.avatar_url ?? null, slot: row.member_slot, isSelf: row.is_self });
    byGroup.set(row.triad_group_id, list);
  }
  for (const list of byGroup.values()) list.sort((a, b) => a.slot - b.slot);
  return byGroup;
}

/** Members of one Triad group (empty when the caller is not a member). */
export function useTriadMembers(groupId: string | null | undefined) {
  const query = useQuery({
    queryKey: [TRIAD_MEMBERS_KEY, groupId ?? null],
    queryFn: async () => (await fetchTriadMembers([groupId as string])).get(groupId as string) ?? [],
    enabled: !!groupId,
    staleTime: 60_000,
  });
  return { members: query.data ?? [], loading: !!groupId && query.isLoading, error: query.isError };
}
