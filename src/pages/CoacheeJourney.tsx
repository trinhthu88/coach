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
import { useGoalLock, useGoalRatingRows } from "@/hooks/journey/useJourneyDerived";
import type { JourneySession } from "@/hooks/journey/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Sparkles, BookOpen } from "lucide-react";
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
import { ProgrammeProfileHeader } from "@/components/programme/ProgrammeProfileHeader";
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
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { useHashScroll } from "@/hooks/useHashScroll";
import { formatProfileDate } from "@/lib/programmeProfile";
import { STATUS_LABEL_KEY, STATUS_TONE, effectiveSponsorStatus } from "@/pages/sponsor/sponsorUtils";
import { DevelopmentJourneyList } from "@/components/journey/DevelopmentJourneyList";

export default function CoacheeJourney() {
  const { t } = useTranslation("journey");
  const { t: tDash } = useTranslation("dashboard");
  const { t: tSponsor } = useTranslation("sponsor");
  const { user, profile } = useAuth();
  const programmeApi = useJourneyProgramme(user?.id);
  const canonical = useLearnerCanonicalProgress(programmeApi.programme?.enrollmentId);
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
  const { ratings, saveRating } = ratingsApi;
  const { coachingSessions, toggleAction: toggleActionRaw } = sessionsApi;
  const { reflections, deleteReflection } = reflectionsApi;
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

  // Canonical Start→Target rating progress — the same formula and the same
  // per-goal values Sponsor's goal_progress_pct aggregates. Never the
  // milestone-completion ratio, which is a different fact (see milestones
  // list inside each goal's expanded card).
  const { ratingRows } = useGoalRatingRows(goals, ratings);

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

  const canonicalReflections = developmentJourney.events
    .filter((e) => e.type === "reflection" && e.subtype !== "private_reflection")
    .map((e) => ({ id: e.id, subtype: e.subtype, date: e.occurredAt, quote: e.summary }));
  const privateReflectionRows = reflections.map((r) => ({
    id: r.id,
    subtype: "private_reflection",
    date: r.created_at,
    quote: r.body,
  }));
  const allReflectionRows = [...canonicalReflections, ...privateReflectionRows].sort(
    (a, b) => +new Date(b.date) - +new Date(a.date)
  );
  const status = canonical.progress ? effectiveSponsorStatus(canonical.progress) : null;

  return (
    <div className="pb-4" style={{ color: PROFILE_COLORS.NAVY }}>
      <ProgrammeProfileHeader
        name={canonical.progress?.learner_display_name || profile?.full_name || ""}
        eyebrow={t("coacheeJourney.title")}
        subtitle={
          canonical.progress
            ? `${canonical.progress.programme_label} · ${canonical.progress.cohort_label || "—"}`
            : t("coacheeJourney.subtitle")
        }
        metas={
          canonical.progress && status
            ? [
                { label: tDash("learnerProfile.header.programmeStatus"), value: tSponsor(`status.${STATUS_LABEL_KEY[status]}`) },
                {
                  label: tSponsor("leaderDrawer.reference.dates"),
                  value: `${formatProfileDate(canonical.progress.enrollment_start_date)} – ${formatProfileDate(canonical.progress.enrollment_end_date)}`,
                },
              ]
            : []
        }
        status={status ? { tone: STATUS_TONE[status], label: tSponsor(`status.${STATUS_LABEL_KEY[status]}`) } : null}
        trailing={
          <Link to="/dashboard" className="rounded-full border border-white/25 px-3.5 py-1.5 text-[11px] font-semibold text-white hover:bg-white/10">
            {tDash("learnerProfile.journeyPage.backToDashboard")}
          </Link>
        }
      />

      {/* The same shared Programme Journey the Dashboard and Sponsor Leader
          Detail render — full variant: every checkpoint plus detail. */}
      <LearnerProgrammeJourney id="programme-journey" enrollmentId={programme?.enrollmentId} variant="full" />

      <div className="mt-4 grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
        <ProfileSection id="goals" className="scroll-mt-4">
          <ProfileSectionTitle
            title={t("journeyPage.goalsAndActions.title")}
            aside={goals.length > 0 ? <GoalDialog onAdd={goalsApi.addGoal} /> : undefined}
          />
          <p className="mt-1.5 text-[11.5px] text-[#9a938a]">{t("journeyPage.goalsAndActions.subtitle", { count: goals.length })}</p>

          <div className="mt-4">
            {goalsApi.error || ratingsApi.error ? (
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
                        onDeleteMilestone={goalsApi.deleteMilestone}
                        defaultOpen={i === 0}
                        rating={r ?? undefined}
                        onRatingChange={(patch) => saveRating(g.id, patch)}
                        startTargetLocked={isGoalLocked(g.created_at)}
                        renderHeader={({ pct }) => (
                          <div className="rounded-xl border border-[#eee8de] bg-[#f6f3ee] p-4 transition-colors hover:border-[#8bd3e3]">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#2c8fa8]">
                                  {t("journeyPage.goalsAndActions.goalEyebrow")}
                                </p>
                                <h3 className="mt-1 truncate font-serif text-[15.5px] font-normal leading-snug">{g.title}</h3>
                              </div>
                              <span className="shrink-0 rounded-full bg-[#e4f3f7] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.12em] text-[#2c8fa8]">
                                {t(`journeyPage.goalsAndActions.status.${g.status}`, { defaultValue: g.status })}
                              </span>
                            </div>
                            <div className="mt-3 flex gap-6">
                              <SmallMetric value={String(r?.start ?? "—")} label={t("journeyPage.goalsAndActions.start")} />
                              <SmallMetric value={String(r?.current ?? "—")} label={t("journeyPage.goalsAndActions.current")} color={PROFILE_COLORS.TEAL} />
                              <SmallMetric value={String(r?.target ?? "—")} label={t("journeyPage.goalsAndActions.target")} />
                            </div>
                            <MiniProgress pct={pct ?? 0} color={PROFILE_COLORS.TEAL} />
                            <p className="mt-2.5 text-[11px] text-[#6a6560]">
                              {nextAction
                                ? t("journeyPage.goalsAndActions.nextAction", {
                                    text: nextAction.title,
                                    date: nextAction.due_date ? format(new Date(nextAction.due_date), "MMM d") : t("journeyPage.goalsAndActions.noDueDate"),
                                  })
                                : t("journeyPage.goalsAndActions.noOpenActions")}
                            </p>
                          </div>
                        )}
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
          <p className="mt-1.5 text-[11.5px] text-[#9a938a]">{t("developmentJourney.subtitle")}</p>
          {developmentJourney.error ? (
            <ProfileLoadError text={tDash("learnerProfile.errors.development")} />
          ) : (
            <>
              {developmentJourney.partialFailure && <ProfileLoadError text={tDash("learnerProfile.errors.developmentPartial")} />}
              <div className="mt-4">
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

          <div className="mt-4 space-y-2.5">
            {allReflectionRows.length === 0 ? (
              <UnavailableNote text={t("journeyPage.noReflectionsYet")} locked={false} />
            ) : (
              allReflectionRows.map((r) => (
                <div key={r.id} className="rounded-xl border border-[#eee8de] bg-[#f6f3ee] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full bg-[#e4f3f7] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.12em] text-[#2c8fa8]">
                      {t(`developmentJourney.reflectionTypes.${r.subtype}`)}
                    </span>
                    <span className="shrink-0 text-[10px] text-[#9a938a]">{formatProfileDate(r.date)}</span>
                  </div>
                  {r.quote && <p className="mt-2.5 whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed">{r.quote}</p>}
                  {r.subtype === "private_reflection" && (
                    <button
                      onClick={() => deleteReflection(r.id)}
                      aria-label={t("journeyPage.deleteReflection", { defaultValue: "Delete reflection" })}
                      className="mt-2 text-[#9a938a] hover:text-[#a8341c]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
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
