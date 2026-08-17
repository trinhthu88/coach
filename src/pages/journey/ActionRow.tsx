import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { format, isBefore } from "date-fns";
import { cn } from "@/lib/utils";
import type { FlatAction } from "@/hooks/journey/useFlatActionItems";

export function ActionRow({
  a,
  milestoneLabel,
  hideMilestone,
  onToggle,
  showSourceBadge,
}: {
  a: FlatAction;
  milestoneLabel?: string;
  hideMilestone?: boolean;
  onToggle?: (a: FlatAction) => void;
  /** Shows the done-check inline with the text and a Peer/Coaching badge — used by the coach's own journey view, which mixes both session sources. */
  showSourceBadge?: boolean;
}) {
  const { t } = useTranslation("journey");
  const overdue = !a.done && a.due_date && isBefore(new Date(a.due_date), new Date());
  return (
    <div className="flex items-start gap-2 py-1">
      <button
        type="button"
        onClick={() => onToggle?.(a)}
        disabled={!onToggle}
        aria-label={a.done ? t("actionRow.markAsNotDone") : t("actionRow.markAsDone")}
        className={cn("group -m-2 shrink-0 rounded-md p-2", onToggle ? "cursor-pointer" : "cursor-default")}
      >
        <span
          className={cn(
            "mt-0.5 flex h-4 w-4 items-center justify-center rounded-sm border transition-colors",
            a.done && "border-success bg-success text-success-foreground",
            !a.done && overdue && "border-destructive bg-destructive/10 group-hover:bg-destructive/20",
            !a.done && !overdue && "border-border bg-muted group-hover:bg-muted/70",
          )}
        >
          {a.done && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        {showSourceBadge ? (
          <p className="text-xs leading-snug inline-flex items-center gap-1">
            {a.done && <Check className="h-3 w-3 text-success" strokeWidth={3} />}
            <span>{a.text}</span>
          </p>
        ) : (
          <p className={cn("text-xs leading-snug", a.done && "text-muted-foreground")}>{a.text}</p>
        )}
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
          {a.due_date && (
            <span className={cn(overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
              {a.done ? t("actionRow.done") : overdue ? t("actionRow.overdue") : t("actionRow.due")} {format(new Date(a.due_date), "MMM d")}
            </span>
          )}
          {!hideMilestone && milestoneLabel && (
            <span className="text-primary">· {milestoneLabel}</span>
          )}
          {showSourceBadge && (
            <span
              className={cn(
                "rounded-full px-1.5 text-[9px] font-bold uppercase tracking-wider",
                a.source === "peer" ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary"
              )}
            >
              {a.source === "peer" ? t("actionRow.sourcePeer") : t("actionRow.sourceCoaching")}
            </span>
          )}
          <Link to={`/sessions/${a.sessionId}`} className="text-muted-foreground hover:text-primary">
            · {a.sessionTopic}
          </Link>
        </div>
      </div>
    </div>
  );
}
