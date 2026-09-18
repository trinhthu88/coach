import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useJourneyGoals } from "@/hooks/journey/useJourneyGoals";
import { useJourneyRatings } from "@/hooks/journey/useJourneyRatings";
import { useGoalRatingRows } from "@/hooks/journey/useJourneyDerived";
import { useEnrollmentActionsSummary } from "@/hooks/dashboard/useEnrollmentActionsSummary";
import { Card } from "@/components/ui/card";

/**
 * Goals & actions — same canonical sources as MyGoalCard
 * (coachee_goals/coachee_goal_ratings via useJourneyGoals/useJourneyRatings,
 * enrollment_actions via useEnrollmentActionsSummary), presented as the
 * approved prototype's fuller summary rather than MyGoalCard's compact tile.
 */
export function CoacheeGoalsActionsCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;

  const { goals, loading: goalsLoading, error: goalsError } = useJourneyGoals(user?.id, { enrollmentId });
  const { ratings, loading: ratingsLoading } = useJourneyRatings(user?.id, enrollmentId);
  const { ratingRows, avgGoalProgress } = useGoalRatingRows(goals, ratings);
  const actions = useEnrollmentActionsSummary(enrollmentId);

  const loading = enrollmentLoading || goalsLoading || ratingsLoading || actions.loading;
  const activeGoals = goals.filter((g) => g.status === "active");

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg">{t("coacheeDashboard.goalsActions.title")}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("coacheeDashboard.goalsActions.subtitle")}</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 h-28 animate-pulse rounded-xl bg-muted/50" />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3 border-b border-border pb-4">
            <Stat value={String(activeGoals.length)} label={t("coacheeDashboard.goalsActions.activeGoals")} />
            <Stat
              value={avgGoalProgress != null ? `${avgGoalProgress}%` : "—"}
              label={t("coacheeDashboard.goalsActions.avgProgress")}
            />
            <Stat
              value={`${actions.completedCount}/${actions.total}`}
              label={t("coacheeDashboard.goalsActions.actionsComplete")}
            />
          </div>

          {goalsError ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("cards.myGoal.loadError")}</p>
          ) : activeGoals.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("coacheeDashboard.goalsActions.emptyGoals")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {activeGoals.slice(0, 2).map((goal) => {
                const row = ratingRows.find((r) => r.goalId === goal.id);
                return (
                  <li key={goal.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                    <p className="truncate text-[12px] font-semibold">{goal.title}</p>
                    {row && row.start != null && row.current != null && row.target != null && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">
                        <span className="font-display">{row.start}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-display text-primary">{row.current}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {t("coacheeDashboard.goalsActions.ofScale", { target: row.target })}
                        </span>
                      </div>
                    )}
                    {row?.progress != null && (
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${row.progress}%` }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <Link to="/coachee/journey" className="mt-4 inline-block text-[11.5px] font-semibold text-primary hover:underline">
        {t("coacheeDashboard.goalsActions.viewAll")}
      </Link>
    </Card>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-display text-xl">{value}</p>
      <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
    </div>
  );
}
