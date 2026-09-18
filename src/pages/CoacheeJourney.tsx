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
import { useCoachSummaries } from "@/hooks/journey/useCoachSummaries";
import {
  useMilestoneProgress,
  useGoalRatingRows,
  useProgrammeWeeks,
  useGoalLock,
  useSessionRatingSeries,
  usePendingReflection,
} from "@/hooks/journey/useJourneyDerived";
import type { JourneySession } from "@/hooks/journey/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Trash2, Sparkles, BookOpen, Bell } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { WheelHistory } from "@/components/tools/WheelHistory";
import { GoalWheel, GoalScoreCards } from "./journey/GoalWheel";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressRing, TimelineList } from "@/components/ui/proto";
import { ACCENTS } from "./journey/journeyDisplay";
import { SectionHeader } from "./journey/SectionHeader";
import { EmptyGoals } from "./journey/EmptyGoals";
import { GoalAccordion } from "./journey/GoalAccordion";
import { ActionGroups } from "./journey/ActionGroups";
import { SessionsBlock } from "./journey/SessionsBlock";
import { GoalDialog } from "./journey/GoalDialog";
import { CoacheeProgrammeCard } from "./journey/CoacheeProgrammeCard";
import { ProgrammeTimeline } from "./journey/ProgrammeTimeline";
import { useEnrollmentDevelopmentJourney } from "@/hooks/journey/useEnrollmentDevelopmentJourney";
import { useLearnerFeedback } from "@/hooks/dashboard/useLearnerFeedback";
import { useEnrollmentSessions } from "@/hooks/journey/useEnrollmentSessions";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { DevelopmentSessionsList } from "./journey/DevelopmentSessionsList";
import { CoacheeProgrammeHero } from "./dashboard/coachee/CoacheeProgrammeHero";
import { ProgrammeJourneyTimeline } from "@/components/journey/ProgrammeJourneyTimeline";
import { DevelopmentJourneyList } from "@/components/journey/DevelopmentJourneyList";

