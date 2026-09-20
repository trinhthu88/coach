import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Target, ListChecks, ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useJourneyGoals } from "@/hooks/journey/useJourneyGoals";
import { useJourneyRatings } from "@/hooks/journey/useJourneyRatings";
import { useGoalRatingRows } from "@/hooks/journey/useJourneyDerived";
import { useEnrollmentActionsSummary } from "@/hooks/dashboard/useEnrollmentActionsSummary";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { deriveNextUp } from "@/lib/nextUp";
import { DashboardCardShell, CardFooterLink, CardEmptyHint } from "./shared";

/**
 * Goals + actions + "what's next" — all sourced from the same
 * enrollment-scoped canonical records the Journey page and Sponsor Leader
 * Detail read (coachee_goals/coachee_goal_ratings for goal progress,
 * enrollment_actions for commitments, learner_canonical_journey/experience
 * for requirement state). Nothing here is computed a second, different way.
 */
export function MyGoalCard() {
  const { t } = useTranslation("dashboard");
  const { user, role } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;

  const { goals, loading: goalsLoading, error: goalsError } = useJourneyGoals(user?.id, { enrollmentId });
  const { ratings, loading: ratingsLoading } = useJourneyRatings(user?.id, enrollmentId);
  const { ratingRows } = useGoalRatingRows(goals, ratings);
  const actions = useEnrollmentActionsSummary(enrollmentId);
  const { journey, experience, loading: progressLoading } = useLearnerCanonicalProgress(enrollmentId);

  const loading = enrollmentLoading || goalsLoading || ratingsLoading || actions.loading || progressLoading;
  const journeyPath = role === "coach" ? "/coach/my-journey" : "/coachee/journey";

  if (loading) {
    return (
      <DashboardCardShell icon={Target} title={t("cards.myGoal.title")} loading>
        <div />
      </DashboardCardShell>
    );
  }

  if (!enrollmentId) {
    return (
      <DashboardCardShell icon={Target} title={t("cards.myGoal.title")}>
        <CardEmptyHint text={t("cards.myGoal.enrollmentRequired")} />
      </DashboardCardShell>
    );
  }

  const activeGoals = goals.filter((g) => g.status === "active");
  const primaryGoal = activeGoals[0] ?? null;
  const primaryProgress = primaryGoal ? ratingRows.find((r) => r.goalId === primaryGoal.id)?.progress ?? null : null;

  const nextUp = deriveNextUp({
    journey,
    learningBreakdown: experience.learningBreakdown,
    overdueActions: actions.overdue,
    nextSessionAt: experience.coachingUtilisation?.next_session_at ?? null,
  });

  return (
    <DashboardCardShell icon={Target} title={t("cards.myGoal.title")}>
      {goalsError ? (
        <CardEmptyHint text={t("cards.myGoal.loadError")} />
      ) : !primaryGoal ? (
        <CardEmptyHint text={t("cards.myGoal.empty")} />
      ) : (
        <div>
          <p className="truncate text-sm font-semibold">{primaryGoal.title}</p>
          {primaryGoal.target_date && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t("cards.myGoal.targetDate", { date: format(new Date(primaryGoal.target_date), "MMM d, yyyy") })}
            </p>
          )}
          <p className="mt-2 text-xl font-semibold">
            {primaryProgress == null ? "—" : `${primaryProgress}%`}
            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{t("cards.myGoal.progressLabel")}</span>
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${primaryProgress ?? 0}%` }} />
          </div>
          {activeGoals.length > 1 && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {t("cards.myGoal.additionalGoals", { count: activeGoals.length - 1 })}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5 shrink-0" />
        {actions.error ? (
          <span>{t("cards.myGoal.actionsLoadError")}</span>
        ) : actions.total === 0 ? (
          <span>{t("cards.myGoal.noActions")}</span>
        ) : (
          <span>
            {t("cards.myGoal.actionsSummary", { open: actions.openCount, completed: actions.completedCount })}
            {actions.overdue.length > 0 && (
              <span className="ml-1 font-semibold text-destructive">
                {t("cards.myGoal.overdueSuffix", { count: actions.overdue.length })}
              </span>
            )}
          </span>
        )}
      </div>

      {nextUp && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px]">
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">
            <span className="font-semibold text-foreground">{t("cards.myGoal.nextUpLabel")}</span> {nextUp.label}
          </span>
        </div>
      )}

      <CardFooterLink to={journeyPath}>{t("cards.myGoal.openJourney")}</CardFooterLink>
    </DashboardCardShell>
  );
}
