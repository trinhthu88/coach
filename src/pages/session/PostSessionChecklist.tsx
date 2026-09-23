import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Circle, Loader2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { actionDueStatus } from "@/lib/actionScheduling";
import {
  DELIVERABLE_SOURCE_TYPES,
  deliverableItems,
  type SessionSourceTable,
} from "@/lib/postSessionDeliverables";
import {
  useAddSessionFollowUpAction,
  useInvalidateDeliverables,
  useSessionCounterpartDeliverables,
  useSessionDeliverables,
  useSessionFollowUpActions,
  useSessionReflection,
  useSubmitSessionReflection,
  useSubmitSessionSatisfaction,
  type CounterpartDeliverable,
  type SessionParticipantDeliverable,
} from "@/hooks/sessions/usePostSessionDeliverables";
import { SessionGoalRatings } from "./SessionGoalRatings";

/**
 * The one post-session checklist, for every module.
 *
 * A held session is complete as a session the moment its lifecycle says so;
 * what the learner still owes afterwards is a separate fact, read for every
 * tick from session_deliverables() -> canonical_session_deliverable_state().
 * Nothing here infers a tick from what is on screen.
 *
 * The shared base -- reflection, goal check-in, follow-up action, own 1–5
 * satisfaction -- is actionable in place for the viewer's OWN participation
 * (in Peer, each participant sees and completes their own, on their own
 * enrollment). Triads write their reflection on the role-based reflection
 * page, which this links to. Module extras (coach notes and feedback, mentor
 * notes and feedback, peer feedback, triad group sharing) stay on the page
 * around it: they are never learner deliverables.
 *
 * A counterpart who is not a learner of the session (coach, mentor, admin)
 * sees the learner's checklist read-only: ticks only, never narrative.
 */
interface PostSessionChecklistProps {
  sourceTable: SessionSourceTable;
  sessionId: string;
  /** The signed-in user; only needed to create a goal from the check-in. */
  viewerUserId?: string | null;
  /** Render the goal check-in (SessionGoalRatings) inside the checklist. */
  showGoalCheckin?: boolean;
  className?: string;
}

export function PostSessionChecklist(props: PostSessionChecklistProps) {
  return (
    <>
      <LearnerChecklist {...props} />
      <CounterpartChecklist sourceTable={props.sourceTable} sessionId={props.sessionId} className={props.className} />
    </>
  );
}

