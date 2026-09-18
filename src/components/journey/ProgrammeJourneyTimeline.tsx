import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { CheckCircle2, Circle, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLearnerCanonicalProgress, type LearnerJourneyPoint } from "@/hooks/useLearnerCanonicalProgress";

const STATE_ICON: Record<LearnerJourneyPoint["state"], typeof CheckCircle2> = {
  completed: CheckCircle2,
  current: Clock,
  overdue: AlertTriangle,
  upcoming: Circle,
};

const STATE_DOT_CLASS: Record<LearnerJourneyPoint["state"], string> = {
  completed: "bg-success border-success text-success-foreground",
  current: "bg-primary border-primary text-primary-foreground",
  overdue: "bg-destructive border-destructive text-destructive-foreground",
  upcoming: "bg-card border-border text-muted-foreground",
};

const STATE_TEXT_CLASS: Record<LearnerJourneyPoint["state"], string> = {
  completed: "text-success",
  current: "text-primary",
  overdue: "text-destructive",
  upcoming: "text-muted-foreground",
};

/**
 * The horizontal, connected-checkpoint presentation of Programme Journey —
 * approved Coachee prototype visual spec, backed by the exact same
 * canonical checkpoint list (learner_canonical_journey via
 * useLearnerCanonicalProgress) the vertical ProgrammeJourneyCheckpoints
 * card and Sponsor Leader Detail both read. Renders exactly as many
 * checkpoints as are configured — never a fixed count — and never infers a
 * per-module breakdown the canonical row doesn't provide: the expandable
 * detail shows the checkpoint's own aggregate required/completed count plus
 * its real module_scope list, not invented per-module numbers.
 */
export function ProgrammeJourneyTimeline({
  enrollmentId,
  variant = "preview",
}: {
  enrollmentId: string | null | undefined;
  variant?: "preview" | "full";
}) {
  const { t } = useTranslation("journey");
  const { t: tTraining } = useTranslation("training");
  const { journey, loading } = useLearnerCanonicalProgress(enrollmentId ?? undefined);

  const defaultSelected = useMemo(() => {
    const current = journey.find((p) => p.state === "current");
    return current?.checkpoint_number ?? journey[0]?.checkpoint_number ?? null;
  }, [journey]);
  const [selected, setSelected] = useState<number | null>(null);
  const selectedNumber = selected ?? defaultSelected;
  const selectedPoint = journey.find((p) => p.checkpoint_number === selectedNumber) ?? null;

  if (loading) {
    return <div className="h-40 animate-pulse rounded-2xl bg-muted/50" />;
  }

  if (journey.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">{t("programmeJourney.empty")}</p>;
  }

  return (
    <div>
      <div className="-mx-1 overflow-x-auto pb-1">
        <div className={cn("flex gap-0 px-1", variant === "full" ? "min-w-[820px]" : "min-w-[700px]")}>
          {journey.map((point, idx) => {
            const Icon = STATE_ICON[point.state];
            const isSelected = point.checkpoint_number === selectedNumber;
            return (
              <button
                key={point.checkpoint_number}
                type="button"
                onClick={() => setSelected(point.checkpoint_number)}
                className={cn(
                  "relative flex-1 rounded-xl px-2 py-3 text-center transition-colors",
                  isSelected ? "bg-primary-soft" : "hover:bg-muted/50"
                )}
              >
                {/* connecting line */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-[26px] h-px bg-border",
                    idx === 0 ? "left-1/2 right-0" : idx === journey.length - 1 ? "left-0 right-1/2" : "left-0 right-0",
                    point.state === "completed" && "bg-success/40"
                  )}
                />
                <div className="relative">
                  {point.state === "current" && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[7.5px] font-bold uppercase tracking-widest text-secondary-foreground">
                      {t("programmeJourney.youAreHere")}
                    </span>
                  )}
                  <p className="text-[9px] text-muted-foreground">{format(new Date(point.due_on), "MMM d")}</p>
                  <span
                    className={cn(
                      "relative z-10 mx-auto mt-1.5 grid h-5 w-5 place-items-center rounded-full border-2",
                      STATE_DOT_CLASS[point.state]
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                </div>
                <p className="font-display mt-1.5 text-[12.5px] leading-tight">
                  {point.label || t("programmeJourney.checkpoint", { number: point.checkpoint_number })}
                </p>
                {variant === "full" && (
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("programmeJourney.checkpoint", { number: point.checkpoint_number })}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {t("programmeJourney.unitsOf", { completed: point.completed_units, required: point.required_units })}
                </p>
                <p className={cn("mt-1 text-[9px] font-bold uppercase tracking-widest", STATE_TEXT_CLASS[point.state])}>
                  {t(`programmeJourney.states.${point.state}`)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {selectedPoint && (
        <div className="mt-3 rounded-xl border border-border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("programmeJourney.checkpoint", { number: selectedPoint.checkpoint_number })}
              </p>
              <p className="font-display text-base">
                {selectedPoint.label || t("programmeJourney.checkpoint", { number: selectedPoint.checkpoint_number })}
              </p>
            </div>
            <span className={cn("text-[10px] font-bold uppercase tracking-widest", STATE_TEXT_CLASS[selectedPoint.state])}>
              {t("programmeJourney.dueOn", { date: format(new Date(selectedPoint.due_on), "MMM d, yyyy") })}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-sm">
              {t("programmeJourney.unitsOf", {
                completed: selectedPoint.completed_units,
                required: selectedPoint.required_units,
              })}
            </p>
            {selectedPoint.module_scope.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("programmeJourney.scopeLabel")}
                </span>
                {selectedPoint.module_scope.map((mod) => (
                  <span key={mod} className="rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold text-foreground">
                    {tTraining(`progressCard.modules.${mod}`, { defaultValue: mod })}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
