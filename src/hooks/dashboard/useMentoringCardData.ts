import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface MentoringGiveData {
  upcoming: { id: string; topic: string; start_time: string; mentee: string | null }[];
  upcomingCount: number;
  menteeCount: number;
  sessionsDelivered: number;
}

const emptyGive: MentoringGiveData = { upcoming: [], upcomingCount: 0, menteeCount: 0, sessionsDelivered: 0 };

async function fetchGive(userId: string): Promise<MentoringGiveData> {
  const { data } = await supabase
    .from("mentoring_sessions")
    .select("id, topic, start_time, status, mentee_id")
    .eq("mentor_id", userId)
    .order("start_time", { ascending: false });
  const list = data || [];
  const now = new Date();
  const allUpcoming = list
    .filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const upcomingRows = allUpcoming.slice(0, 3);

  const menteeIds = Array.from(new Set(upcomingRows.map((s) => s.mentee_id)));
  let namesById: Record<string, string> = {};
  if (menteeIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", menteeIds);
    namesById = Object.fromEntries((profs || []).map((p) => [p.id, p.full_name]));
  }

  return {
    upcoming: upcomingRows.map((s) => ({
      id: s.id,
      topic: s.topic,
      start_time: s.start_time,
      mentee: namesById[s.mentee_id] ?? null,
    })),
    upcomingCount: allUpcoming.length,
    menteeCount: new Set(list.filter((s) => ["confirmed", "completed"].includes(s.status)).map((s) => s.mentee_id))
      .size,
    sessionsDelivered: list.filter((s) => s.status === "completed").length,
  };
}

export function useMentoringGiveCardData(userId: string | undefined, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["mentoring-give-card", userId],
    queryFn: () => fetchGive(userId as string),
    enabled: !!userId && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? emptyGive, loading: isLoading };
}

interface MentoringReceiveData {
  nextSession: {
    id: string;
    topic: string;
    start_time: string;
    mentor: { full_name: string; avatar_url: string | null } | null;
    prepFileUploaded: boolean;
  } | null;
  upcomingCount: number;
}

const emptyReceive: MentoringReceiveData = { nextSession: null, upcomingCount: 0 };

async function fetchReceive(userId: string): Promise<MentoringReceiveData> {
  const { data } = await supabase
    .from("mentoring_sessions")
    .select("id, topic, start_time, status, mentor_id, prep_file_path")
    .eq("mentee_id", userId)
    .order("start_time", { ascending: false });
  const list = data || [];
  const now = new Date();
  const upcomingRows = list
    .filter((s) => ["confirmed", "pending_coach_approval"].includes(s.status) && new Date(s.start_time) >= now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const next = upcomingRows[0];

  if (!next) return { ...emptyReceive, upcomingCount: upcomingRows.length };

  const { data: mentor } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", next.mentor_id)
    .maybeSingle();

  return {
    nextSession: {
      id: next.id,
      topic: next.topic,
      start_time: next.start_time,
      mentor: mentor ?? null,
      prepFileUploaded: !!next.prep_file_path,
    },
    upcomingCount: upcomingRows.length,
  };
}

export function useMentoringReceiveCardData(userId: string | undefined, enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ["mentoring-receive-card", userId],
    queryFn: () => fetchReceive(userId as string),
    enabled: !!userId && enabled,
    staleTime: 30_000,
  });
  return { data: data ?? emptyReceive, loading: isLoading };
}