function LearnerChecklist({
  sourceTable,
  sessionId,
  viewerUserId,
  showGoalCheckin = true,
  className,
}: PostSessionChecklistProps) {
  const { t } = useTranslation("sessions");
  const { data: rows, isLoading } = useSessionDeliverables(sourceTable, sessionId);

  if (isLoading || !rows || rows.length === 0) return null;
  // Only meaningful once the session has been held.
  if (!rows[0].sessionCompleted) return null;

  const own = rows.find((r) => r.isSelf) ?? null;
  if (own) {
    return (
      <OwnChecklist
        row={own}
        viewerUserId={viewerUserId}
        showGoalCheckin={showGoalCheckin}
        className={className}
      />
    );
  }

  // Counterpart / Admin: the learners' ticks, read-only.
  return (
    <Card className={cn("surface-card space-y-4 p-4 sm:p-6", className)} data-testid="post-session-checklist" data-mode="readonly">
      <div>
        <h3 className="font-display text-lg leading-tight">{t("postSession.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("postSession.counterpartSubtitle")}</p>
      </div>
      {rows.map((row) => (
        <div key={row.enrollmentId} className="space-y-2" data-testid="post-session-participant">
          {rows.length > 1 && row.participantRole && (
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t(`postSession.roles.${row.participantRole}`, { defaultValue: row.participantRole })}
            </p>
          )}
          <ChecklistItems row={row} />
        </div>
      ))}
    </Card>
  );
}

function StatusBadge({ row }: { row: SessionParticipantDeliverable }) {
  const { t } = useTranslation("sessions");
  const applicable = deliverableItems(row).filter((i) => i.required);
  const done = applicable.filter((i) => i.done).length;
  return (
    <Badge variant={row.deliverablesComplete ? "default" : "secondary"} data-testid="post-session-status">
      {row.deliverablesComplete
        ? t("postSession.evidenceComplete")
        : t("postSession.evidencePending", { done, total: applicable.length })}
    </Badge>
  );
}

function ChecklistItems({ row }: { row: SessionParticipantDeliverable }) {
  const { t } = useTranslation("sessions");
  return (
    <ul className="space-y-2">
      {deliverableItems(row).map((item) => (
        <li
          key={item.key}
          data-testid={`post-session-${item.key}`}
          data-done={item.done ? "true" : "false"}
          data-required={item.required ? "true" : "false"}
          className={cn("flex items-center gap-2 text-sm", !item.required && "text-muted-foreground")}
        >
          {item.done ? (
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          ) : (
            <Circle className={cn("size-4 shrink-0", item.required ? "text-warning" : "text-muted-foreground")} aria-hidden />
          )}
          <span className={cn(item.done && "text-muted-foreground line-through")}>{t(`postSession.items.${item.key}`)}</span>
          {!item.required && <span className="text-xs">({t("postSession.notRequired")})</span>}
          {item.required && !item.done && (
            <span className="text-xs font-semibold text-warning" data-testid={`post-session-${item.key}-outstanding`}>
              {t("postSession.outstanding")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function OwnChecklist({
  row,
  viewerUserId,
  showGoalCheckin,
  className,
}: {
  row: SessionParticipantDeliverable;
  viewerUserId?: string | null;
  showGoalCheckin: boolean;
  className?: string;
}) {
  const { t } = useTranslation("sessions");
  const invalidate = useInvalidateDeliverables();
  const isTriad = row.sourceTable === "triad_sessions";

  return (
    <Card
      className={cn("surface-card space-y-4 p-4 sm:p-6", className)}
      data-testid="post-session-checklist"
      data-mode="own"
      data-module={row.module}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg leading-tight">{t("postSession.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {row.participantRole === "provider" ? t("postSession.subtitleProvider") : t("postSession.subtitle")}
          </p>
        </div>
        <StatusBadge row={row} />
      </div>

      <ChecklistItems row={row} />

      {isTriad ? (
        <TriadReflectionLink row={row} />
      ) : (
        <ReflectionComposer row={row} />
      )}

      {showGoalCheckin && (
        <div className="border-t pt-4" data-testid="post-session-goal-checkin">
          <SessionGoalRatings
            sessionId={row.sessionId}
            coacheeId={viewerUserId ?? ""}
            enrollmentId={row.enrollmentId}
            sourceActivityType={DELIVERABLE_SOURCE_TYPES[row.sourceTable].checkin}
            canCreateGoal={!!viewerUserId}
            canEdit
            sessionStatus="completed"
            onSaved={invalidate}
          />
        </div>
      )}

      <FollowUpActions row={row} />

      <SatisfactionRating row={row} />

      {!row.deliverablesComplete && (
        <p className="text-xs text-muted-foreground">{t(`postSession.footerByModule.${row.module}`, { defaultValue: t("postSession.footer") })}</p>
      )}
    </Card>
  );
}

function ReflectionComposer({ row }: { row: SessionParticipantDeliverable }) {
  const { t } = useTranslation("sessions");
  const { data: existing } = useSessionReflection(row.enrollmentId, row.sourceTable, row.sessionId);
  const submit = useSubmitSessionReflection();
  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);
  // Adopt the stored reflection once it arrives, never clobbering an edit.
  useEffect(() => {
    if (!touched && existing !== undefined) setDraft(existing?.body ?? "");
  }, [existing, touched]);

  const trimmed = draft.trim();
  const unchanged = trimmed === (existing?.body ?? "").trim();
  const canSave = trimmed.length > 0 && !unchanged && !submit.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await submit.mutateAsync({ enrollmentId: row.enrollmentId, sourceTable: row.sourceTable, sessionId: row.sessionId, body: trimmed });
      setTouched(false);
      toast.success(t("postSession.reflection.saved"));
    } catch (error) {
      toast.error((error as { message?: string }).message ?? t("postSession.reflection.saveFailed"));
    }
  };

  const inputId = `post-session-reflection-${row.sessionId}`;
  return (
    <div className="space-y-2 border-t pt-4" data-testid="post-session-reflection-composer">
      <Label htmlFor={inputId}>{t("postSession.reflection.label")}</Label>
      <p className="text-xs text-muted-foreground">
        {t(`postSession.reflection.helpByModule.${row.module}`, { defaultValue: t("postSession.reflection.help") })}
      </p>
      <Textarea
        id={inputId}
        rows={4}
        value={draft}
        placeholder={t("postSession.reflection.placeholder")}
        onChange={(e) => {
          setTouched(true);
          setDraft(e.target.value);
        }}
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={!canSave} data-testid="post-session-reflection-save">
          {submit.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
          {row.hasReflection ? t("postSession.reflection.update") : t("postSession.reflection.save")}
        </Button>
      </div>
    </div>
  );
}

/** Triads: the reflection is role-based and shared with the group, so it lives on its own page. */
function TriadReflectionLink({ row }: { row: SessionParticipantDeliverable }) {
  const { t } = useTranslation("sessions");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4" data-testid="post-session-triad-reflection">
      <p className="text-sm text-muted-foreground">{t("postSession.triad.reflectionHelp")}</p>
      <Button asChild size="sm" variant={row.hasReflection ? "outline" : "default"}>
        <Link to={`/triads/${row.sessionId}/reflect`}>
          {row.hasReflection ? t("postSession.triad.viewReflection") : t("postSession.triad.writeReflection")}
        </Link>
      </Button>
    </div>
  );
}

function FollowUpActions({ row }: { row: SessionParticipantDeliverable }) {
  const { t } = useTranslation("sessions");
  const { t: tJourney } = useTranslation("journey");
  const { role } = useAuth();
  const journeyPath = role === "coach" ? "/coach/my-journey" : "/coachee/journey";
  const { data: actions } = useSessionFollowUpActions(row.enrollmentId, row.sourceTable, row.sessionId);
  const add = useAddSessionFollowUpAction();
  const [text, setText] = useState("");
  const [goalId, setGoalId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const { data: goals = [] } = useQuery({
    queryKey: ["post-session-action-goals", row.enrollmentId],
    enabled: !!row.enrollmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coachee_goals")
        .select("id, title")
        .eq("enrollment_id", row.enrollmentId)
        .eq("status", "active")
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleAdd = async () => {
    const value = text.trim();
    if (!value || !actions || !goalId || !dueDate) return;
    try {
      await add.mutateAsync({
        enrollmentId: row.enrollmentId,
        sourceTable: row.sourceTable,
        sessionId: row.sessionId,
        existing: actions,
        text: value,
        goalId,
        dueDate,
      });
      setText("");
      setGoalId("");
      setDueDate("");
      toast.success(t("postSession.action.added"));
    } catch (error) {
      toast.error((error as { message?: string }).message ?? t("postSession.action.addFailed"));
    }
  };

  return (
    <div className="space-y-2 border-t pt-4" data-testid="post-session-actions">
      <p className="text-sm font-medium">{t("postSession.action.label")}</p>
      {actions && actions.length > 0 && (
        <ul className="space-y-1 text-sm" data-testid="post-session-action-list">
          {actions.map((a, i) => (
            <li key={a.id ?? i} className={cn("flex items-center gap-2", a.done && "text-muted-foreground line-through")}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              <span>{a.text}</span>
              {a.due_date && <ActionDue due={a.due_date} done={a.done} t={tJourney} />}
              {a.goal_id && goals.some((g) => g.id === a.goal_id) && (
                <Link
                  to={`${journeyPath}#goal-${a.goal_id}`}
                  data-testid="action-goal"
                  className="rounded-full bg-primary/10 px-1.5 text-xs text-primary no-underline hover:bg-primary/20"
                >
                  {tJourney("actionRow.goal", { title: goals.find((g) => g.id === a.goal_id)?.title })}
                </Link>
              )}
              {(!a.goal_id || !a.due_date) && (
                <span className="text-xs text-warning" data-testid="post-session-action-incomplete">
                  {t("postSession.action.metadataIncomplete")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("postSession.action.placeholder")}
          aria-label={t("postSession.action.label")}
          data-testid="post-session-action-input"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAdd();
            }
          }}
        />
        <select
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
          aria-label={t("postSession.action.goal")}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          data-testid="post-session-action-goal"
        >
          <option value="">{t("postSession.action.goalPlaceholder")}</option>
          {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
        </select>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label={t("postSession.action.dueDate")}
          data-testid="post-session-action-due-date"
        />
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void handleAdd()}
          disabled={!text.trim() || !goalId || !dueDate || !actions || add.isPending}
          data-testid="post-session-action-add"
        >
          {add.isPending && <Loader2 className="mr-1 size-3 animate-spin" aria-hidden />}
          {t("postSession.action.add")}
        </Button>
      </div>
    </div>
  );
}

/** Due date coloured by the shared rule: green on track, orange due within 7 days, red overdue. */
function ActionDue({
  due,
  done,
  t,
}: {
  due: string;
  done?: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const status = actionDueStatus(due, done);
  return (
    <span
      data-testid="action-due"
      data-status={status ?? undefined}
      className={cn(
        "text-xs font-medium no-underline",
        status === "done" && "font-normal text-muted-foreground",
        status === "overdue" && "text-destructive",
        status === "dueSoon" && "text-warning",
        status === "onTrack" && "text-success",
      )}
    >
      {done ? t("actionRow.done") : status === "overdue" ? t("actionRow.overdue") : t("actionRow.due")}{" "}
      {format(new Date(`${due.slice(0, 10)}T00:00:00`), "MMM d")}
    </span>
  );
}

function SatisfactionRating({ row }: { row: SessionParticipantDeliverable }) {
  const { t } = useTranslation("sessions");
  const rate = useSubmitSessionSatisfaction();
  const [hover, setHover] = useState(0);
  const rating = row.satisfactionRating;
  // A Triad rating lives on the reflection submission, so it waits for it.
  const blocked = row.sourceTable === "triad_sessions" && !row.hasReflection;

  const handleRate = async (value: number) => {
    try {
      await rate.mutateAsync({ enrollmentId: row.enrollmentId, sourceTable: row.sourceTable, sessionId: row.sessionId, rating: value });
      toast.success(t("postSession.satisfaction.saved"));
    } catch (error) {
      toast.error((error as { message?: string }).message ?? t("postSession.satisfaction.saveFailed"));
    }
  };

  return (
    <div className="space-y-2 border-t pt-4" data-testid="post-session-rating">
      <p className="text-sm font-medium">{t("postSession.satisfaction.label")}</p>
      {blocked ? (
        <p className="text-xs text-muted-foreground">{t("postSession.triad.ratingAfterReflection")}</p>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5" role="radiogroup" aria-label={t("postSession.satisfaction.label")}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={t("postSession.satisfaction.stars", { count: n })}
                disabled={rate.isPending}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => void handleRate(n)}
                className="p-0.5 transition-transform hover:scale-110 disabled:opacity-50"
              >
                <Star className={cn("h-5 w-5", (hover || rating || 0) >= n ? "fill-warning text-warning" : "text-muted-foreground")} />
              </button>
            ))}
          </div>
          {rating != null && <span className="text-xs text-muted-foreground">({rating}/5)</span>}
        </div>
      )}
    </div>
  );
}

/**
 * The other side of the session: what the coach / mentor / peer owes after it
 * (session notes, feedback). Only the caller's own items are shown; each is a
 * done/outstanding flag from session_counterpart_deliverables(), never text.
 * The notes and feedback themselves are written in their existing sections on
 * the same page.
 */
function CounterpartChecklist({
  sourceTable,
  sessionId,
  className,
}: {
  sourceTable: SessionSourceTable;
  sessionId: string;
  className?: string;
}) {
  const { t } = useTranslation("sessions");
  const { data } = useSessionCounterpartDeliverables(sourceTable, sessionId);
  const own = (data ?? []).filter((d) => d.isSelf && d.sessionCompleted);
  if (own.length === 0) return null;
  const required = own.filter((d) => d.required);
  const done = required.filter((d) => d.done).length;
  const complete = done === required.length;
  return (
    <Card className={cn("surface-card space-y-3 p-4 sm:p-6", className)} data-testid="counterpart-checklist">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-lg leading-tight">{t("postSession.counterpart.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("postSession.counterpart.subtitle")}</p>
        </div>
        <Badge variant={complete ? "default" : "secondary"} data-testid="counterpart-status">
          {complete
            ? t("postSession.counterpart.complete")
            : t("postSession.counterpart.pending", { done, total: required.length })}
        </Badge>
      </div>
      <ul className="space-y-2">
        {own.map((d: CounterpartDeliverable) => (
          <li
            key={`${d.role}-${d.item}`}
            data-testid={`counterpart-${d.item}`}
            data-done={d.done ? "true" : "false"}
            data-required={d.required ? "true" : "false"}
            className={cn("flex items-center gap-2 text-sm", !d.required && "text-muted-foreground")}
          >
            {d.done ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <Circle className={cn("size-4 shrink-0", d.required ? "text-warning" : "text-muted-foreground")} aria-hidden />
            )}
            <span className={cn(!d.done && d.required && "font-medium")}>{t(`postSession.counterpart.items.${d.item}`)}</span>
            {!d.required && <span className="text-xs">({t("postSession.counterpart.optional")})</span>}
            {!d.done && d.required && (
              <Badge variant="outline" className="border-warning/40 text-[10px] text-warning">
                {t("postSession.outstanding")}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default PostSessionChecklist;
