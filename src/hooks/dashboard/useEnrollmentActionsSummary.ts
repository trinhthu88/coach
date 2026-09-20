import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { bucketByDueDate } from "@/lib/actionScheduling";

export interface EnrollmentActionRow {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "completed" | "cancelled";
  due_date: string | null;
  goal_id: string | null;
  milestone_id: string | null;
  completed_at: string | null;
}

export interface EnrollmentActionsSummary {
  actions: EnrollmentActionRow[];
  overdue: EnrollmentActionRow[];
  dueThisWeek: EnrollmentActionRow[];
  upcoming: EnrollmentActionRow[];
  completed: EnrollmentActionRow[];
  total: number;
  openCount: number;
  completedCount: number;
  completionPct: number | null;
}

const EMPTY: EnrollmentActionsSummary = {
  actions: [],
  overdue: [],
  dueThisWeek: [],
  upcoming: [],
  completed: [],
  total: 0,
  openCount: 0,
  completedCount: 0,
  completionPct: null,
};

async function fetchActions(enrollmentId: string): Promise<EnrollmentActionRow[]> {
  const { data, error } = await supabase
    .from("enrollment_actions")
    .select("id, title, description, status, due_date, goal_id, milestone_id, completed_at")
    .eq("enrollment_id", enrollmentId)
    .neq("status", "cancelled")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as EnrollmentActionRow[];
}

/**
 * Canonical learner action summary, sourced directly from `enrollment_actions`
 * scoped by enrollment_id — the exact same table and scope
 * sponsor_leader_engagement_summary aggregates for the Sponsor's action
 * counts, so the two can never disagree for the same enrollment. Cancelled
 * actions are excluded everywhere this table is aggregated (they are not a
 * commitment the learner is judged against).
 */
export function useEnrollmentActionsSummary(enrollmentId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["enrollment-actions-summary", enrollmentId ?? null],
    queryFn: () => fetchActions(enrollmentId as string),
    enabled: !!enrollmentId,
    staleTime: 30_000,
  });

  const actions = data ?? [];
  const open = actions.filter((a) => a.status !== "completed");
  const completed = actions.filter((a) => a.status === "completed");
  const { overdue, thisWeek, upcoming } = bucketByDueDate(open, (a) => a.due_date);

  const summary: EnrollmentActionsSummary = data
    ? {
        actions,
        overdue,
        dueThisWeek: thisWeek,
        upcoming,
        completed,
        total: actions.length,
        openCount: open.length,
        completedCount: completed.length,
        completionPct: actions.length > 0 ? Math.round((completed.length / actions.length) * 100) : null,
      }
    : EMPTY;

  return {
    ...summary,
    loading: !!enrollmentId && isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
}
