import {
  clampPct,
  formatCount,
  formatPercent,
  type ProgrammeEngagementFacts,
  type ProgrammeProgressFacts,
} from "@/lib/programmeProfile";
import { ProfileKpi } from "./primitives";
import { PROFILE_COLORS, useProfileText, type ProgrammeViewer } from "./profileTheme";

const { NAVY, TEAL, GREEN, RED } = PROFILE_COLORS;

/**
 * The six top KPI cards. Every value is a canonical field rendered as-is:
 * overall completion / activities / overdue from the progress row, coaching
 * sessions from its coaching columns, goal progress and satisfaction from
 * canonical_enrollment_engagement. Nothing is recalculated per viewer.
 */
export function ProgrammeMetricCards({
  facts,
  engagement,
  viewer,
}: {
  facts: ProgrammeProgressFacts;
  engagement: ProgrammeEngagementFacts;
  viewer: ProgrammeViewer;
}) {
  const text = useProfileText(viewer);
  return (
    <div data-testid="programme-kpis" className="mt-4 grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
      <ProfileKpi label={text("overallCompletion")} value={formatPercent(facts.full_completion_pct == null ? null : clampPct(facts.full_completion_pct))} color={NAVY} />
      <ProfileKpi label={text("activitiesCompleted")} value={`${facts.completed_units} / ${facts.required_units}`} color={NAVY} />
      <ProfileKpi label={text("coachingSessions")} value={formatCount(facts.coaching_completed_units)} color={NAVY} />
      <ProfileKpi label={text("goalProgress")} value={formatPercent(engagement.goal_progress_pct)} color={TEAL} />
      <ProfileKpi
        label={text("satisfaction")}
        value={engagement.satisfaction_avg == null ? "—" : Number(engagement.satisfaction_avg).toFixed(1)}
        color={GREEN}
      />
      <ProfileKpi label={text("overdue")} value={String(facts.overdue_units ?? 0)} color={RED} />
    </div>
  );
}
