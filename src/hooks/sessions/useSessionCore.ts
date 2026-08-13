import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import {
  ActionItem,
  MilestoneLite,
  ProfileLite,
  SessionRow,
  normalizeItems,
} from "./types";

type SessionsTable = "sessions" | "peer_sessions";

interface UseSessionCoreOptions {
  sessionId: string | undefined;
  isPeer: boolean;
}

interface SessionCoreData {
  session: SessionRow;
  coach: ProfileLite | null;
  coachee: ProfileLite | null;
  milestones: MilestoneLite[];
}

async function fetchSessionCore(
  sessionId: string,
  tableName: SessionsTable,
  isPeer: boolean,
  coachField: string,
  coacheeField: string
): Promise<SessionCoreData | null> {
  const { data } = await supabase
    .from(tableName)
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (!data) return null;

  // Normalize peer rows to look like SessionRow
  const raw = data as Record<string, unknown>;
  const norm = (
    isPeer
      ? { ...raw, coach_id: raw[coachField], coachee_id: raw[coacheeField] }
      : raw
  ) as unknown as SessionRow;

  const { data: profs } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", [norm.coach_id, norm.coachee_id]);
  const byId = new Map((profs || []).map((p) => [p.id, p]));

  // Load milestones of the coachee (or peer-coachee) so action items can be linked
  const coacheeId = norm.coachee_id;
  const [{ data: gs }, { data: ms }] = await Promise.all([
    supabase.from("coachee_goals").select("id, title").eq("coachee_id", coacheeId),
    supabase
      .from("coachee_milestones")
      .select("id, title, goal_id")
      .eq("coachee_id", coacheeId)
      .order("created_at"),
  ]);
  const goalById = new Map((gs || []).map((g) => [g.id, g.title]));
  const milestones = (ms || []).map((m) => ({
    id: m.id,
    title: m.title,
    goal_id: m.goal_id,
    goal_title: goalById.get(m.goal_id),
  }));

  return {
    session: norm,
    coach: (byId.get(norm.coach_id) as ProfileLite) || null,
    coachee: (byId.get(norm.coachee_id) as ProfileLite) || null,
    milestones,
  };
}

/**
 * Loads and manages the core session record (sessions/peer_sessions), its
 * participants and related milestones, plus the mutations that operate on
 * the session row itself (progress notes, status transitions, meeting link).
 */
export function useSessionCore({ sessionId, isPeer }: UseSessionCoreOptions) {
  const tableName: SessionsTable = isPeer ? "peer_sessions" : "sessions";
  const coachField = isPeer ? "peer_coach_id" : "coach_id";
  const coacheeField = isPeer ? "peer_coachee_id" : "coachee_id";

  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["session-core", tableName, sessionId], [tableName, sessionId]);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchSessionCore(sessionId as string, tableName, isPeer, coachField, coacheeField),
    enabled: !!sessionId,
    staleTime: 30_000,
    // Local state below mirrors `session` and is only meant to resync on an
    // explicit reload (mutations invalidate this key themselves). Without
    // this, a window-focus background refetch would silently overwrite
    // unsaved edits in the notes/action-item fields.
    refetchOnWindowFocus: false,
  });
  const session = data?.session ?? null;
  const coach = data?.coach ?? null;
  const coachee = data?.coachee ?? null;
  const milestones = data?.milestones ?? [];

  const [saving, setSaving] = useState(false);
  const [coachNotes, setCoachNotes] = useState("");
  const [coacheeNotes, setCoacheeNotes] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [items, setItems] = useState<ActionItem[]>([]);

  // Re-seeds the editable form fields whenever the query result changes
  // (initial load, or an explicit reload/invalidation after a save below).
  useEffect(() => {
    if (!session) return;
    setCoachNotes(session.coach_notes || "");
    setCoacheeNotes(session.coachee_notes || "");
    setMeetingUrl(session.meeting_url || "");
    setItems(normalizeItems(session.action_items));
  }, [session]);

  const load = useCallback(() => queryClient.invalidateQueries({ queryKey }), [queryClient, queryKey]);

  const saveProgress = useCallback(
    async (opts: {
      includeCoachNotes: boolean;
      includeCoacheeNotes: boolean;
      includeMeetingUrl: boolean;
    }) => {
      if (!session) return { error: null };
      setSaving(true);
      const update: Partial<Database["public"]["Tables"]["sessions"]["Update"]> = {
        action_items: items as unknown as Database["public"]["Tables"]["sessions"]["Update"]["action_items"],
      };
      if (opts.includeCoachNotes) update.coach_notes = coachNotes;
      if (opts.includeMeetingUrl) update.meeting_url = meetingUrl || null;
      if (opts.includeCoacheeNotes) update.coachee_notes = coacheeNotes;
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(tableName as any)
        .update(update)
        .eq("id", session.id);
      setSaving(false);
      return { error };
    },
    [session, items, coachNotes, coacheeNotes, meetingUrl, tableName]
  );

  const saveActionItems = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(tableName as any)
      .update({ action_items: items as unknown as Database["public"]["Tables"]["sessions"]["Update"]["action_items"] })
      .eq("id", session.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Action items saved");
    load();
  }, [session, items, tableName, load]);

  const saveMeetingUrl = useCallback(
    async (trimmed: string) => {
      if (!session) return;
      setSaving(true);
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(tableName as any)
        .update({ meeting_url: trimmed || null })
        .eq("id", session.id);
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Meeting link saved");
      load();
    },
    [session, tableName, load]
  );

  const confirmSession = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    const { error } = await supabase.functions.invoke("confirm-session", {
      body: { session_id: session.id, is_peer: isPeer },
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Session confirmed. Zoom meeting is ready.");
    load();
  }, [session, isPeer, load]);

  const cancelSession = useCallback(
    async (onDone: () => void, reason?: string) => {
      if (!session) return;
      setSaving(true);
      const { error } = await supabase.functions.invoke("cancel-session", {
        body: { session_id: session.id, is_peer: isPeer, reason },
      });
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Session cancelled");
      onDone();
    },
    [session, isPeer]
  );

  const completeSession = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(tableName as any)
      .update({ status: "completed" })
      .eq("id", session.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Marked complete");
    load();
  }, [session, tableName, load]);

  const updateItem = useCallback((idx: number, patch: Partial<ActionItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }, []);

  const removeItem = useCallback((idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const addItem = useCallback((text: string) => {
    if (!text.trim()) return;
    setItems((prev) => [
      ...prev,
      { text: text.trim(), done: false, due_date: null, milestone_id: null },
    ]);
  }, []);

  return {
    tableName,
    coachField,
    coacheeField,
    session,
    coach,
    coachee,
    milestones,
    loading: isLoading,
    saving,
    coachNotes,
    setCoachNotes,
    coacheeNotes,
    setCoacheeNotes,
    meetingUrl,
    setMeetingUrl,
    items,
    setItems,
    updateItem,
    removeItem,
    addItem,
    reload: load,
    saveProgress,
    saveActionItems,
    saveMeetingUrl,
    confirmSession,
    cancelSession,
    completeSession,
  };
}
