import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MentoringSessionRow, ProfileLite } from "./types";

interface UseMentoringSessionCoreOptions {
  sessionId: string | undefined;
}

interface MentoringSessionCoreData {
  session: MentoringSessionRow;
  mentor: ProfileLite | null;
  mentee: ProfileLite | null;
}

async function fetchMentoringSessionCore(sessionId: string): Promise<MentoringSessionCoreData | null> {
  const { data } = await supabase.from("mentoring_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!data) return null;

  const { data: profs } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", [data.mentor_id, data.mentee_id]);
  const byId = new Map((profs || []).map((p) => [p.id, p]));

  return {
    session: data,
    mentor: (byId.get(data.mentor_id) as ProfileLite) || null,
    mentee: (byId.get(data.mentee_id) as ProfileLite) || null,
  };
}

/**
 * Mentoring's equivalent of useSessionCore.ts — hardcoded to
 * mentoring_sessions (no is_peer-style branching needed, there's only one
 * table). Doesn't carry over milestone/action-item linking; mentoring
 * sessions only need notes + status transitions + the prep-file/feedback
 * flows (see useMentoringPrepFile.ts / useMentoringFeedback.ts).
 */
export function useMentoringSessionCore({ sessionId }: UseMentoringSessionCoreOptions) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["mentoring-session-core", sessionId], [sessionId]);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchMentoringSessionCore(sessionId as string),
    enabled: !!sessionId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const session = data?.session ?? null;
  const mentor = data?.mentor ?? null;
  const mentee = data?.mentee ?? null;

  const [saving, setSaving] = useState(false);
  const [mentorNotes, setMentorNotes] = useState("");
  const [menteeNotes, setMenteeNotes] = useState("");

  useEffect(() => {
    if (!session) return;
    setMentorNotes(session.mentor_notes || "");
    setMenteeNotes(session.mentee_notes || "");
  }, [session]);

  const load = useCallback(() => queryClient.invalidateQueries({ queryKey }), [queryClient, queryKey]);

  const saveNotes = useCallback(
    async (opts: { includeMentorNotes: boolean; includeMenteeNotes: boolean }) => {
      if (!session) return { error: null };
      setSaving(true);
      const update: { mentor_notes?: string; mentee_notes?: string } = {};
      if (opts.includeMentorNotes) update.mentor_notes = mentorNotes;
      if (opts.includeMenteeNotes) update.mentee_notes = menteeNotes;
      const { error } = await supabase.from("mentoring_sessions").update(update).eq("id", session.id);
      setSaving(false);
      if (!error) load();
      return { error };
    },
    [session, mentorNotes, menteeNotes, load]
  );

  const confirmSession = useCallback(async () => {
    if (!session) return { error: null };
    setSaving(true);
    const { error } = await supabase.functions.invoke("confirm-mentoring-session", {
      body: { session_id: session.id },
    });
    setSaving(false);
    if (error) return { error };
    toast.success("Session confirmed. Zoom meeting is ready.");
    load();
    return { error: null };
  }, [session, load]);

  const completeSession = useCallback(async () => {
    if (!session) return { error: null };
    setSaving(true);
    const { error } = await supabase.from("mentoring_sessions").update({ status: "completed" }).eq("id", session.id);
    setSaving(false);
    if (!error) load();
    return { error };
  }, [session, load]);

  return {
    session,
    mentor,
    mentee,
    loading: isLoading,
    saving,
    mentorNotes,
    setMentorNotes,
    menteeNotes,
    setMenteeNotes,
    reload: load,
    saveNotes,
    confirmSession,
    completeSession,
  };
}
