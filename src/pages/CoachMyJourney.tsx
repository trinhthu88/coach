import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Trash2, Sparkles, BookOpen, Bell, Check } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { GoalWheel, GoalScoreCards } from "./journey/GoalWheel";
import { PageHeader } from "@/components/ui/page-header";
import { ACCENTS } from "./journey/journeyDisplay";
import { SectionHeader } from "./journey/SectionHeader";
import { EmptyGoals } from "./journey/EmptyGoals";
import { GoalAccordion } from "./journey/GoalAccordion";
import { ActionGroups } from "./journey/ActionGroups";
import { SessionsBlock } from "./journey/SessionsBlock";
import { GoalDialog } from "./journey/GoalDialog";
import { CoachProgrammeCard } from "./journey/CoachProgrammeCard";

function Metric({
  label,
  value,
  sub,
  subClass,
}: { label: string; value: string; sub?: string; subClass?: string }) {
  return (
    <div className="surface-card hover-lift p-4">
      <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="font-display mt-2 text-[2rem] font-normal leading-none tracking-tight">{value}</p>
      {sub && <p className={cn("mt-2 text-[11px] text-muted-foreground", subClass)}>{sub}</p>}
    </div>
  );
}

export default function CoachMyJourney() {
  const { t } = useTranslation("journey");
  const { user } = useAuth();
  const goalsApi = useJourneyGoals(user?.id);
  const ratingsApi = useJourneyRatings(user?.id);
  const sessionsApi = useJourneySessions(user?.id, { includePeer: true });
  const reflectionsApi = useJourneyReflections(user?.id);
  const programmeApi = useJourneyProgramme(user?.id);

  const { goals, milestones, toggleMilestone } = goalsApi;
  const { ratings, sessionRatings, saveRating } = ratingsApi;
  const { coachingSessions, peerSessions, coachNames, toggleAction: toggleActionRaw } = sessionsApi;
  const { reflections, deleteReflection } = reflectionsApi;
  const { programme, usage } = programmeApi;

  const loading =
    goalsApi.loading || ratingsApi.loading || sessionsApi.loading || reflectionsApi.loading || programmeApi.loading;

  const [newReflection, setNewReflection] = useState("");
  const [reflectionMood, setReflectionMood] = useState("");
  const [savingRef, setSavingRef] = useState(false);

  // Unified sessions list (each carries _source / _otherCoachId)
  const sessions = useMemo<JourneySession[]>(() => [
    ...coachingSessions.map((s) => ({ ...s, _source: "coaching" as const, _otherCoachId: s.coach_id })),
    ...peerSessions.map((s) => ({ ...s, _source: "peer" as const, _otherCoachId: s.peer_coach_id })),
  ], [coachingSessions, peerSessions]);

  const { allActionItems, grouped, aiTotal, aiDone, aiOverdue } = useFlatActionItems(sessions);

  const { overallPct } = useMilestoneProgress(milestones);
  const goalProgress = (goalId: string) => {
    const ms = milestones.filter((m) => m.goal_id === goalId);
    if (!ms.length) return 0;
    return Math.round((ms.filter((m) => m.is_done).length / ms.length) * 100);
  };

  const now = new Date();
  const upcoming = sessions
    .filter((s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status))
    .sort((a, b) => +new Date(a.start_time) - +new Date(b.start_time));
  const past = sessions
    .filter((s) => new Date(s.start_time) < now || ["cancelled", "completed"].includes(s.status))
    .sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time));

  const nextSession = upcoming[0];

  const coachSummaries = useCoachSummaries(sessions, coachNames, now);

  const { ratingRows, avgGoalProgress } = useGoalRatingRows(goals, ratings);
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

  const toggleAction = (a: FlatAction) => toggleActionRaw(a.sessionId, a.idx, a.source);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
          className="mb-0"
          eyebrow={t("journeyPage.eyebrow")}
          title={t("journeyPage.titleLead")}
          emphasis={t("journeyPage.titleEmphasis")}
          subtitle={t("coachMyJourney.subtitle")}
          actions={
            <Badge variant="outline" className="border-accent/40 bg-accent/10 text-accent">
              {t("coachMyJourney.modeBadge")}
            </Badge>
          }
        />

      {/* METRICS */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label={t("coachMyJourney.metrics.overallProgress")} value={`${overallPct}%`} sub={t("coachMyJourney.metrics.overallProgressSub", { count: goals.length })} />
        <Metric label={t("coachMyJourney.metrics.actionsDone")} value={String(aiDone)} sub={aiOverdue ? t("coachMyJourney.metrics.actionsDoneSubOverdue", { count: aiOverdue }) : t("coachMyJourney.metrics.actionsDoneSubTotal", { count: aiTotal })} subClass={aiOverdue ? "text-destructive" : ""} />
        <Metric
          label={t("coachMyJourney.metrics.sessionsReceived")}
          value={
            usage
              ? `${sessions.filter((s) => s.status === "completed").length} / ${usage.monthly_limit}`
              : `${sessions.filter((s) => s.status === "completed").length}`
          }
          sub={t("coachMyJourney.metrics.sessionsReceivedSub", { count: upcoming.length })}
        />
        <Metric
          label={t("coachMyJourney.metrics.nextSession")}
          value={nextSession ? format(new Date(nextSession.start_time), "MMM d") : "—"}
          sub={nextSession ? format(new Date(nextSession.start_time), "p") : t("coachMyJourney.metrics.nothingScheduled")}
        />
      </div>

      {/* PROGRAMME BLOCK */}
      <CoachProgrammeCard
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
        </TabsList>

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

          <SectionHeader
            title={t("journeyPage.tabs.goals")}
            action={goals.length > 0 ? <GoalDialog onAdd={goalsApi.addGoal} /> : undefined}
          />
          {goals.length === 0 ? (
            <EmptyGoals onAdd={goalsApi.addGoal} description={t("coachMyJourney.emptyGoalsDescription")} />
          ) : (
            <div className="space-y-2">
              {goals.map((g, i) => (
                <GoalAccordion
                  key={g.id}
                  goal={g}
                  milestones={milestones.filter((m) => m.goal_id === g.id)}
                  actions={allActionItems}
                  pct={goalProgress(g.id)}
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
                  showCompletionMarks
                />
              ))}
            </div>
          )}

          <SectionHeader title={t("journeyPage.actionItemsHeader")} />
          <ActionGroups
            grouped={grouped}
            compact
            onToggleAction={toggleAction}
            showSourceBadge
            emptyMessage={t("coachMyJourney.actionsEmptyMessage")}
          />
        </TabsContent>

        <TabsContent value="goals" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <GoalDialog onAdd={goalsApi.addGoal} />
          </div>
          {goals.length === 0 ? (
            <EmptyGoals onAdd={goalsApi.addGoal} description={t("coachMyJourney.emptyGoalsDescription")} />
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                {goals.map((g, i) => {
                  const ac = ACCENTS[i % ACCENTS.length];
                  const pct = goalProgress(g.id);
                  const goalDone = pct === 100 && milestones.filter((m) => m.goal_id === g.id).length > 0;
                  return (
                    <Card key={g.id} className="p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1">
                        {goalDone && <Check className="h-3 w-3 text-success" strokeWidth={3} />}
                        {g.title}
                      </p>
                      <p className="mt-1 text-2xl font-semibold">{pct}%</p>
                      {g.target_date && (
                        <p className="text-[10px] text-muted-foreground">{t("goalAccordion.targetOn", { date: format(new Date(g.target_date), "MMM d, yyyy") })}</p>
                      )}
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full", ac.fill)} style={{ width: `${pct}%` }} />
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
                    pct={goalProgress(g.id)}
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
                    showCompletionMarks
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="actions" className="mt-4">
          <p className="mb-3 text-xs text-muted-foreground">
            {t("journeyPage.actionsSummary", { total: aiTotal, done: aiDone, overdue: aiOverdue })}
          </p>
          <ActionGroups
            grouped={grouped}
            milestones={milestones}
            goals={goals}
            onToggleAction={toggleAction}
            showSourceBadge
            emptyMessage={t("coachMyJourney.actionsEmptyMessage")}
          />
        </TabsContent>

        <TabsContent value="sessions" className="mt-4 space-y-4">
          <SessionsBlock title={t("coachMyJourney.sessionsBlockUpcoming")} items={upcoming} coachNames={coachNames} showSourceBadge />
          <SessionsBlock title={t("coachMyJourney.sessionsBlockPast")} items={past} milestones={milestones} goals={goals} expandable onToggleAction={toggleAction} coachNames={coachNames} showSourceBadge />
        </TabsContent>

        <TabsContent value="reflections" className="mt-4 space-y-4">
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-primary" /> {t("journeyPage.newReflection")}
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
      </Tabs>
    </div>
  );
}
