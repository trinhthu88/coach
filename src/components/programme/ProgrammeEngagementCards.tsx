import type { ReactNode } from "react";
import { formatCount, formatPercent, type ProgrammeEngagementFacts } from "@/lib/programmeProfile";
import { ProfileLoadError, ProfileSection, ProfileSectionTitle, SmallMetric, UnavailableNote } from "./primitives";
import { PROFILE_COLORS, useProfileText, type ProgrammeViewer } from "./profileTheme";

const { TEAL } = PROFILE_COLORS;

/**
 * Goal summary — the three canonical_enrollment_engagement counts both
 * viewers share (goals set, average goal progress, actions completed).
 * The sponsor sees only this; the learner self-view passes its own goal
 * and action detail as `children`.
 */
export function ProgrammeGoalSummary({
  engagement,
  viewer,
  error,
  aside,
  children,
}: {
  engagement: ProgrammeEngagementFacts;
  viewer: ProgrammeViewer;
  error?: string | null;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const text = useProfileText(viewer);
  return (
    <ProfileSection id="goals-actions">
      <ProfileSectionTitle title={text("goalsTitle")} aside={aside ?? text("progressOnly")} />
      {error ? (
        <ProfileLoadError text={error} />
      ) : (
        <div data-testid="goal-summary" className="mt-5 flex flex-wrap gap-x-[34px] gap-y-5">
          <SmallMetric value={formatCount(engagement.goal_count)} label={text("goalsSet")} />
          <SmallMetric value={formatPercent(engagement.goal_progress_pct)} label={text("averageGoalProgress")} color={TEAL} />
          <SmallMetric
            value={engagement.total_action_count == null ? "—" : `${engagement.completed_action_count ?? 0} / ${engagement.total_action_count}`}
            label={text("actionsCompleted")}
          />
        </div>
      )}
      {children ?? (
        <>
          <div className="mt-5 border-t border-[#eee8de] pt-4">
            <div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{text("goalTrend")}</div>
            <UnavailableNote text={text("trendWithheld")} />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-[#9a938a]">{text("goalPrivacy")}</p>
        </>
      )}
    </ProfileSection>
  );
}

/** Programme experience rating — canonical average of completed-session ratings. */
export function ProgrammeExperienceRating({ engagement, viewer }: { engagement: ProgrammeEngagementFacts; viewer: ProgrammeViewer }) {
  const text = useProfileText(viewer);
  const avg = engagement.satisfaction_avg;
  return (
    <ProfileSection className="flex flex-col">
      <h2 className="font-serif text-[17px] font-normal">{text("ratingTitle")}</h2>
      <div className="mt-5 flex items-end gap-4">
        <div className="font-serif text-[52px] font-light leading-[.9]">{avg == null ? "—" : Number(avg).toFixed(1)}</div>
        <div className="pb-1.5">
          <div className="text-[13px] text-[#6a6560]">{text("outOfFive")}</div>
          <div className="mt-0.5 text-[11.5px] text-[#9a938a]">{text("responses", { count: engagement.satisfaction_rated_count ?? 0 })}</div>
        </div>
      </div>
      <UnavailableNote text={avg == null ? text("ratingNone") : text("ratingTrendWithheld")} locked={viewer === "sponsor"} />
      <p className="mt-auto pt-4 text-[11px] leading-relaxed text-[#9a938a]">{text("ratingPrivacy")}</p>
    </ProfileSection>
  );
}
