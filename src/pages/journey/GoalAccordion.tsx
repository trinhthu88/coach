import { useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Check, Lock, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Goal, Milestone } from "@/hooks/journey/types";
import type { FlatAction } from "@/hooks/journey/useFlatActionItems";
import type { GoalRatingRow } from "./GoalWheel";
import { ACCENTS, initials } from "./journeyDisplay";
import { RatingSlider } from "./RatingSlider";
import { ActionRow } from "./ActionRow";

export function GoalAccordion({
  goal,
  milestones,
  actions,
  pct,
  accent,
  onToggle,
  onToggleAction,
  onAddMilestone,
  onDeleteGoal,
  onDeleteMilestone,
  defaultOpen,
  showLinkedActions = true,
  rating,
  onRatingChange,
  startTargetLocked,
  showCompletionMarks,
}: {
  goal: Goal;
  milestones: Milestone[];
  actions: FlatAction[];
  pct: number;
  accent: (typeof ACCENTS)[number];
  onToggle: (m: Milestone) => void;
  onToggleAction: (a: FlatAction) => void;
  onAddMilestone: (goalId: string, title: string, target_date: string | null) => Promise<boolean | undefined> | void;
  onDeleteGoal: (goalId: string) => Promise<void> | void;
  onDeleteMilestone: (id: string) => Promise<void> | void;
  defaultOpen?: boolean;
  showLinkedActions?: boolean;
  rating?: GoalRatingRow;
  onRatingChange?: (patch: { start_rating?: number; current_rating?: number; target_rating?: number }) => void;
  startTargetLocked?: boolean;
  /** Shows the goal-done checkmark, target date in the header, and a check inside done milestone circles — used by the coach's own journey view. */
  showCompletionMarks?: boolean;
}) {
  const { t } = useTranslation("journey");
  const [open, setOpen] = useState(!!defaultOpen);
  const [adding, setAdding] = useState(false);
  const [newMs, setNewMs] = useState("");
  const [newDate, setNewDate] = useState("");

  const goalDone = pct === 100 && milestones.length > 0;

  const addMs = async () => {
    if (!newMs.trim()) return;
    const ok = await onAddMilestone(goal.id, newMs.trim(), newDate || null);
    if (ok === false) return;
    setNewMs("");
    setNewDate("");
    setAdding(false);
  };

  const deleteGoal = async () => {
    if (!confirm(t("goalAccordion.confirmDeleteGoal"))) return;
    await onDeleteGoal(goal.id);
  };

  const deleteMs = async (id: string) => {
    await onDeleteMilestone(id);
  };

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 bg-muted/30 px-3 py-2.5 text-left hover:bg-muted/50"
      >
        <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold", accent.bg, accent.text)}>
          {initials(goal.title)}
        </div>
        {showCompletionMarks ? (
          <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold">
            {goalDone && <Check className="h-3.5 w-3.5 shrink-0 text-success" strokeWidth={3} />}
            <span className="truncate">{goal.title}</span>
            {goal.target_date && (
              <span className="ml-2 hidden shrink-0 text-[10px] font-normal text-muted-foreground sm:inline">
                · {t("goalAccordion.goalHeaderTargetDate", { date: format(new Date(goal.target_date), "MMM d") })}
              </span>
            )}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{goal.title}</span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">{pct}%</span>
        <div className="hidden h-1 w-14 overflow-hidden rounded-full bg-background sm:block">
          <div className={cn("h-full", accent.fill)} style={{ width: `${pct}%` }} />
        </div>
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t p-4">
          {goal.description && <p className="mb-3 text-xs text-muted-foreground">{goal.description}</p>}

          {/* Self-rating sliders — Start & Target only, locked once a session is completed after adding this goal */}
          {rating && onRatingChange && (
            <div className="mb-4 rounded-lg border bg-muted/20 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("goalAccordion.startAndTarget")}
                </p>
                {startTargetLocked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground" title={t("goalAccordion.lockedHint")}>
                    <Lock className="h-3 w-3" /> {t("goalAccordion.locked")}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                <RatingSlider
                  label={t("goalAccordion.startLabel")}
                  hint={startTargetLocked ? t("goalAccordion.lockedHint") : t("goalAccordion.startHint")}
                  value={rating.start}
                  trackColor="bg-primary/40"
                  disabled={startTargetLocked}
                  onChange={(v) => onRatingChange({ start_rating: v })}
                />
                <RatingSlider
                  label={t("goalAccordion.targetLabel")}
                  hint={startTargetLocked ? t("goalAccordion.lockedHint") : t("goalAccordion.targetHint")}
                  value={rating.target}
                  trackColor="bg-accent"
                  disabled={startTargetLocked}
                  onChange={(v) => onRatingChange({ target_rating: v })}
                />
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground">
                {t("goalAccordion.currentRatingPrefix")} <strong>{t("goalAccordion.currentRatingBold")}</strong> {t("goalAccordion.currentRatingSuffix")}
              </p>
            </div>
          )}

          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {showLinkedActions ? t("goalAccordion.milestonesAndActions") : t("goalAccordion.milestonesOnly")}
          </p>
          <ul className="space-y-3">
            {milestones.map((m) => {
              const linked = actions.filter((a) => a.milestone_id === m.id);
              const status: "done" | "active" | "todo" = m.is_done
                ? "done"
                : linked.length || (m.target_date && new Date(m.target_date) < new Date(Date.now() + 1000 * 60 * 60 * 24 * 30))
                ? "active"
                : "todo";
              return (
                <li key={m.id} className="flex items-start gap-3">
                  <button
                    onClick={() => onToggle(m)}
                    className="-m-2 shrink-0 rounded-full p-2"
                    aria-label={t("goalAccordion.toggleMilestone")}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2",
                        status === "done" && "border-success bg-success text-success-foreground",
                        status === "active" && "border-primary bg-primary/40",
                        status === "todo" && "border-border bg-muted",
                      )}
                    >
                      {showCompletionMarks && m.is_done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn("flex items-center gap-1.5 text-sm font-medium", !showCompletionMarks && m.is_done && "text-muted-foreground")}>
                        {m.is_done && <Check className="h-3.5 w-3.5 text-success" strokeWidth={3} />}
                        <span>{m.title}</span>
                      </p>
                      <button onClick={() => deleteMs(m.id)} className="-m-2 rounded-md p-2 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {m.is_done && m.done_at
                        ? t("goalAccordion.doneOn", { date: format(new Date(m.done_at), "MMM d") })
                        : m.target_date
                        ? t("goalAccordion.targetOn", { date: format(new Date(m.target_date), "MMM d") })
                        : t("goalAccordion.noTargetDate")}
                      {linked.length > 0 && t("goalAccordion.actionsCountSuffix", { done: linked.filter((a) => a.done).length, total: linked.length })}
                    </p>
                    {showLinkedActions && linked.length > 0 && (
                      <div className="mt-2 space-y-1.5 rounded-md border bg-muted/20 p-2">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t("goalAccordion.linkedActions")}
                        </p>
                        {linked.map((a, i) => (
                          <ActionRow key={i} a={a} hideMilestone onToggle={onToggleAction} showSourceBadge={showCompletionMarks} />
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {adding ? (
            <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3">
              <Input placeholder={t("goalAccordion.milestoneTitlePlaceholder")} value={newMs} onChange={(e) => setNewMs(e.target.value)} />
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t("goalAccordion.cancel")}</Button>
                <Button size="sm" onClick={addMs}>{t("goalAccordion.add")}</Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
                <Plus className="mr-1 h-3 w-3" /> {t("goalAccordion.addMilestone")}
              </Button>
              <button onClick={deleteGoal} className="text-xs text-muted-foreground hover:text-destructive">
                {t("goalAccordion.deleteGoal")}
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
