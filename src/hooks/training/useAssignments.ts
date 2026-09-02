import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export type AssignmentType = "quiz" | "reflection";

export interface AssignmentListItem {
  id: string;
  assignment_type: AssignmentType;
  title: string;
  title_vi: string | null;
  sort_order: number;
  submitted: boolean;
  score_pct: number | null;
}

/**
 * The visible assignments (quizzes + reflections) for a training week, plus
 * whether the current user has already submitted each one — shown at the
 * bottom of SkillCardView. Renders nothing upstream when the list is empty,
 * which is also what a user without the 'quiz' module sees (assignments RLS
 * withholds rows in that case, same as skill_card_elements does for 'training').
 */
export function useAssignments(weekId: string | undefined) {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["assignments", weekId, user?.id],
    queryFn: async () => {
      const { data: assignments, error } = await supabase
        .from("assignments")
        .select("id, assignment_type, title, title_vi, sort_order")
        .eq("training_week_id", weekId as string)
        .order("sort_order");
      if (error) throw error;

      const ids = (assignments ?? []).map((a) => a.id);
      const submissionsById = new Map<string, { score_pct: number | null }>();
      if (ids.length > 0) {
        const { data: submissions, error: subError } = await supabase
          .from("assignment_submissions")
          .select("assignment_id, score_pct")
          .in("assignment_id", ids)
          .eq("user_id", user!.id);
        if (subError) throw subError;
        (submissions ?? []).forEach((s) => submissionsById.set(s.assignment_id, { score_pct: s.score_pct }));
      }

      return (assignments ?? []).map((a) => ({
        ...a,
        submitted: submissionsById.has(a.id),
        score_pct: submissionsById.get(a.id)?.score_pct ?? null,
      })) as AssignmentListItem[];
    },
    enabled: !!weekId && !!user,
  });

  return { assignments: data ?? [], loading: isLoading };
}
