import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle } from "lucide-react";
import { useJourneyGoals } from "@/hooks/journey/useJourneyGoals";
import { useJourneyRatings, type GoalCheckin } from "@/hooks/journey/useJourneyRatings";
import { useLearnerCanonicalGoalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { useEnrollmentActionsSummary, type EnrollmentActionRow } from "@/hooks/dashboard/useEnrollmentActionsSummary";
import type { Goal, GoalRating, Milestone } from "@/hooks/journey/types";
import { formatProfileDate, type ProgrammeEngagementFacts } from "@/lib/programmeProfile";
import { ProgrammeGoalSummary } from "@/components/programme/ProgrammeEngagementCards";
import { MiniProgress, ProfileLoadError, ProfileSkeleton, UnavailableNote } from "@/components/programme/primitives";
import { PROFILE_COLORS } from "@/components/programme/profileTheme";

const { TEAL, RED, GREEN } = PROFILE_COLORS;
const DASHBOARD_GOAL_LIMIT = 2;
const ACTIONS_PER_GOAL = 3;

/**
 * Learner Goals & Actions — the same canonical summary row the sponsor sees
 * (ProgrammeGoalSummary ← canonical_enrollment_engagement), followed by the
 * learner's OWN goal detail that a sponsor never receives: wording, success
 * measure, Start/Current/Target ratings, latest check-in, milestones and
 * linked actions. Sources are the learner's existing RLS-scoped tables
 * (coachee_goals, coachee_milestones, coachee_goal_ratings, goal_checkins,
 * enrollment_actions) via the hooks My Journey already uses.
 */
export function LearnerGoalsActions({
  userId,
  enrollmentId,
  engagement,
  engagementError,
}: {
  userId: string | undefined;
  enrollmentId: string | undefined;
  engagement: ProgrammeEngagementFacts;
  engagementError: string | null;
}) {
  const { t } = useTranslation("dashboard");
  const goalsApi = useJourneyGoals(userId, { enrollmentId });
  const ratingsApi = useJourneyRatings(userId, enrollmentId);
  const actions = useEnrollmentActionsSummary(enrollmentId);
  const goalProgress = useLearnerCanonicalGoalProgress(enrollmentId);

  const loading = goalsApi.loading || ratingsApi.loading || actions.loading || goalProgress.loading;
  const detailError = goalsApi.error || ratingsApi.error || actions.error || goalProgress.error;
  const activeGoals = goalsApi.goals.filter((g) => g.status === "active");
  const unlinkedOpen = actions.actions.filter((a) => !a.goal_id && a.status !== "completed");

  return (
    <ProgrammeGoalSummary
      engagement={engagement}
      viewer="learner"
      error={engagementError ? t("learnerProfile.errors.engagement") : null}
      aside={t("learnerProfile.goals.aside", { count: activeGoals.length })}
    >
      <div className="mt-5 border-t border-[#eee8de] pt-4">
        {loading ? (
          <ProfileSkeleton className="h-32" />
        ) : detailError ? (
          <ProfileLoadError text={t("learnerProfile.errors.goals")} />
        ) : activeGoals.length === 0 ? (
          <UnavailableNote text={t("learnerProfile.goals.emptyGoals")} locked={false} />
        ) : (
          <ul data-testid="learner-goal-list" className="flex flex-col gap-3">
            {activeGoals.slice(0, DASHBOARD_GOAL_LIMIT).map((goal) => (
              <GoalDetail
                key={goal.id}
                goal={goal}
                rating={ratingsApi.ratings[goal.id]}
                progress={goalProgress.progressByGoal[goal.id] ?? null}
                latestCheckin={ratingsApi.checkins.find((c) => c.goal_id === goal.id) ?? null}
                milestones={goalsApi.milestones.filter((m) => m.goal_id === goal.id)}
                actions={actions.actions.filter((a) => a.goal_id === goal.id)}
                overdueIds={new Set(actions.overdue.map((a) => a.id))}
              />
            ))}
          </ul>
        )}

        {!loading && !detailError && (
          <div className="mt-4">
            <div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{t("learnerProfile.goals.otherActions")}</div>
            {unlinkedOpen.length === 0 ? (
              <p className="mt-2 text-[11px] text-[#9a938a]">{actions.openCount === 0 ? t("learnerProfile.goals.noActiveActions") : t("learnerProfile.goals.allLinked")}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {unlinkedOpen.slice(0, ACTIONS_PER_GOAL).map((action) => (
                  <ActionLine key={action.id} action={action} overdue={actions.overdue.some((a) => a.id === action.id)} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <Link to="/coachee/journey#goals" className="mt-4 inline-block text-[11.5px] font-semibold text-[#2c8fa8] hover:underline">
        {t("learnerProfile.goals.viewAll", { count: engagement.goal_count ?? goalsApi.goals.length })}
      </Link>
    </ProgrammeGoalSummary>
  );
}

function GoalDetail({
  goal,
  rating,
  progress,
  latestCheckin,
  milestones,
  actions,
  overdueIds,
}: {
  goal: Goal;
  rating: GoalRating | undefined;
  /** canonical_goal_progress — rendered, never recalculated here. */
  progress: number | null;
  latestCheckin: GoalCheckin | null;
  milestones: Milestone[];
  actions: EnrollmentActionRow[];
  overdueIds: Set<string>;
}) {
  const { t } = useTranslation("dashboard");
  const start = rating?.start_rating ?? null;
  const current = rating?.current_rating ?? null;
  const target = rating?.target_rating ?? null;
  const doneMilestones = milestones.filter((m) => m.is_done).length;
  const openActions = useMemo(
    () =>
      actions
        .filter((a) => a.status !== "completed")
        .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")),
    [actions]
  );
  const completedActions = actions.length - openActions.length;

  return (
    <li data-testid="learner-goal" className="rounded-xl border border-[#eee8de] bg-[#f6f3ee] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-serif text-[15px] leading-snug text-[#062f3e]">{goal.title}</p>
          {goal.description && <p className="mt-1 line-clamp-2 text-[11px] text-[#6a6560]">{t("learnerProfile.goals.successMeasure", { text: goal.description })}</p>}
        </div>
        <Link to={`/coachee/journey#goal-${goal.id}`} className="shrink-0 text-[10.5px] font-semibold text-[#2c8fa8] hover:underline">
          {t("learnerProfile.goals.open")}
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2 text-[11px] text-[#6a6560]">
        <RatingStat label={t("learnerProfile.goals.start")} value={start} />
        <RatingStat label={t("learnerProfile.goals.current")} value={current} color={TEAL} />
        <RatingStat label={t("learnerProfile.goals.target")} value={target} />
        <span className="ml-auto text-[10.5px]">
          {goal.target_date ? t("learnerProfile.goals.targetDate", { date: formatProfileDate(goal.target_date) }) : t("learnerProfile.goals.noTargetDate")}
        </span>
      </div>
      <MiniProgress pct={progress} color={TEAL} />
      <div className="mt-1 flex justify-between text-[9.5px] text-[#9a938a]">
        <span>{progress == null ? t("learnerProfile.goals.notRated") : t("learnerProfile.goals.progress", { pct: Math.round(progress) })}</span>
        <span>
          {latestCheckin
            ? t("learnerProfile.goals.latestCheckin", {
                date: formatProfileDate(latestCheckin.created_at),
                from: latestCheckin.previous_rating ?? "—",
                to: latestCheckin.new_rating ?? "—",
              })
            : t("learnerProfile.goals.noCheckin")}
        </span>
      </div>
      {latestCheckin?.note && <p className="mt-1.5 line-clamp-2 text-[11px] italic text-[#6a6560]">“{latestCheckin.note}”</p>}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">
            {t("learnerProfile.goals.milestones", { done: doneMilestones, total: milestones.length })}
          </div>
          {milestones.length === 0 ? (
            <p className="mt-1.5 text-[10.5px] text-[#9a938a]">{t("learnerProfile.goals.noMilestones")}</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1">
              {milestones.slice(0, 3).map((m) => (
                <li key={m.id} className="flex items-center gap-1.5 text-[11px] text-[#062f3e]">
                  {m.is_done ? <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: GREEN }} /> : <Circle className="h-3 w-3 shrink-0 text-[#9a938a]" />}
                  <span className={m.is_done ? "truncate line-through opacity-60" : "truncate"}>{m.title}</span>
                  {m.target_date && !m.is_done && <span className="ml-auto shrink-0 text-[9.5px] text-[#9a938a]">{formatProfileDate(m.target_date)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[#9a938a]">
            {t("learnerProfile.goals.linkedActions", { done: completedActions, total: actions.length })}
          </div>
          {openActions.length === 0 ? (
            <p className="mt-1.5 text-[10.5px] text-[#9a938a]">{t("learnerProfile.goals.noOpenActions")}</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1">
              {openActions.slice(0, ACTIONS_PER_GOAL).map((action) => (
                <ActionLine key={action.id} action={action} overdue={overdueIds.has(action.id)} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

function RatingStat({ label, value, color }: { label: string; value: number | null; color?: string }) {
  return (
    <div>
      <div className="font-serif text-[18px] font-light leading-none" style={{ color }}>{value ?? "—"}</div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-[.14em] text-[#9a938a]">{label}</div>
    </div>
  );
}

function ActionLine({ action, overdue }: { action: EnrollmentActionRow; overdue: boolean }) {
  const { t } = useTranslation("dashboard");
  return (
    <li data-testid="learner-action" className="flex items-center gap-2 text-[11px] text-[#062f3e]">
      <span className="min-w-0 flex-1 truncate">{action.title}</span>
      <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[.1em]" style={{ color: overdue ? RED : "#9a938a" }}>
        {overdue ? t("learnerProfile.goals.actionOverdue") : t(`learnerProfile.goals.actionStatus.${action.status}`, { defaultValue: action.status })}
      </span>
      <span className="shrink-0 text-[9.5px] text-[#9a938a]">{action.due_date ? formatProfileDate(action.due_date) : t("learnerProfile.goals.noDueDate")}</span>
    </li>
  );
}
