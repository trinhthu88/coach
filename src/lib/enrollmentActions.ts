import { supabase } from "@/integrations/supabase/client";

export type EnrollmentActionSource =
  | "coaching"
  | "mentoring"
  | "peer_coaching"
  | "coachee_peer_coaching";

export interface EnrollmentActionItem {
  id?: string;
  text: string;
  done?: boolean;
  goal_id?: string | null;
  milestone_id?: string | null;
  due_date?: string | null;
  description?: string | null;
}

interface EnrollmentOwnedActivity {
  id: string;
  enrollment_id?: string | null;
  enrollment_actions?: EnrollmentActionItem[];
}

type EnrichedEnrollmentActivity<T extends EnrollmentOwnedActivity> = Omit<T, "enrollment_actions"> & {
  enrollment_actions: EnrollmentActionItem[];
};

interface StoredEnrollmentAction {
  id: string;
  enrollment_id: string;
  source_activity_type: string | null;
  source_activity_id: string | null;
  title: string;
  status: string;
  goal_id: string | null;
  milestone_id: string | null;
  due_date: string | null;
  description?: string | null;
}

export async function withEnrollmentActions<T extends EnrollmentOwnedActivity>(
  activities: T[],
  sourceActivityType: EnrollmentActionSource,
): Promise<EnrichedEnrollmentActivity<T>[]> {
  const unscopedActivity = activities.find((activity) => !activity.enrollment_id);
  if (unscopedActivity) {
    throw new Error(
      `Cannot load programme actions for unscoped ${sourceActivityType} activity ${unscopedActivity.id}`,
    );
  }

  const enrollmentIds = [...new Set(
    activities
      .map((activity) => activity.enrollment_id)
      .filter((id): id is string => Boolean(id)),
  )];

  if (enrollmentIds.length === 0) {
    return activities.map((activity) => ({ ...activity, enrollment_actions: [] }));
  }

  const sourceIds = activities.map((activity) => activity.id);
  const baseQuery = supabase
    .from("enrollment_actions")
    .select("id, enrollment_id, source_activity_type, source_activity_id, title, description, status, goal_id, milestone_id, due_date")
    .eq("source_activity_type", sourceActivityType);
  const enrollmentQuery = enrollmentIds.length === 1
    ? baseQuery.eq("enrollment_id", enrollmentIds[0])
    : baseQuery.in("enrollment_id", enrollmentIds);
  const { data, error } = await enrollmentQuery.in("source_activity_id", sourceIds).order("created_at");

  if (error) throw error;

  const stored = (data ?? []) as StoredEnrollmentAction[];
  return activities.map((activity) => ({
    ...activity,
    enrollment_actions: activity.enrollment_id
      ? stored
          .filter((action) => action.enrollment_id === activity.enrollment_id
            && action.source_activity_type === sourceActivityType
            && action.source_activity_id === activity.id)
          .map((action) => ({
            id: action.id,
            text: action.title,
            done: action.status === "completed",
            goal_id: action.goal_id,
            milestone_id: action.milestone_id,
            due_date: action.due_date,
            description: action.description ?? null,
          }))
      : [],
  }));
}

export async function saveEnrollmentActions(
  enrollmentId: string | null | undefined,
  sourceActivityType: EnrollmentActionSource,
  sourceActivityId: string,
  actions: EnrollmentActionItem[],
) {
  if (!enrollmentId) {
    return { error: new Error("An enrollment is required to save programme actions") };
  }

  return supabase.rpc("save_enrollment_activity_actions", {
    p_enrollment_id: enrollmentId,
    p_source_activity_type: sourceActivityType,
    p_source_activity_id: sourceActivityId,
    p_actions: actions.map((action) => ({
      id: action.id ?? null,
      title: action.text,
      description: action.description ?? null,
      status: action.done ? "completed" : "open",
      goal_id: action.goal_id ?? null,
      milestone_id: action.milestone_id ?? null,
      due_date: action.due_date ?? null,
    })),
  });
}