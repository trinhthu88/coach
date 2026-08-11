import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isAfter, isBefore, startOfWeek, endOfWeek } from "date-fns";
import type { Client, RawAction } from "./types";

/**
 * Loads every coachee this coach has a confirmed or completed session with,
 * aggregated with session/goal/milestone/action-item stats, plus the top-
 * level metrics tiles derived from that list.
 */
export function useCoachClients(userId: string | undefined) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data: ses } = await supabase
      .from("sessions")
      .select("id, coachee_id, status, start_time, action_items")
      .eq("coach_id", userId);

    const coacheeIds = Array.from(
      new Set(
        (ses || [])
          .filter((s) => ["confirmed", "completed"].includes(s.status))
          .map((s) => s.coachee_id)
      )
    );
    if (!coacheeIds.length) {
      setClients([]);
      setLoading(false);
      return;
    }

    const [{ data: profs }, { data: goals }, { data: miles }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, avatar_url").in("id", coacheeIds),
      supabase.from("coachee_goals").select("id, coachee_id, title, status").in("coachee_id", coacheeIds),
      supabase.from("coachee_milestones").select("id, goal_id, coachee_id, is_done").in("coachee_id", coacheeIds),
    ]);

    // Build per-coachee set of milestone_ids referenced by THIS coach's session action items
    const linkedMsByCoachee = new Map<string, Set<string>>();
    for (const s of ses || []) {
      const items: RawAction[] = Array.isArray(s.action_items)
        ? (s.action_items as unknown[]).map((it) => (typeof it === "string" ? { text: it } : (it as RawAction)))
        : [];
      for (const it of items) {
        if (it?.milestone_id) {
          if (!linkedMsByCoachee.has(s.coachee_id)) linkedMsByCoachee.set(s.coachee_id, new Set());
          linkedMsByCoachee.get(s.coachee_id)!.add(it.milestone_id);
        }
      }
    }
    // Visible milestones = those linked. Visible goals = goals owning a visible milestone.
    const visibleMsIds = new Map<string, Set<string>>(); // coachee -> milestone ids
    const visibleGoalIds = new Map<string, Set<string>>(); // coachee -> goal ids
    for (const m of miles || []) {
      const linked = linkedMsByCoachee.get(m.coachee_id);
      if (linked && linked.has(m.id)) {
        if (!visibleMsIds.has(m.coachee_id)) visibleMsIds.set(m.coachee_id, new Set());
        visibleMsIds.get(m.coachee_id)!.add(m.id);
        if (!visibleGoalIds.has(m.coachee_id)) visibleGoalIds.set(m.coachee_id, new Set());
        visibleGoalIds.get(m.coachee_id)!.add(m.goal_id);
      }
    }

    const now = new Date();
    const byCoachee = new Map<string, Client>();
    for (const p of profs || []) {
      byCoachee.set(p.id, {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
        totalSessions: 0,
        completed: 0,
        cancelled: 0,
        upcomingCount: 0,
        lastSession: null,
        nextSession: null,
        goalsActive: 0,
        goalsAll: [],
        milestonesDone: 0,
        milestonesTotal: 0,
        actionItemsDone: 0,
        actionItemsTotal: 0,
        overdueActions: 0,
        status: "on_track",
        weekStart: null,
      });
    }

    for (const s of ses || []) {
      const c = byCoachee.get(s.coachee_id);
      if (!c) continue;
      c.totalSessions++;
      if (s.status === "completed") c.completed++;
      if (s.status === "cancelled") c.cancelled++;
      const t = new Date(s.start_time);
      if (s.status === "completed" && (!c.lastSession || t > new Date(c.lastSession))) {
        c.lastSession = s.start_time;
      }
      if (
        ["confirmed", "pending_coach_approval"].includes(s.status) &&
        t >= now
      ) {
        c.upcomingCount++;
        if (!c.nextSession || t < new Date(c.nextSession)) c.nextSession = s.start_time;
      }
      if (!c.weekStart || t < new Date(c.weekStart)) c.weekStart = s.start_time;

      const items: RawAction[] = Array.isArray(s.action_items)
        ? (s.action_items as unknown[]).map((it) => (typeof it === "string" ? { text: it } : (it as RawAction)))
        : [];
      for (const it of items) {
        if (!it?.text) continue;
        c.actionItemsTotal++;
        if (it.done) c.actionItemsDone++;
        else if (it.due_date && isBefore(new Date(it.due_date), now)) c.overdueActions++;
      }
    }
    for (const g of goals || []) {
      const c = byCoachee.get(g.coachee_id);
      if (!c) continue;
      const visG = visibleGoalIds.get(g.coachee_id);
      if (!visG || !visG.has(g.id)) continue; // hide goals not linked
      c.goalsAll.push({ id: g.id, title: g.title });
      if (g.status === "active") c.goalsActive++;
    }
    for (const m of miles || []) {
      const c = byCoachee.get(m.coachee_id);
      if (!c) continue;
      const visM = visibleMsIds.get(m.coachee_id);
      if (!visM || !visM.has(m.id)) continue; // hide milestones not linked
      c.milestonesTotal++;
      if (m.is_done) c.milestonesDone++;
    }

    // Status heuristic
    for (const c of byCoachee.values()) {
      if (c.overdueActions >= 5) c.status = "at_risk";
      else if (c.overdueActions >= 1) c.status = "needs_attention";
      else c.status = "on_track";
    }

    setClients(Array.from(byCoachee.values()));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = useMemo(() => {
    const now = new Date();
    const wkStart = startOfWeek(now, { weekStartsOn: 1 });
    const wkEnd = endOfWeek(now, { weekStartsOn: 1 });

    const sessionsThisWeek = clients.reduce((acc, c) => {
      if (c.nextSession) {
        const d = new Date(c.nextSession);
        if (!isBefore(d, wkStart) && !isAfter(d, wkEnd)) acc++;
      }
      return acc;
    }, 0);

    const overdue = clients.reduce((a, c) => a + c.overdueActions, 0);
    const overdueClients = clients.filter((c) => c.overdueActions > 0).length;

    // milestones hit this month — approximate using milestonesDone (no done_at on summary). Would need a separate query.
    const milestonesHit = clients.reduce((a, c) => a + c.milestonesDone, 0);

    const nextOverall = clients
      .map((c) => c.nextSession)
      .filter(Boolean)
      .sort((a, b) => +new Date(a!) - +new Date(b!))[0];

    return { active: clients.length, sessionsThisWeek, overdue, overdueClients, milestonesHit, nextOverall };
  }, [clients]);

  return { clients, loading, reload: load, metrics };
}
