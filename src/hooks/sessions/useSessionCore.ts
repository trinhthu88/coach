import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { extractFunctionError } from "@/lib/errors";
import { getSessionFieldMap, type SessionTableKind } from "@/lib/sessionTableHelper";
import { withEnrollmentActions, saveEnrollmentActions, type EnrollmentActionSource } from "@/lib/enrollmentActions";
import {
  ActionItem,
  MilestoneLite,
  ProfileLite,
  SessionRow,
} from "./types";

type SessionsTable = SessionTableKind;

interface UseSessionCoreOptions {
  sessionId: string | undefined;
  isPeer: boolean;
  /** Coachee-to-coachee peer practice (`coachee_peer_sessions`) — a third, distinct table from `peer_sessions` (coach-to-coach). */
  isCoacheePeer?: boolean;
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
  coachField: string,
  coacheeField: string,
  coachNotesField: string,
  coacheeNotesField: string,
  sourceActivityType: EnrollmentActionSource
): Promise<SessionCoreData | null> {
  // Built from the caller's field map (never hardcoded per table) — each
  // session table names its participant/notes columns differently
  // (coach_id/coachee_id + coach_notes/coachee_notes on `sessions` and
  // `peer_sessions`, peer_provider_id/peer_receiver_id + provider_notes/
  // receiver_notes on `coachee_peer_sessions`), and selecting a column name
  // that doesn't exist on the target table throws a Postgres 42703 error.
  const selectFields = [
    "id",
    "enrollment_id",
    coachField,
    coacheeField,
    "topic",
    "start_time",
    "duration_minutes",
    "status",
    "meeting_url",
    coachNotesField,
    coacheeNotesField,
    "cancelled_at",
    "slot_id",
  ].join(", ");
  const { data } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(tableName as any)
    .select(selectFields)
    .eq("id", sessionId)
    .maybeSingle();
  if (!data) return null;

  // Normalize peer/coachee-peer rows to look like SessionRow — field names differ
  // per table (peer_coach_id/peer_coachee_id, peer_provider_id/peer_receiver_id,
  // provider_notes/receiver_notes) but a no-op for `sessions` since the field
  // names already match.
  const raw = data as unknown as Record<string, unknown>;
  if (!raw.enrollment_id) return null;
  const norm = {
    ...raw,
    coach_id: raw[coachField],
    coachee_id: raw[coacheeField],
    coach_notes: raw[coachNotesField],
    coachee_notes: raw[coacheeNotesField],
  } as unknown as SessionRow;

  const { data: profs } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", [norm.coach_id, norm.coachee_id]);
  const byId = new Map((profs || []).map((p) => [p.id, p]));

  // Load only programme goals/milestones from this session's immutable enrollment.
  // Historical sessions without an enrollment must not fall back to the user's
  // current or other historical programme records.
  const coacheeId = norm.coachee_id;
  const enrollmentId = norm.enrollment_id;
  const [{ data: gs }, { data: ms }] = enrollmentId
    ? await Promise.all([
        supabase.from("coachee_goals").select("id, title").eq("coachee_id", coacheeId).eq("enrollment_id", enrollmentId),
        supabase
          .from("coachee_milestones")
          .select("id, title, goal_id")
          .eq("coachee_id", coacheeId)
          .eq("enrollment_id", enrollmentId)
          .order("created_at"),
      ])
    : [{ data: [] }, { data: [] }];
  const goalById = new Map((gs || []).map((g) => [g.id, g.title]));
  const milestones = (ms || []).map((m) => ({
    id: m.id,
    title: m.title,
    goal_id: m.goal_id,
    goal_title: goalById.get(m.goal_id),
  }));

  const [withActions] = await withEnrollmentActions([norm], sourceActivityType);
  return {
    session: { ...norm, enrollment_actions: withActions.enrollment_actions ?? [] },
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
export function useSessionCore({ sessionId, isPeer, isCoacheePeer }: UseSessionCoreOptions) {
  const { t } = useTranslation("sessions");
  const { table: tableName, coachField, coacheeField, coachNotesField, coacheeNotesField } =
    getSessionFieldMap(isPeer, isCoacheePeer);

  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["session-core", tableName, sessionId], [tableName, sessionId]);
  const sourceActivityType: EnrollmentActionSource = isCoacheePeer ? "coachee_peer_coaching" : isPeer ? "peer_coaching" : "coaching";

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchSessionCore(sessionId as string, tableName, coachField, coacheeField, coachNotesField, coacheeNotesField, sourceActivityType),
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
    setItems(session.enrollment_actions);
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
      const { error: actionsError } = await saveEnrollmentActions(session.enrollment_id, sourceActivityType, session.id, items);
      if (actionsError) { setSaving(false); return { error: actionsError }; }
      const kind = isCoacheePeer ? "coachee_peer" : isPeer ? "peer" : "coaching";
      const updates: Array<[string, string]> = [];
      if (opts.includeCoachNotes) updates.push([coachNotesField, coachNotes]);
      if (opts.includeMeetingUrl) updates.push(["meeting_url", meetingUrl || ""]);
      if (opts.includeCoacheeNotes) updates.push([coacheeNotesField, coacheeNotes]);
      let error = null;
      for (const [field, value] of updates) {
        const result = await supabase.rpc("update_session_notes", {
          p_session_id: session.id, p_kind: kind, p_field: field, p_value: value,
        });
        if (result.error) { error = result.error; break; }
      }
      setSaving(false);
      return { error };
    },
    [session, items, coachNotes, coacheeNotes, meetingUrl, coachNotesField, coacheeNotesField, sourceActivityType, isPeer, isCoacheePeer]
  );

  const saveActionItems = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    const { error } = await saveEnrollmentActions(session.enrollment_id, sourceActivityType, session.id, items);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("detail.toast.actionItemsSaved"));
    load();
  }, [session, items, sourceActivityType, load, t]);

  const saveMeetingUrl = useCallback(
    async (trimmed: string) => {
      if (!session) return;
      setSaving(true);
      const { error } = await supabase.rpc("update_session_notes", {
        p_session_id: session.id, p_kind: isCoacheePeer ? "coachee_peer" : isPeer ? "peer" : "coaching",
        p_field: "meeting_url", p_value: trimmed || "",
      });
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(t("detail.toast.meetingLinkSaved"));
      load();
    },
    [session, isPeer, isCoacheePeer, load, t]
  );

  const confirmSession = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    const { error } = await supabase.rpc("transition_session_status", {
      p_session_id: session.id, p_kind: isCoacheePeer ? "coachee_peer" : isPeer ? "peer" : "coaching",
      p_action: "confirm", p_reason: null,
    });
    setSaving(false);
    if (error) {
      const friendly = await extractFunctionError(error);
      return toast.error(friendly.message);
    }
    toast.success(t("detail.toast.sessionConfirmed"));
    load();
  }, [session, isPeer, isCoacheePeer, load, t]);

  const cancelSession = useCallback(
    async (onDone: () => void, reason?: string) => {
      if (!session) return;
      setSaving(true);
       const { error } = await supabase.rpc("transition_session_status", {
        p_session_id: session.id, p_kind: isCoacheePeer ? "coachee_peer" : isPeer ? "peer" : "coaching",
        p_action: "cancel", p_reason: reason || null,
      });
      setSaving(false);
      if (error) {
        const friendly = await extractFunctionError(error);
        toast.error(friendly.message);
        return;
      }
      toast.success(t("detail.toast.sessionCancelled"));
      onDone();
    },
    [session, isPeer, isCoacheePeer, t]
  );

  const completeSession = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    const { error } = await supabase.rpc("transition_session_status", {
      p_session_id: session.id,
      p_kind: isCoacheePeer ? "coachee_peer" : isPeer ? "peer" : "coaching",
      p_action: "complete", p_reason: null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t("detail.toast.markedComplete"));
    load();
  }, [session, isPeer, isCoacheePeer, load, t]);

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
