import { useMemo, useState } from "react";
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
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Sparkles, BookOpen } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "./journey/SectionHeader";
import { EmptyGoals } from "./journey/EmptyGoals";
import { GoalAccordion } from "./journey/GoalAccordion";
import { GoalDialog } from "./journey/GoalDialog";
import { EnrollmentActionGroups } from "./journey/EnrollmentActionGroups";
import { PracticeCompetencyCard } from "./journey/PracticeCompetencyCard";
import { useEnrollmentDevelopmentJourney } from "@/hooks/journey/useEnrollmentDevelopmentJourney";
import { useLearnerFeedback } from "@/hooks/dashboard/useLearnerFeedback";
import { ProgrammeJourneyTimeline } from "@/components/journey/ProgrammeJourneyTimeline";
import { DevelopmentJourneyList } from "@/components/journey/DevelopmentJourneyList";

/** A start/current/target numeral, as the approved prototype's goal card shows it. */
function GoalStat({ value, label, tone }: { value: number | string; label: string; tone?: "primary" }) {
  return (
    <div>
      <p className={`font-display text-lg leading-none ${tone === "primary" ? "text-primary" : ""}`}>{value}</p>
      <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
    </div>
  );
}

export default function CoacheeJourney() {
  const { t } = useTranslation("journey");
  const { t: tDash } = useTranslation("dashboard");
  const { user } = useAuth();
  const programmeApi = useJourneyProgramme(user?.id);
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
  const ratingRows = useMemo(
    () =>
      goals.map((g) => {
        const r = ratings[g.id];
        return { goalId: g.id, start: r?.start_rating ?? null, current: r?.current_rating ?? null, target: r?.target_rating ?? null };
      }),
    [goals, ratings]
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("coacheeJourney.eyebrow")}
        title={t("coacheeJourney.title")}
        trailing=""
        subtitle={t("coacheeJourney.subtitle")}
      />

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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-display text-lg">{t("developmentJourney.title")}</h2>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("developmentJourney.subtitle")}</p>
          <div className="mt-4">
            <DevelopmentJourneyList events={developmentJourney.events} loading={developmentJourney.loading} />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg">{t("journeyPage.goalsAndActions.title")}</h2>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {t("journeyPage.goalsAndActions.subtitle", { count: goals.length })}
              </p>
            </div>
            {goals.length > 0 && <GoalDialog onAdd={goalsApi.addGoal} />}
          </div>

          <div className="mt-4">
            {goals.length === 0 ? (
              <EmptyGoals onAdd={goalsApi.addGoal} description={t("journeyPage.goalsEmptyDescription")} />
            ) : (
              <div className="space-y-3">
                {goals.map((g, i) => {
                  const r = ratingRows.find((row) => row.goalId === g.id);
                  const nextAction = nextActionForGoal(g.id);
                  return (
                    <GoalAccordion
                      key={g.id}
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
                        <div className="rounded-[13px] border border-border bg-card p-4 transition-colors hover:border-primary/30">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[8.5px] font-bold uppercase tracking-[.14em] text-primary">
                                {t("journeyPage.goalsAndActions.goalEyebrow")}
                              </p>
                              <h3 className="font-display mt-1 truncate text-[15.5px] font-normal leading-snug">{g.title}</h3>
                            </div>
                            <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-1 text-[8.5px] font-bold uppercase tracking-widest text-primary">
                              {t(`journeyPage.goalsAndActions.status.${g.status}`, { defaultValue: g.status })}
                            </span>
                          </div>
                          <div className="mt-3 flex gap-5">
                            <GoalStat value={r?.start ?? "—"} label={t("journeyPage.goalsAndActions.start")} />
                            <GoalStat value={r?.current ?? "—"} label={t("journeyPage.goalsAndActions.current")} tone="primary" />
                            <GoalStat value={r?.target ?? "—"} label={t("journeyPage.goalsAndActions.target")} />
                          </div>
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${pct ?? 0}%` }} />
                          </div>
                          <p className="mt-2.5 text-[11px] text-muted-foreground">
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
                  );
                })}
              </div>
            )}
          </div>

          {allActionsSummary.total > 0 && (
            <div className="mt-5">
              <SectionHeader title={t("journeyPage.goalsAndActions.actionsHeader")} />
              <EnrollmentActionGroups
                summary={allActionsSummary}
                goals={goals}
                toggleableById={toggleableById}
                onToggleAction={toggleAction}
                emptyMessage={t("journeyPage.actionsEmpty")}
              />
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-display text-lg">{t("journeyPage.reflectionsCard.title")}</h2>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("journeyPage.reflectionsCard.subtitle")}</p>

          <div className="mt-4 space-y-2.5">
            {allReflectionRows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {t("journeyPage.noReflectionsYet")}
              </p>
            ) : (
              allReflectionRows.map((r) => (
                <div key={r.id} className="rounded-[13px] border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                      {t(`developmentJourney.reflectionTypes.${r.subtype}`)}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{format(new Date(r.date), "MMM d, yyyy")}</span>
                  </div>
                  {r.quote && <p className="mt-2.5 whitespace-pre-wrap font-display text-[13.5px] leading-relaxed">{r.quote}</p>}
                  {r.subtype === "private_reflection" && (
                    <button onClick={() => deleteReflection(r.id)} className="mt-2 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="mt-4 rounded-[13px] border border-border bg-muted/20 p-4">
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
              rows={3}
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={addReflection} disabled={savingRef || !newReflection.trim()}>
                <Sparkles className="mr-1 h-4 w-4" /> {t("journeyPage.saveReflection")}
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-display text-lg">{t("journeyPage.feedbackCard.title")}</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("journeyPage.feedbackCard.subtitle")}</p>
            <div className="mt-4 space-y-2.5">
              {learnerFeedback.feedback.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  {t("journeyPage.noFeedbackYet")}
                </p>
              ) : (
                learnerFeedback.feedback.map((item) => (
                  <div key={`${item.kind}-${item.id}`} className="rounded-[13px] border border-border bg-card p-4">
                    <span className="inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                      {t(`developmentJourney.feedbackTypes.${item.kind}`)}
                    </span>
                    <h3 className="font-display mt-1.5 text-[15px]">{item.fromName ?? t("journeyPage.unknownFeedbackAuthor")}</h3>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{format(new Date(item.submittedAt), "MMM d, yyyy")}</p>

                    {item.kind === "peer_competency" && item.scores.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.scores.map((s) => (
                          <div key={s.key} className="rounded-[10px] border border-border bg-muted/30 px-2.5 py-1.5">
                            <p className="font-display text-sm text-primary">{s.score}</p>
                            <p className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                              {tDash(`practiceJourney.competencies.${s.key}`)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {item.kind === "mentoring" && item.overallNotes && (
                      <p className="mt-2.5 whitespace-pre-wrap font-display text-[13.5px] leading-relaxed">{item.overallNotes}</p>
                    )}
                    {item.kind === "peer_competency" && item.note && (
                      <p className="mt-2.5 whitespace-pre-wrap font-display text-[13.5px] leading-relaxed">{item.note}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

          <PracticeCompetencyCard enrollmentId={programme?.enrollmentId} userId={user?.id} />
        </div>
      </div>
    </div>
  );
}
