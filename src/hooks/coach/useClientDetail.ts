import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isAfter, isBefore, endOfWeek } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import type { RawAction } from "./types";

export interface FlatClientAction {
  sessionId: string;
  idx: number;
  topic: string;
  date: string;
  item: RawAction;
}

/**
 * Owns the coachee drill-down dialog's data: profile/goals/milestones
 * (filtered to only what's linked via this coach's own sessions),
 * sessions, and private coach notes, plus the derived action-item/session
 * groupings the dialog renders.
 */
export function useClientDetail(coacheeId: string, coachId: string, onChanged: () => void) {
  const [profile, setProfile] = useState<Tables<"profiles"> | null>(null);
  const [coacheeProfile, setCoacheeProfile] = useState<Tables<"coachee_profiles"> | null>(null);
  const [goals, setGoals] = useState<Tables<"coachee_goals">[]>([]);
  const [milestones, setMilestones] = useState<Tables<"coachee_milestones">[]>([]);
  const [sessions, setSessions] = useState<Tables<"sessions">[]>([]);
  const [notes, setNotes] = useState<Tables<"coach_client_notes">[]>([]);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [
      { data: prof },
      { data: cprof },
      { data: g },
      { data: m },
      { data: s },
      { data: n },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", coacheeId).maybeSingle(),
      supabase.from("coachee_profiles").select("*").eq("id", coacheeId).maybeSingle(),
      supabase.from("coachee_goals").select("*").eq("coachee_id", coacheeId).order("created_at"),
      supabase.from("coachee_milestones").select("*").eq("coachee_id", coacheeId).order("created_at"),
      supabase.from("sessions").select("*").eq("coach_id", coachId).eq("coachee_id", coacheeId).order("start_time", { ascending: false }),
      supabase.from("coach_client_notes").select("*").eq("coach_id", coachId).eq("coachee_id", coacheeId).order("created_at", { ascending: false }),
    ]);
    setProfile(prof);
    setCoacheeProfile(cprof);

    // Filter goals/milestones to only those linked via action items in THIS coach's sessions
    const linkedMs = new Set<string>();
    for (const sess of s || []) {
      const items: RawAction[] = Array.isArray(sess.action_items)
        ? (sess.action_items as unknown[]).map((it) => (typeof it === "string" ? { text: it } : (it as RawAction)))
        : [];
      for (const it of items) {
        if (it?.milestone_id) linkedMs.add(it.milestone_id);
      }
    }
    const visibleMilestones = (m || []).filter((mi) => linkedMs.has(mi.id));
    const visibleGoalIds = new Set(visibleMilestones.map((mi) => mi.goal_id));
    const visibleGoals = (g || []).filter((go) => visibleGoalIds.has(go.id));

    setGoals(visibleGoals);
    setMilestones(visibleMilestones);
    setSessions(s || []);
    setNotes(n || []);
  }, [coacheeId, coachId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addNote = async (body: string) => {
    if (!body.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("coach_client_notes")
      .insert({ coach_id: coachId, coachee_id: coacheeId, body: body.trim() });
    setSaving(false);
    if (error) return toast.error(error.message);
    refresh();
    onChanged();
  };

  const deleteNote = async (id: string) => {
    const { error } = await supabase.from("coach_client_notes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  // Aggregate action items across sessions
  const allActions = useMemo(() => {
    const out: FlatClientAction[] = [];
    for (const s of sessions) {
      const items: RawAction[] = Array.isArray(s.action_items)
        ? (s.action_items as unknown[]).map((it) => (typeof it === "string" ? { text: it } : (it as RawAction)))
        : [];
      items.forEach((it, idx) => {
        if (it?.text) out.push({ sessionId: s.id, idx, topic: s.topic, date: s.start_time, item: it });
      });
    }
    return out;
  }, [sessions]);

  const now = new Date();
  const overdue = allActions.filter((a) => !a.item.done && a.item.due_date && isBefore(new Date(a.item.due_date), now));
  const dueWeek = allActions.filter((a) => {
    if (a.item.done || !a.item.due_date) return false;
    const d = new Date(a.item.due_date);
    return !isBefore(d, now) && !isAfter(d, endOfWeek(now, { weekStartsOn: 1 }));
  });
  const completedActions = allActions.filter((a) => a.item.done);

  const upcoming = sessions.filter((s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status));
  const past = sessions.filter((s) => new Date(s.start_time) < now || ["cancelled", "completed"].includes(s.status));

  const totalMs = milestones.length;
  const doneMs = milestones.filter((m) => m.is_done).length;
  const overallPct = totalMs ? Math.round((doneMs / totalMs) * 100) : 0;

  const labelFor = useCallback(
    (mid?: string | null) => {
      if (!mid) return undefined;
      const m = milestones.find((x) => x.id === mid);
      if (!m) return undefined;
      const g = goals.find((x) => x.id === m.goal_id);
      return g ? `${g.title} → ${m.title}` : m.title;
    },
    [milestones, goals]
  );

  return {
    profile,
    coacheeProfile,
    goals,
    milestones,
    sessions,
    notes,
    saving,
    addNote,
    deleteNote,
    allActions,
    overdue,
    dueWeek,
    completed: completedActions,
    upcoming,
    past,
    overallPct,
    labelFor,
  };
}
