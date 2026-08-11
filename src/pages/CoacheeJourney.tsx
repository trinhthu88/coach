import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Trash2, Sparkles, BookOpen, Bell } from "lucide-react";
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

export default function CoacheeJourney() {
  const { user } = useAuth();
  const goalsApi = useJourneyGoals(user?.id);
  const ratingsApi = useJourneyRatings(user?.id);
  const sessionsApi = useJourneySessions(user?.id, { includePeer: false });
  const reflectionsApi = useJourneyReflections(user?.id);
  const programmeApi = useJourneyProgramme(user?.id);

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
  const goalProgress = (goalId: string) => {
    const ms = milestones.filter((m) => m.goal_id === goalId);
    if (!ms.length) return 0;
    return Math.round((ms.filter((m) => m.is_done).length / ms.length) * 100);
  };

  const { allActionItems, grouped, aiTotal, aiDone, aiOverdue } = useFlatActionItems(sessions);

  const now = new Date();
  const upcoming = sessions
    .filter((s) => new Date(s.start_time) >= now && !["cancelled", "completed"].includes(s.status))
    .sort((a, b) => +new Date(a.start_time) - +new Date(b.start_time));
  const past = sessions.filter((s) => new Date(s.start_time) < now || ["cancelled", "completed"].includes(s.status));

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

  const toggleAction = (a: FlatAction) => toggleActionRaw(a.sessionId, a.idx, "coaching");

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
          eyebrow="Progress"
          title="My"
          emphasis="journey"
          subtitle="Track your goals, action items, sessions and personal reflections."
        />

      {/* PROGRESS RINGS */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="flex flex-col items-center gap-2 p-6">
          <ProgressRing
            value={usage?.monthly_limit ? (sessionsCompletedCount / usage.monthly_limit) * 100 : overallPct}
            tone="primary"
          />
          <p className="text-sm font-semibold">Programme</p>
          <p className="text-xs text-muted-foreground">
            {sessionsCompletedCount} of {usage?.monthly_limit ?? programme?.sessionsAllowed ?? "—"} sessions
          </p>
        </Card>
        <Card className="flex flex-col items-center gap-2 p-6">
          <ProgressRing value={avgGoalProgress} tone="warning" />
          <p className="text-sm font-semibold">Goals on track</p>
          <p className="text-xs text-muted-foreground">
            {goals.filter((g) => goalProgress(g.id) >= 50).length} of {goals.length} advancing
          </p>
        </Card>
        <Card className="flex flex-col items-center gap-2 p-6">
          <ProgressRing value={aiTotal ? Math.round((aiDone / aiTotal) * 100) : 0} tone="success" />
          <p className="text-sm font-semibold">Actions closed</p>
          <p className="text-xs text-muted-foreground">
            {aiDone} of {aiTotal} completed
          </p>
        </Card>
      </div>

      {/* MILESTONE TIMELINE */}
      {milestones.length > 0 && (
        <Card className="p-6">
          <p className="eyebrow mb-5">Milestones</p>
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
          <TabsTrigger value="home">Overview</TabsTrigger>
          <TabsTrigger value="goals">Goals & milestones</TabsTrigger>
          <TabsTrigger value="actions">Action items ({aiTotal})</TabsTrigger>
          <TabsTrigger value="sessions">Sessions ({sessions.length})</TabsTrigger>
          <TabsTrigger value="reflections">Reflections ({reflections.length})</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="home" className="mt-4 space-y-6">
          {/* Update prompt banner after a completed session */}
          {needsRatingUpdate && pendingReflectionSession && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm">
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="flex-1">
                <p className="font-semibold text-primary">
                  Reflection time — rate your goals after this session
                </p>
                <p className="text-xs text-primary/80">
                  Open <Link to={`/sessions/${pendingReflectionSession.id}`} className="font-semibold underline">{pendingReflectionSession.topic}</Link> ({format(new Date(pendingReflectionSession.start_time), "MMM d")}) to log a 0–100 self-rating per goal. Each reflection becomes a new layer on the wheel.
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
                      <p className="mt-1 text-2xl font-semibold">{pct}%</p>
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
        <TabsContent value="sessions" className="mt-4 space-y-4">
          <SessionsBlock title="Upcoming" items={upcoming} coachNames={coachNames} />
          <SessionsBlock title="Completed" items={past} milestones={milestones} goals={goals} expandable onToggleAction={toggleAction} coachNames={coachNames} />
        </TabsContent>

        {/* REFLECTIONS */}
        <TabsContent value="reflections" className="mt-4 space-y-4">
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-primary" /> New reflection
            </div>
            <Input
              placeholder="Mood (optional, e.g. focused, stuck, proud)…"
              value={reflectionMood}
              onChange={(e) => setReflectionMood(e.target.value)}
              className="mb-2"
            />
            <Textarea
              placeholder="What's on your mind? Wins, blockers, insights…"
              value={newReflection}
              onChange={(e) => setNewReflection(e.target.value)}
              rows={4}
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={addReflection} disabled={savingRef || !newReflection.trim()}>
                <Sparkles className="mr-1 h-4 w-4" /> Save reflection
              </Button>
            </div>
          </Card>

          {reflections.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">Your private reflections will appear here.</p>
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
