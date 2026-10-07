import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProgrammeOption {
  id: string;
  name: string;
}

export interface ProgrammeWeekEngagement {
  weekId: string;
  weekNumber: number;
  title: string;
  enrolledCount: number;
  completedCount: number;
  skillCardCompletionPct: number | null;
  quizAvgScore: number | null;
  quizCompletionPct: number | null;
  /** Canonical Triad reflection rate for the week (admin_programme_triad_reflection_rate). Engagement only — never completion. */
  triadReflectionPct: number | null;
  promptResponseRate: number | null;
}

export interface ProgrammeRedFlag {
  userId: string;
  enrollmentId: string;
  fullName: string;
  daysSinceLastActivity: number | null;
}

export function useAdminProgrammes() {
  const [programmes, setProgrammes] = useState<ProgrammeOption[]>([]);
  useEffect(() => {
    supabase.from("programmes").select("id, name").order("name").then(({ data }) => setProgrammes(data ?? []));
  }, []);
  return programmes;
}

/**
 * Admin per-programme engagement. Every number is one canonical calculation,
 * read and rendered: per-week Training engagement
 * (admin_programme_training_engagement over canonical_training_week_fulfilment,
 * 20261007001100), the Triad reflection rate (admin_programme_triad_reflection_rate)
 * and "inactive 7+ days" (admin_enrollment_inactivity).
 */
export function useAdminProgrammeEngagement(programmeId: string | null) {
  const [weeks, setWeeks] = useState<ProgrammeWeekEngagement[]>([]);
  const [redFlags, setRedFlags] = useState<ProgrammeRedFlag[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!programmeId) {
      setWeeks([]);
      setRedFlags([]);
      return;
    }
    let mounted = true;
    (async () => {
      setLoading(true);
      const [{ data: engagement }, { data: reflectionRate }, { data: inactivity }] = await Promise.all([
        supabase.rpc("admin_programme_training_engagement", { p_programme_id: programmeId }),
        supabase.rpc("admin_programme_triad_reflection_rate", { p_programme_id: programmeId }),
        supabase.rpc("admin_enrollment_inactivity", { p_programme_id: programmeId }),
      ]);
      if (!mounted) return;
      const flags: ProgrammeRedFlag[] = (inactivity ?? [])
        .filter((row) => row.is_inactive)
        .map((row) => ({
          userId: row.user_id,
          enrollmentId: row.enrollment_id,
          fullName: row.full_name || "—",
          daysSinceLastActivity: row.days_since_last_activity,
        }))
        .sort((a, b) => (b.daysSinceLastActivity ?? 999) - (a.daysSinceLastActivity ?? 999));
      const triadRateByWeek = new Map(
        (reflectionRate ?? []).filter((row) => !row.is_total && row.training_week_id).map((row) => [row.training_week_id as string, row.rate_pct])
      );
      setWeeks(
        (engagement ?? [])
          .filter((row) => !row.is_total && row.training_week_id)
          .map((row) => ({
            weekId: row.training_week_id as string,
            weekNumber: row.week_number as number,
            title: row.title as string,
            enrolledCount: row.enrolled_count,
            completedCount: row.completed_count,
            skillCardCompletionPct: row.skill_card_pct,
            quizAvgScore: row.quiz_avg_score,
            quizCompletionPct: row.quiz_pct,
            triadReflectionPct: triadRateByWeek.get(row.training_week_id as string) ?? null,
            promptResponseRate: row.prompt_pct,
          })),
      );
      setRedFlags(flags);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [programmeId]);
  return { weeks, redFlags, loading };
}
