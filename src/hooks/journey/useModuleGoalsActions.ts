import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type GoalsActionsModule = "coaching" | "peer" | "mentoring" | "triads";

/**
 * The spellings each shared store uses for a module's sessions — mirrors
 * session_deliverable_source_types() (enrollment_actions / goal_checkins).
 */
const ACTION_SOURCES: Record<GoalsActionsModule, string[]> = {
  coaching: ["coaching"],
  peer: ["peer_coaching", "coachee_peer_coaching"],
  mentoring: ["mentoring"],
  triads: ["triad"],
};
const CHECKIN_SOURCES: Record<GoalsActionsModule, string[]> = {
  coaching: ["coaching"],
  peer: ["peer_coaching"],
  mentoring: ["mentoring"],
  triads: ["triad"],
};

export interface ModuleAction {
  id: string;
  title: string;
  status: "open" | "in_progress" | "completed" | "cancelled";
  dueDate: string | null;
  sessionId: string | null;
}

export interface ModuleGoal {
  id: string;
  title: string;
  status: string;
  checkins: number;
}

/**
 * Goals and actions CONNECTED TO THIS MODULE'S SESSIONS, for the selected
 * enrollment: the follow-up actions written on its sessions
 * (enrollment_actions by source) and the goals checked in on during them
 * (goal_checkins by source). Same rows the post-session checklist writes.
 */
export function useModuleGoalsActions(enrollmentId: string | null | undefined, module: GoalsActionsModule) {
  const query = useQuery({
    queryKey: ["module-goals-actions", enrollmentId, module],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<{ actions: ModuleAction[]; goals: ModuleGoal[] }> => {
      const [actionsRes, checkinsRes] = await Promise.all([
        supabase
          .from("enrollment_actions")
          .select("id, title, status, due_date, source_activity_id")
          .eq("enrollment_id", enrollmentId!)
          .in("source_activity_type", ACTION_SOURCES[module])
          .neq("status", "cancelled")
          .order("due_date", { ascending: true, nullsFirst: false }),
        supabase
          .from("goal_checkins")
          .select("goal_id")
          .eq("enrollment_id", enrollmentId!)
          .in("source_activity_type", CHECKIN_SOURCES[module]),
      ]);
      if (actionsRes.error) throw actionsRes.error;
      if (checkinsRes.error) throw checkinsRes.error;

      const checkinsByGoal = new Map<string, number>();
      for (const c of checkinsRes.data ?? []) {
        checkinsByGoal.set(c.goal_id, (checkinsByGoal.get(c.goal_id) ?? 0) + 1);
      }
      let goals: ModuleGoal[] = [];
      if (checkinsByGoal.size > 0) {
        const { data, error } = await supabase
          .from("coachee_goals")
          .select("id, title, status")
          .in("id", [...checkinsByGoal.keys()]);
        if (error) throw error;
        goals = (data ?? []).map((g) => ({ id: g.id, title: g.title, status: g.status, checkins: checkinsByGoal.get(g.id) ?? 0 }));
      }
      return {
        actions: (actionsRes.data ?? []).map((a) => ({
          id: a.id,
          title: a.title,
          status: a.status as ModuleAction["status"],
          dueDate: a.due_date,
          sessionId: a.source_activity_id,
        })),
        goals,
      };
    },
  });
  return {
    actions: query.data?.actions ?? [],
    goals: query.data?.goals ?? [],
    loading: !!enrollmentId && query.isLoading,
    error: query.error ? (query.error as { message?: string }).message ?? "error" : null,
  };
}