export default function CoacheeJourney() {
  const { t } = useTranslation("journey");
  const { user } = useAuth();
  const programmeApi = useJourneyProgramme(user?.id);
  const goalsApi = useJourneyGoals(user?.id, { enrollmentId: programmeApi.programme?.enrollmentId });
  const ratingsApi = useJourneyRatings(user?.id, programmeApi.programme?.enrollmentId);
  const sessionsApi = useJourneySessions(user?.id, { includePeer: false, enrollmentId: programmeApi.programme?.enrollmentId });
  const reflectionsApi = useJourneyReflections(user?.id, programmeApi.programme?.enrollmentId);
  const developmentJourney = useEnrollmentDevelopmentJourney(programmeApi.programme?.enrollmentId, user?.id);
  const learnerFeedback = useLearnerFeedback(user?.id, programmeApi.programme?.enrollmentId);
  const allSessions = useEnrollmentSessions(programmeApi.programme?.enrollmentId, user?.id);
  const { progress: canonicalProgress } = useLearnerCanonicalProgress(programmeApi.programme?.enrollmentId);

  const { goals, milestones, toggleMilestone } = goalsApi;
  const { ratings, sessionRatings, saveRating } = ratingsApi;
  const { coachingSessions, coachNames, toggleAction: toggleActionRaw } = sessionsApi;
  const { reflections, deleteReflection } = reflectionsApi;
  const { programme, usage } = programmeApi;

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

  const { overallPct } = useMilestoneProgress(milestones);
  const { ratingRows, avgGoalProgress } = useGoalRatingRows(goals, ratings);
  // Canonical Start→Target rating progress — the same formula and the same
  // per-goal values Sponsor's goal_progress_pct aggregates. Never the
  // milestone-completion ratio, which is a different fact (see milestones
  // list inside each goal's expanded card).
  const goalProgress = (goalId: string) => ratingRows.find((r) => r.goalId === goalId)?.progress ?? null;

  const { allActionItems, grouped, aiTotal, aiDone, aiOverdue } = useFlatActionItems(sessions);

  const now = new Date();
  const upcoming = sessions
    .filter((s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status))
    .sort((a, b) => +new Date(a.start_time) - +new Date(b.start_time));
  const past = sessions.filter((s) => new Date(s.start_time) < now || ["cancelled", "completed"].includes(s.status));

  const coachSummaries = useCoachSummaries(sessions, coachNames, now);
  const programmeWeeks = useProgrammeWeeks(programme, now);
  const sessionsCompletedCount = sessions.filter((s) => s.status === "completed").length;
  const { isGoalLocked } = useGoalLock(sessions);
  const sessionRatingSeries = useSessionRatingSeries(sessionRatings, sessions);
  const { pendingReflectionSession, needsRatingUpdate } = usePendingReflection(sessions, sessionRatings, goals.length > 0);

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

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
          className="mb-0"
          eyebrow={t("journeyPage.eyebrow")}
          title={t("journeyPage.titleLead")}
          emphasis={t("journeyPage.titleEmphasis")}
          subtitle={t("coacheeJourney.subtitle")}
          actions={
            canonicalProgress ? (
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="font-display text-2xl leading-none">{Math.round(canonicalProgress.full_completion_pct)}%</p>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("journeyPage.quickStats.completion")}
                  </p>
                </div>
                {canonicalProgress.due_adherence_pct != null && (
                  <div className="text-right">
                    <p className="font-display text-2xl leading-none text-primary">
                      {Math.round(canonicalProgress.due_adherence_pct)}%
                    </p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("journeyPage.quickStats.dueAdherence")}
                    </p>
                  </div>
                )}
              </div>
            ) : undefined
          }
        />

      <CoacheeProgrammeHero variant="journey" />

      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg">{t("programmeJourney.title")}</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("programmeJourney.subtitle")}</p>
          </div>
        </div>
        <div className="mt-4">
          <ProgrammeJourneyTimeline enrollmentId={programme?.enrollmentId} variant="full" />
        </div>
      </Card>

      <Card className="p-5" id="development-journey">
        <h2 className="font-display text-lg">{t("developmentJourney.title")}</h2>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("developmentJourney.subtitle")}</p>
        <div className="mt-4">
          <DevelopmentJourneyList events={developmentJourney.events} loading={developmentJourney.loading} />
        </div>
      </Card>

      <ProgrammeTimeline />

      {/* PROGRESS RINGS */}
      <div className="grid gap-4 sm:grid-cols-3">
         <Card className="surface-card hover-lift flex flex-col items-center gap-2 p-6">
          <ProgressRing
            value={usage?.monthly_limit ? (sessionsCompletedCount / usage.monthly_limit) * 100 : overallPct}
            tone="primary"
          />
          <p className="text-sm font-semibold">{t("coacheeJourney.progressRings.programme")}</p>
          <p className="text-xs text-muted-foreground">
            {t("coacheeJourney.progressRings.programmeSub", { completed: sessionsCompletedCount, limit: usage?.monthly_limit ?? programme?.sessionsAllowed ?? "—" })}
          </p>
        </Card>
         <Card className="surface-card hover-lift flex flex-col items-center gap-2 p-6">
          {avgGoalProgress == null ? <span aria-label="Unrated">—</span> : <ProgressRing value={avgGoalProgress} tone="warning" />}
          <p className="text-sm font-semibold">{t("coacheeJourney.progressRings.goalsOnTrack")}</p>
          <p className="text-xs text-muted-foreground">
            {t("coacheeJourney.progressRings.goalsOnTrackSub", { count: goals.filter((g) => (goalProgress(g.id) ?? 0) >= 50).length, total: goals.length })}
          </p>
        </Card>
         <Card className="surface-card hover-lift flex flex-col items-center gap-2 p-6">
          <ProgressRing value={aiTotal ? Math.round((aiDone / aiTotal) * 100) : 0} tone="success" />
          <p className="text-sm font-semibold">{t("coacheeJourney.progressRings.actionsClosed")}</p>
          <p className="text-xs text-muted-foreground">
            {t("coacheeJourney.progressRings.actionsClosedSub", { done: aiDone, total: aiTotal })}
          </p>
        </Card>
      </div>

      {/* MILESTONE TIMELINE */}
      {milestones.length > 0 && (
        <Card className="surface-card p-6">
          <p className="eyebrow mb-5">{t("coacheeJourney.milestonesEyebrow")}</p>
          <TimelineList
            items={milestones
              .slice()
              .sort((a, b) => {
                const da = a.target_date ? new Date(a.target_date).getTime() : Infinity;
                const db = b.target_date ? new Date(b.target_date).getTime() : Infinity;
                return da - db;
              })
              .slice(0, 6)
              .map((m) => ({
                id: m.id,
                date: m.target_date ? format(new Date(m.target_date), "d MMM") : undefined,
                title: m.title,
                note: goals.find((g) => g.id === m.goal_id)?.title,
                done: m.is_done,
              }))}
          />
        </Card>
      )}

      {/* PROGRAMME BLOCK */}
      <CoacheeProgrammeCard
        programme={programme}
        programmeWeeks={programmeWeeks}
        coachSummaries={coachSummaries}
        sessionsCompletedCount={sessionsCompletedCount}
        avgGoalProgress={avgGoalProgress}
      />

      <Tabs defaultValue="home">
        <TabsList>
          <TabsTrigger value="home">{t("journeyPage.tabs.overview")}</TabsTrigger>
          <TabsTrigger value="goals">{t("journeyPage.tabs.goals")}</TabsTrigger>
          <TabsTrigger value="actions">{t("journeyPage.tabs.actions", { count: aiTotal })}</TabsTrigger>
          <TabsTrigger value="sessions">{t("journeyPage.tabs.sessions", { count: sessions.length })}</TabsTrigger>
          <TabsTrigger value="reflections">{t("journeyPage.tabs.reflections", { count: reflections.length })}</TabsTrigger>
          <TabsTrigger value="feedback">{t("journeyPage.tabs.feedback", { count: learnerFeedback.feedback.length })}</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="home" className="mt-4 space-y-6">
          {/* Update prompt banner after a completed session */}
          {needsRatingUpdate && pendingReflectionSession && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm">
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="flex-1">
                <p className="font-semibold text-primary">
                  {t("journeyPage.reflectionBanner.title")}
                </p>
                <p className="text-xs text-primary/80">
                  {t("journeyPage.reflectionBanner.openPrefix")} <Link to={`/sessions/${pendingReflectionSession.id}`} className="font-semibold underline">{pendingReflectionSession.topic}</Link> {t("journeyPage.reflectionBanner.afterLinkPrefix")}{format(new Date(pendingReflectionSession.start_time), "MMM d")}{t("journeyPage.reflectionBanner.afterLinkSuffix")}
                </p>
              </div>
            </div>
          )}

          {/* Goal wheel + score cards */}
          {goals.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              <GoalWheel rows={ratingRows} sessionSeries={sessionRatingSeries} />
              <GoalScoreCards rows={ratingRows} />
            </div>
          )}

          <WheelHistory coacheeId={user?.id} />

          <SectionHeader
            title="Goals & milestones"
            action={goals.length > 0 ? <GoalDialog onAdd={goalsApi.addGoal} /> : undefined}
          />
          {goals.length === 0 ? (
            <EmptyGoals
              onAdd={goalsApi.addGoal}
              description="Define what you want to achieve and your coach can attach action items to milestones."
            />
          ) : (
            <div className="space-y-2">
              {goals.map((g, i) => (
                <GoalAccordion
                  key={g.id}
                  goal={g}
                  milestones={milestones.filter((m) => m.goal_id === g.id)}
                  actions={allActionItems}
                  accent={ACCENTS[i % ACCENTS.length]}
                  onToggle={toggleMilestone}
                  onToggleAction={toggleAction}
                  onAddMilestone={(goalId, title, target_date) => goalsApi.addMilestone({ goal_id: goalId, title, target_date })}
                  onDeleteGoal={goalsApi.deleteGoal}
                  onDeleteMilestone={goalsApi.deleteMilestone}
                  defaultOpen={i === 0}
                  rating={ratingRows.find((r) => r.goalId === g.id)}
                  onRatingChange={(patch) => saveRating(g.id, patch)}
                  startTargetLocked={isGoalLocked(g.created_at)}
                />
              ))}
            </div>
          )}

          <SectionHeader title="Action items" />
          <ActionGroups
            grouped={grouped}
            compact
            onToggleAction={toggleAction}
            emptyMessage="No action items yet. They'll appear here once your coach assigns them."
          />
        </TabsContent>

        {/* GOALS FULL */}
        <TabsContent value="goals" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <GoalDialog onAdd={goalsApi.addGoal} />
          </div>
          {goals.length === 0 ? (
            <EmptyGoals
              onAdd={goalsApi.addGoal}
              description="Define what you want to achieve and your coach can attach action items to milestones."
            />
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                {goals.map((g, i) => {
                  const ac = ACCENTS[i % ACCENTS.length];
                  const pct = goalProgress(g.id);
                  return (
                    <Card key={g.id} className="p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {g.title}
                      </p>
                      <p className="mt-1 text-2xl font-semibold">{pct == null ? "—" : `${pct}%`}</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full", ac.fill)} style={{ width: `${pct ?? 0}%` }} />
                      </div>
                    </Card>
                  );
                })}
              </div>
              <div className="space-y-2">
                {goals.map((g, i) => (
                  <GoalAccordion
                    key={g.id}
                    goal={g}
                    milestones={milestones.filter((m) => m.goal_id === g.id)}
                    actions={allActionItems}
                    accent={ACCENTS[i % ACCENTS.length]}
                    onToggle={toggleMilestone}
                    onToggleAction={toggleAction}
                    onAddMilestone={(goalId, title, target_date) => goalsApi.addMilestone({ goal_id: goalId, title, target_date })}
                    onDeleteGoal={goalsApi.deleteGoal}
                    onDeleteMilestone={goalsApi.deleteMilestone}
                    showLinkedActions
                    defaultOpen={i === 0}
                    rating={ratingRows.find((r) => r.goalId === g.id)}
                    onRatingChange={(patch) => saveRating(g.id, patch)}
                    startTargetLocked={isGoalLocked(g.created_at)}
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ACTION ITEMS */}
        <TabsContent value="actions" className="mt-4">
          <p className="mb-3 text-xs text-muted-foreground">
            {aiTotal} total · {aiDone} done · {aiOverdue} overdue
          </p>
          <ActionGroups
            grouped={grouped}
            milestones={milestones}
            goals={goals}
            onToggleAction={toggleAction}
            emptyMessage="No action items yet. They'll appear here once your coach assigns them."
          />
        </TabsContent>

        {/* SESSIONS */}
        <TabsContent value="sessions" className="mt-4 space-y-6">
          <SessionsBlock title="Upcoming" items={upcoming} coachNames={coachNames} />
          <SessionsBlock title="Completed" items={past} milestones={milestones} goals={goals} expandable onToggleAction={toggleAction} coachNames={coachNames} />

          <div>
            <SectionHeader title={t("developmentSessions.allSessionsHeader")} />
            <DevelopmentSessionsList
              sessions={allSessions.sessions}
              loading={allSessions.loading}
              programmeName={programmeApi.programme?.programmeName}
              cohortName={programmeApi.programme?.cohortName}
            />
          </div>
        </TabsContent>

        {/* REFLECTIONS */}
        <TabsContent value="reflections" className="mt-4 space-y-4">
          {developmentJourney.events.filter((e) => e.type === "reflection" && e.subtype !== "private_reflection").length > 0 && (
            <div className="space-y-2">
              {developmentJourney.events
                .filter((e) => e.type === "reflection" && e.subtype !== "private_reflection")
                .map((e) => (
                  <Card key={e.id} className="p-4">
                    <span className="inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                      {t(`developmentJourney.reflectionTypes.${e.subtype}`)}
                    </span>
                    {e.summary && <p className="mt-2 whitespace-pre-wrap text-sm">{e.summary}</p>}
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {format(new Date(e.occurredAt), "EEE, MMM d, yyyy")}
                    </p>
                  </Card>
                ))}
            </div>
          )}

          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-primary" /> {t("journeyPage.newReflection")}
              <span className="ml-auto inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("developmentJourney.reflectionTypes.private_reflection")}
              </span>
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
              rows={4}
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={addReflection} disabled={savingRef || !newReflection.trim()}>
                <Sparkles className="mr-1 h-4 w-4" /> {t("journeyPage.saveReflection")}
              </Button>
            </div>
          </Card>

          {reflections.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">{t("journeyPage.noReflectionsYet")}</p>
          ) : (
            reflections.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    {r.mood && (
                      <span className="mb-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                        {r.mood}
                      </span>
                    )}
                    <p className="whitespace-pre-wrap text-sm">{r.body}</p>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {format(new Date(r.created_at), "EEE, MMM d, yyyy · p")}
                    </p>
                  </div>
                  <button onClick={() => deleteReflection(r.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        {/* FEEDBACK */}
        <TabsContent value="feedback" className="mt-4 space-y-3">
          {learnerFeedback.feedback.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              No learner-visible feedback yet.
            </p>
          ) : (
            learnerFeedback.feedback.map((item) => (
              <Card key={`${item.kind}-${item.id}`} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                    {t(`developmentJourney.feedbackTypes.${item.kind}`)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{format(new Date(item.submittedAt), "MMM d, yyyy")}</span>
                </div>
                <p className="mt-2 text-sm font-semibold">{item.fromName ?? "Someone"}</p>
                {item.kind === "mentoring" && item.overallNotes && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.overallNotes}</p>
                )}
                {item.kind === "peer_competency" && item.note && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.note}</p>
                )}
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
