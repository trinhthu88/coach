import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useJourneyGoals } from "@/hooks/journey/useJourneyGoals";
import { useJourneyRatings } from "@/hooks/journey/useJourneyRatings";
import { useJourneySessions } from "@/hooks/journey/useJourneySessions";
import { useJourneyReflections } from "@/hooks/journey/useJourneyReflections";
import { useJourneyProgramme } from "@/hooks/journey/useJourneyProgramme";
import { useFlatActionItems, type FlatAction } from "@/hooks/journey/useFlatActionItems";
import { useEnrollmentActionsSummary } from "@/hooks/dashboard/useEnrollmentActionsSummary";
import { useGoalLock } from "@/hooks/journey/useJourneyDerived";
import type { JourneySession } from "@/hooks/journey/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, BookOpen, ArrowRight, PenLine } from "lucide-react";
import { format } from "date-fns";
import { SectionHeader } from "./journey/SectionHeader";
import { EmptyGoals } from "./journey/EmptyGoals";
import { GoalAccordion } from "./journey/GoalAccordion";
import { GoalDialog } from "./journey/GoalDialog";
import { EnrollmentActionGroups } from "./journey/EnrollmentActionGroups";
import { PracticeCompetencyCard } from "./journey/PracticeCompetencyCard";
import { useEnrollmentDevelopmentJourney } from "@/hooks/journey/useEnrollmentDevelopmentJourney";
import { useLearnerFeedback } from "@/hooks/dashboard/useLearnerFeedback";
import { LearnerProgrammeJourney } from "@/components/programme/LearnerProgrammeJourney";
import { FeedbackItemCard } from "@/components/programme/FeedbackItemCard";
import {
  MiniProgress,
  ProfileLoadError,
  ProfileSection,
  ProfileSectionTitle,
  SmallMetric,
  UnavailableNote,
} from "@/components/programme/primitives";
import { PROFILE_COLORS } from "@/components/programme/profileTheme";
import { useLearnerCanonicalGoalProgress, useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { useHashScroll } from "@/hooks/useHashScroll";
import { useLearnerReflectionFeed } from "@/hooks/journey/useLearnerReflectionFeed";
import { ReflectionFeedItem } from "@/components/programme/ReflectionFeedItem";
import { formatProfileDate } from "@/lib/programmeProfile";
import { STATUS_LABEL_KEY, STATUS_TONE, effectiveSponsorStatus } from "@/pages/sponsor/sponsorUtils";
import { DevelopmentJourneyList } from "@/components/journey/DevelopmentJourneyList";
import { derivePendingDeliverables } from "@/lib/pendingReflections";
import { useLearnerSessionDeliverables } from "@/hooks/sessions/usePostSessionDeliverables";
import { deliverableSessionType } from "@/lib/postSessionDeliverables";

const STATUS_PILL = {
  success: "bg-[#e8f1ec] text-[#17663f]",
  warning: "bg-[#faf0e3] text-[#a8541c]",
  destructive: "bg-[#fdf4ef] text-[#a8341c]",
  muted: "bg-[#f2eee6] text-[#7d7468]",
} as const;

export default function CoacheeJourney() {
  const { t } = useTranslation("journey");
  const { t: tDash } = useTranslation("dashboard");
  const { t: tSponsor } = useTranslation("sponsor");
  const { user } = useAuth();
  const programmeApi = useJourneyProgramme(user?.id);
  const canonical = useLearnerCanonicalProgress(programmeApi.programme?.enrollmentId);
  const goalProgress = useLearnerCanonicalGoalProgress(programmeApi.programme?.enrollmentId);
  const goalsApi = useJourneyGoals(user?.id, { enrollmentId: programmeApi.programme?.enrollmentId });
  const ratingsApi = useJourneyRatings(user?.id, programmeApi.programme?.enrollmentId);
  const sessionsApi = useJourneySessions(user?.id, { includePeer: false, enrollmentId: programmeApi.programme?.enrollmentId });
  const reflectionsApi = useJourneyReflections(user?.id, programmeApi.programme?.enrollmentId);
  const developmentJourney = useEnrollmentDevelopmentJourney(programmeApi.programme?.enrollmentId, user?.id);
  const learnerFeedback = useLearnerFeedback(user?.id, programmeApi.programme?.enrollmentId);
  // Every enrollment_actions row for this enrollment, regardless of which
  // module it was created from (useFlatActionItems below only sees actions
  // whose source is a currently-loaded coaching session).
  const allActionsSummary = useEnrollmentActionsSummary(programmeApi.programme?.enrollmentId);

  const { goals, milestones, toggleMilestone } = goalsApi;
  // Max 3 active goals per enrollment (server rule); create is disabled at the cap.
  const activeGoalCount = goals.filter((g) => g.status === "active").length;
  const { ratings, saveRating } = ratingsApi;
  const { coachingSessions, toggleAction: toggleActionRaw } = sessionsApi;
  const { deleteReflection } = reflectionsApi;
  // THE learner reflection feed (learner_reflection_feed): session, peer,
  // mentoring and triad reflections, goal check-in comments, training
  // prompts and explicit journey reflections — projected from their original
  // records. The Dashboard shows a recent subset of this same feed.
  const reflectionFeed = useLearnerReflectionFeed(programmeApi.programme?.enrollmentId);
  // Completed sessions with post-session deliverables still outstanding,
  // across every module and both Peer roles: ONE definition of outstanding,
  // learner_session_deliverables().
  const sessionDeliverables = useLearnerSessionDeliverables(programmeApi.programme?.enrollmentId);
  const pendingDeliverables = useMemo(
    () =>
      sessionDeliverables.loading || sessionDeliverables.error
        ? []
        : derivePendingDeliverables(sessionDeliverables.deliverables),
    [sessionDeliverables.loading, sessionDeliverables.error, sessionDeliverables.deliverables],
  );
  const { programme } = programmeApi;

  const loading =
    goalsApi.loading || ratingsApi.loading || sessionsApi.loading || reflectionsApi.loading || programmeApi.loading;

  const [newReflection, setNewReflection] = useState("");
  const [reflectionMood, setReflectionMood] = useState("");
  const [savingRef, setSavingRef] = useState(false);

  // Normalized so this page can share derived-data hooks and presentational
  // components with CoachMyJourney (which also mixes in peer sessions).
  const sessions = useMemo<JourneySession[]>(
    () => coachingSessions.map((s) => ({ ...s, _source: "coaching" as const, _otherCoachId: s.coach_id })),
    [coachingSessions]
  );

  // Start/Current/Target are the learner's own raw ratings (editable here);
  // progress % is never derived in the browser — it is canonical_goal_progress
  // (goalProgress below), the same per-goal values Sponsor's goal_progress_pct
  // averages.
  const ratingRows = useMemo(
    () =>
      goals.map((g) => {
        const r = ratings[g.id];
        return {
          goalId: g.id,
          title: g.title,
          start: r?.start_rating ?? null,
          current: r?.current_rating ?? null,
          target: r?.target_rating ?? null,
          progress: goalProgress.progressByGoal[g.id] ?? null,
        };
      }),
    [goals, ratings, goalProgress.progressByGoal]
  );

  const { allActionItems } = useFlatActionItems(sessions);
  // Only coaching-session-sourced actions can be toggled here (the mutation
  // path is session-scoped) — actions from other sources still display,
  // just without an interactive checkbox.
  const toggleableById = useMemo(() => {
    const map = new Map<string, FlatAction>();
    for (const a of allActionItems) if (a.id) map.set(a.id, a);
    return map;
  }, [allActionItems]);

  const nextActionForGoal = (goalId: string) => {
    const open = allActionsSummary.actions
      .filter((a) => a.goal_id === goalId && a.status !== "completed")
      .sort((a, b) => {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return +new Date(a.due_date) - +new Date(b.due_date);
      });
    return open[0] ?? null;
  };

  const { isGoalLocked } = useGoalLock(sessions);

  const addReflection = async () => {
    if (!newReflection.trim() || !user) return;
    setSavingRef(true);
    const ok = await reflectionsApi.addReflection(newReflection, reflectionMood);
    setSavingRef(false);
    if (!ok) return;
    setNewReflection("");
    setReflectionMood("");
  };

  const toggleAction = (a: FlatAction) => toggleActionRaw(a.sessionId, a.idx, "coaching");

  // Dashboard CTAs deep-link into sections (#programme-journey, #goals,
  // #goal-<id>, #feedback).
  useHashScroll(!loading);

  if (loading) {
    return <PageSkeleton />;
  }

  const status = canonical.progress ? effectiveSponsorStatus(canonical.progress) : null;

  return (
    <div className="pb-4" style={{ color: PROFILE_COLORS.NAVY }}>
      {/* Coachee prototype → My Journey: plain page header; programme status,
          dates and requirements live in the shared Programme journey below. */}
      <header data-testid="journey-header" className="mb-[18px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[9.5px] font-extrabold uppercase tracking-[.18em] text-[#2c8fa8]">{t("coacheeJourney.eyebrow")}</div>
          <h1 className="mt-[9px] font-serif text-[30px] font-light leading-[1.1] tracking-[-.025em] text-[#062f3e]">{t("coacheeJourney.title")}</h1>
          <p className="mt-2 max-w-[70ch] text-[12.5px] text-[#7d7468]">
            {canonical.progress
              ? t("coacheeJourney.subtitleFor", {
                  programme: canonical.progress.programme_label,
                  cohort: canonical.progress.cohort_label || "—",
                })
              : t("coacheeJourney.subtitle")}
          </p>
        </div>
        {canonical.progress && status && (
          <span
            data-testid="journey-status"
            className={`rounded-full px-[13px] py-2 text-[9px] font-extrabold uppercase tracking-[.08em] ${STATUS_PILL[STATUS_TONE[status]]}`}
          >
            {tSponsor(`status.${STATUS_LABEL_KEY[status]}`)} · {formatProfileDate(canonical.progress.enrollment_start_date)} – {formatProfileDate(canonical.progress.enrollment_end_date)}
          </span>
        )}
      </header>

      {/* The same shared Programme Journey the Dashboard and Sponsor Leader
          Detail render — full variant: every checkpoint plus detail. */}
      <LearnerProgrammeJourney id="programme-journey" enrollmentId={programme?.enrollmentId} variant="full" />

      <div className="mt-4 grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
        <ProfileSection id="goals" className="scroll-mt-4">
          <ProfileSectionTitle
            title={t("journeyPage.goalsAndActions.title")}
            aside={goals.length > 0 ? <GoalDialog onAdd={goalsApi.addGoal} activeCount={activeGoalCount} /> : undefined}
          />
          <p className="mt-1.5 text-[11.5px] text-[#9a938a]">{t("journeyPage.goalsAndActions.subtitle", { count: goals.length })}</p>

          <div className="mt-4">
            {goalsApi.error || ratingsApi.error || goalProgress.error ? (
              <ProfileLoadError text={tDash("learnerProfile.errors.goals")} />
            ) : goals.length === 0 ? (
              <EmptyGoals onAdd={goalsApi.addGoal} description={t("journeyPage.goalsEmptyDescription")} />
            ) : (
              <div className="space-y-3">
                {goals.map((g, i) => {
                  const r = ratingRows.find((row) => row.goalId === g.id);
                  const nextAction = nextActionForGoal(g.id);
                  return (
                    <div key={g.id} id={`goal-${g.id}`} className="scroll-mt-4">
                      <GoalAccordion
                        goal={g}
                        milestones={milestones.filter((m) => m.goal_id === g.id)}
                        actions={allActionItems}
                        accent={{ bg: "bg-primary/15", text: "text-primary", fill: "bg-primary" }}
                        onToggle={toggleMilestone}
                        onToggleAction={toggleAction}
                        onAddMilestone={(goalId, title, target_date) => goalsApi.addMilestone({ goal_id: goalId, title, target_date })}
                        onDeleteGoal={goalsApi.deleteGoal}
                        onEditGoal={goalsApi.updateGoal}
                        onDeleteMilestone={goalsApi.deleteMilestone}
                        defaultOpen={i === 0}
                        rating={r ?? undefined}
                        onRatingChange={(patch) => saveRating(g.id, patch)}
                        startTargetLocked={isGoalLocked(g.created_at)}
                        progressPct={goalProgress.error ? null : goalProgress.progressByGoal[g.id] ?? null}
                        renderHeader={({ pct, open }) => {
                          const goalMilestones = milestones.filter((m) => m.goal_id === g.id);
                          const doneMilestones = goalMilestones.filter((m) => m.is_done).length;
                          const openActions = allActionsSummary.actions.filter((a) => a.goal_id === g.id && a.status !== "completed").length;
                          return (
                            <div
                              data-testid="goal-card"
                              className={`border p-4 transition-colors hover:border-[#8bd3e3] ${open ? "border-[#dfd8cc] bg-[#fbf8f2]" : "border-[#efeae1] bg-white"}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[8.5px] font-extrabold uppercase tracking-[.14em] text-[#2c8fa8]">
                                    {t("journeyPage.goalsAndActions.goalEyebrow")}
                                  </p>
                                  <h3 className="mt-[5px] font-serif text-[15.5px] font-normal leading-snug text-[#062f3e]">{g.title}</h3>
                                </div>
                                <span className="shrink-0 rounded-full bg-[#e8f1ec] px-2.5 py-[5px] text-[8.5px] font-extrabold uppercase tracking-[.08em] text-[#17663f]">
                                  {t(`journeyPage.goalsAndActions.status.${g.status}`, { defaultValue: g.status })}
                                </span>
                              </div>
                              <div className="mt-3 flex items-end gap-6">
                                <SmallMetric value={String(r?.start ?? "—")} label={t("journeyPage.goalsAndActions.start")} />
                                <SmallMetric value={String(r?.current ?? "—")} label={t("journeyPage.goalsAndActions.current")} color={PROFILE_COLORS.TEAL} />
                                <SmallMetric value={String(r?.target ?? "—")} label={t("journeyPage.goalsAndActions.target")} />
                                {/* canonical_goal_progress, rendered as-is */}
                                <div data-testid="goal-progress" className="ml-auto font-serif text-[20px] font-light text-[#2c8fa8]">
                                  {pct == null ? "—" : `${pct}%`}
                                </div>
                              </div>
                              <MiniProgress pct={pct ?? 0} color={PROFILE_COLORS.TEAL} />
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px]">
                                <span className="rounded-full border border-[#efeae1] bg-[#fbf8f2] px-2.5 py-1 text-[#062f3e]">
                                  {t("journeyPage.goalsAndActions.milestonesChip", { done: doneMilestones, total: goalMilestones.length })}
                                </span>
                                <span className="rounded-full border border-[#efeae1] bg-[#fbf8f2] px-2.5 py-1 text-[#062f3e]">
                                  {t("journeyPage.goalsAndActions.openActionsChip", { count: openActions })}
                                </span>
                                <span className="ml-auto font-bold text-[#2c8fa8]">
                                  {open ? t("journeyPage.goalsAndActions.hideDetail") : t("journeyPage.goalsAndActions.showDetail")}
                                </span>
                              </div>
                              {!open && (
                                <p className="mt-2.5 text-[11px] text-[#6a6560]">
                                  {nextAction
                                    ? t("journeyPage.goalsAndActions.nextAction", {
                                        text: nextAction.title,
                                        date: nextAction.due_date ? format(new Date(nextAction.due_date), "MMM d") : t("journeyPage.goalsAndActions.noDueDate"),
                                      })
                                    : t("journeyPage.goalsAndActions.noOpenActions")}
                                </p>
                              )}
                            </div>
                          );
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {allActionsSummary.error ? (
            <ProfileLoadError text={tDash("learnerProfile.errors.goals")} />
          ) : (
            allActionsSummary.total > 0 && (
              <div className="mt-5 border-t border-[#eee8de] pt-4">
                <SectionHeader title={t("journeyPage.goalsAndActions.actionsHeader")} />
                <EnrollmentActionGroups
                  summary={allActionsSummary}
                  goals={goals}
                  toggleableById={toggleableById}
                  onToggleAction={toggleAction}
                  emptyMessage={t("journeyPage.actionsEmpty")}
                />
              </div>
            )
          )}
        </ProfileSection>

        <ProfileSection>
          <ProfileSectionTitle title={t("developmentJourney.title")} />
          {developmentJourney.error ? (
            <ProfileLoadError text={tDash("learnerProfile.errors.development")} />
          ) : (
            <>
              {developmentJourney.partialFailure && <ProfileLoadError text={tDash("learnerProfile.errors.developmentPartial")} />}
              <div className="mt-1.5">
                <DevelopmentJourneyList events={developmentJourney.events} loading={developmentJourney.loading} />
              </div>
            </>
          )}
        </ProfileSection>
      </div>

      <div className="mt-4 grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
        <ProfileSection id="reflections" className="scroll-mt-4">
          <ProfileSectionTitle title={t("journeyPage.reflectionsCard.title")} aside={tDash("learnerProfile.feedback.aside")} />
          <p className="mt-1.5 text-[11.5px] text-[#9a938a]">{t("journeyPage.reflectionsCard.subtitle")}</p>

          {pendingDeliverables.length > 0 && (
            <div data-testid="pending-reflections" className="mt-4 rounded-xl border border-[#f0d5cc] bg-[#fdf6f2] p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a8541c]">
                {t("journeyPage.pendingDeliverables.title", { count: pendingDeliverables.length })}
              </div>
              <ul className="mt-2 space-y-1.5">
                {pendingDeliverables.map(({ deliverable, outstanding, path }) => (
                  <li key={`${deliverable.sourceTable}:${deliverable.sessionId}`}>
                    <Link
                      to={path}
                      className="flex items-center gap-2.5 rounded-lg border border-[#eee8de] bg-white px-3 py-2 text-[12px] transition-colors hover:border-[#8bd3e3]"
                    >
                      <PenLine className="h-3.5 w-3.5 shrink-0 text-[#2c8fa8]" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold">{t(`journeyPage.pendingReflections.type.${deliverableSessionType(deliverable.module)}`)}</span>
                        {deliverable.title && ` · ${deliverable.title}`}
                        {deliverable.startTime && <span className="text-[#9a938a]"> · {formatProfileDate(deliverable.startTime)}</span>}
                        <span className="block truncate text-[10.5px] text-[#a8541c]" data-testid="pending-deliverable-items">
                          {outstanding.map((key) => t(`journeyPage.pendingDeliverables.items.${key}`)).join(" · ")}
                        </span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#9a938a]" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div data-testid="journey-reflections" className="mt-4 space-y-2.5">
            {reflectionFeed.loading ? (
              <div className="h-24 animate-pulse rounded-xl bg-[#eee8de]/70" />
            ) : reflectionFeed.error ? (
              <ProfileLoadError text={tDash("learnerProfile.errors.reflections")} />
            ) : reflectionFeed.reflections.length === 0 ? (
              <UnavailableNote text={t("journeyPage.noReflectionsYet")} locked={false} />
            ) : (
              reflectionFeed.reflections.map((item) => (
                <ReflectionFeedItem
                  key={item.key}
                  item={item}
                  onDelete={item.sourceType === "journey_reflection" ? () => deleteReflection(item.sourceId) : undefined}
                />
              ))
            )}
          </div>

          <div className="mt-4 rounded-xl border border-[#eee8de] bg-white/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold">
              <BookOpen className="h-4 w-4 text-[#2c8fa8]" /> {t("journeyPage.newReflection")}
            </div>
            <Input
              placeholder={t("journeyPage.moodPlaceholder")}
              value={reflectionMood}
              onChange={(e) => setReflectionMood(e.target.value)}
              className="mb-2"
            />
            <Textarea
              placeholder={t("journeyPage.reflectionPlaceholder")}
              value={newReflection}
              onChange={(e) => setNewReflection(e.target.value)}
              rows={3}
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={addReflection} disabled={savingRef || !newReflection.trim()}>
                <Sparkles className="mr-1 h-4 w-4" /> {t("journeyPage.saveReflection")}
              </Button>
            </div>
          </div>
        </ProfileSection>

        <div className="flex flex-col gap-4">
          <ProfileSection id="feedback" className="scroll-mt-4">
            <ProfileSectionTitle title={t("journeyPage.feedbackCard.title")} aside={tDash("learnerProfile.feedback.aside")} />
            <p className="mt-1.5 text-[11.5px] text-[#9a938a]">{t("journeyPage.feedbackCard.subtitle")}</p>
            <div className="mt-4 space-y-2.5">
              {learnerFeedback.error ? (
                <ProfileLoadError text={tDash("learnerProfile.errors.feedback")} />
              ) : learnerFeedback.feedback.length === 0 ? (
                <UnavailableNote text={t("journeyPage.noFeedbackYet")} locked={false} />
              ) : (
                learnerFeedback.feedback.map((item) => <FeedbackItemCard key={`${item.kind}-${item.id}`} item={item} />)
              )}
            </div>
            <p className="mt-4 text-[10.5px] leading-relaxed text-[#9a938a]">{tDash("learnerProfile.feedback.privacy")}</p>
          </ProfileSection>

          <PracticeCompetencyCard enrollmentId={programme?.enrollmentId} userId={user?.id} />
        </div>
      </div>
    </div>
  );
}
