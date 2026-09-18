import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { EnrollmentActionRow, EnrollmentActionsSummary } from "@/hooks/dashboard/useEnrollmentActionsSummary";
import type { Goal } from "@/hooks/journey/types";
import type { FlatAction } from "@/hooks/journey/useFlatActionItems";

/**
 * Every action for this enrollment, grouped Overdue / Due this week /
 * Upcoming / Completed — sourced from enrollment_actions directly
 * (useEnrollmentActionsSummary), not from actions attached to a loaded
 * coaching session. That distinction matters: the coaching-session-derived
 * projection (useFlatActionItems) only sees actions whose
 * source_activity_type is "coaching", so it silently drops any action
 * created from a mentoring or peer-coaching session. This component shows
 * every enrollment_actions row regardless of source; a row can still be
 * toggled here when a matching FlatAction (with a working toggle mutation)
 * exists for it, via `toggleableById`.
 */
export function EnrollmentActionGroups({
  summary,
  goals,
  toggleableById,
  onToggleAction,
  emptyMessage,
}: {
  summary: EnrollmentActionsSummary;
  goals: Goal[];
  toggleableById: Map<string, FlatAction>;
  onToggleAction: (a: FlatAction) => void;
  emptyMessage: string;
}) {
  const { t } = useTranslation("journey");

  if (summary.total === 0) {
    return <Card className="p-6 text-center text-sm text-muted-foreground sm:p-12">{emptyMessage}</Card>;
  }

  const Group = ({ title, items, danger }: { title: string; items: EnrollmentActionRow[]; danger?: boolean }) => {
    if (!items.length) return null;
    return (
      <div>
        <p
          className={cn(
            "mb-1 border-b py-1 text-[11px] font-semibold",
            danger ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground"
          )}
        >
          {title} · {items.length}
        </p>
        <div className="divide-y">
          {items.map((a) => {
            const toggleable = toggleableById.get(a.id);
            const goalTitle = a.goal_id ? goals.find((g) => g.id === a.goal_id)?.title : null;
            const done = a.status === "completed";
            return (
              <div key={a.id} className="flex items-start gap-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleable && onToggleAction(toggleable)}
                  disabled={!toggleable}
                  className={cn(
                    "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2",
                    done ? "border-success bg-success text-success-foreground" : "border-border bg-muted",
                    !toggleable && "cursor-default opacity-70"
                  )}
                  aria-label={t("actionGroups.toggleAction")}
                >
                  {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", done && "text-muted-foreground line-through")}>{a.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {goalTitle && `${goalTitle} · `}
                    {a.due_date ? t("actionGroups.dueOn", { date: format(new Date(a.due_date), "MMM d") }) : t("actionGroups.noDueDate")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Card className="p-4">
      <Group title={t("actionGroups.overdue")} items={summary.overdue} danger />
      <Group title={t("actionGroups.dueThisWeek")} items={summary.dueThisWeek} />
      <Group title={t("actionGroups.upcoming")} items={summary.upcoming} />
      <Group title={t("actionGroups.completed")} items={summary.completed} />
    </Card>
  );
}
