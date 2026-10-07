import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isAfter, isBefore, startOfWeek, endOfWeek } from "date-fns";
import type { Client, ClientPaceStatus } from "./types";
import { canonicalCompletionPct } from "@/lib/programmeProfile";

/**
 * The Coach's clients, as the server summarises them (coach_client_summary,
 * 20261007001100): a learner with a confirmed or completed session with this
 * Coach, or of an engagement the Coach is assigned to; their current
 * enrollment chosen on the server; its canonical progress and pace; sessions
 * with this Coach and the next one; follow-up actions overdue as of
 * programme_today(); the goals and milestones linked through this Coach's
 * sessions. This hook only maps the rows and derives the tiles.
 */
export function useCoachClients(userId: string | undefined) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("coach_client_summary");
    if (error) console.error("Coach client summary failed to load", error);
    setClients((data ?? []).map((r) => {
      const goals = (r.goals as { id: string; title: string; status: string }[] | null) ?? [];
      return {
        id: r.client_id,
        full_name: r.full_name,
        email: r.email,
        avatar_url: r.avatar_url,
        totalSessions: r.total_sessions,
        completed: r.completed_sessions,
        cancelled: r.cancelled_sessions,
        upcomingCount: r.upcoming_sessions,
        lastSession: r.last_session_at,
        nextSession: r.next_session_at,
        goalsActive: goals.filter((g) => g.status === "active").length,
        goalsAll: goals.map((g) => ({ id: g.id, title: g.title })),
        milestonesDone: r.milestones_done,
        milestonesTotal: r.milestones_total,
        enrollmentId: r.enrollment_id,
        completionPct: r.progress_available ? canonicalCompletionPct(r.completion_pct) : null,
        actionItemsDone: r.action_items_done,
        actionItemsTotal: r.action_items_total,
        overdueActions: r.overdue_actions,
        paceStatus: r.progress_available ? ((r.pace_status as ClientPaceStatus) ?? null) : null,
        progressError: !!error,
        weekStart: r.first_session_at,
      };
    }));
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

    // Total milestones completed across clients (labelled "completed total").
    const milestonesHit = clients.reduce((a, c) => a + c.milestonesDone, 0);

    const nextOverall = clients
      .map((c) => c.nextSession)
      .filter(Boolean)
      .sort((a, b) => +new Date(a!) - +new Date(b!))[0];

    return { active: clients.length, sessionsThisWeek, overdue, overdueClients, milestonesHit, nextOverall };
  }, [clients]);

  return { clients, loading, reload: load, metrics };
}
