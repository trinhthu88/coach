import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FlatAction, GroupedActions } from "@/hooks/journey/useFlatActionItems";
import type { Goal, Milestone } from "@/hooks/journey/types";
import { ActionRow } from "./ActionRow";

export function ActionGroups({
  grouped,
  milestones,
  goals,
  compact,
  onToggleAction,
  showSourceBadge,
  emptyMessage,
}: {
  grouped: GroupedActions;
  milestones?: Milestone[];
  goals?: Goal[];
  compact?: boolean;
  onToggleAction?: (a: FlatAction) => void;
  showSourceBadge?: boolean;
  emptyMessage: string;
}) {
  const { t } = useTranslation("journey");
  const labelFor = (a: FlatAction) => {
    if (!milestones || !goals || !a.milestone_id) return undefined;
    const m = milestones.find((x) => x.id === a.milestone_id);
    if (!m) return undefined;
    const g = goals.find((x) => x.id === m.goal_id);
    return g ? `${g.title} → ${m.title}` : m.title;
  };

  const total =
    grouped.overdue.length + grouped.thisWeek.length + grouped.upcoming.length + grouped.completed.length;
  if (!total) {
    return (
      <Card className="p-12 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </Card>
    );
  }

  const Group = ({ title, items, danger }: { title: string; items: FlatAction[]; danger?: boolean }) => {
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
          {items.map((a, i) => (
            <ActionRow key={i} a={a} milestoneLabel={labelFor(a)} onToggle={onToggleAction} showSourceBadge={showSourceBadge} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card className={cn("p-4", compact && "space-y-1")}>
      <Group title={t("actionGroups.overdue")} items={grouped.overdue} danger />
      <Group title={t("actionGroups.dueThisWeek")} items={grouped.thisWeek} />
      <Group title={t("actionGroups.upcoming")} items={grouped.upcoming} />
      {!compact && <Group title={t("actionGroups.completed")} items={grouped.completed} />}
    </Card>
  );
}
