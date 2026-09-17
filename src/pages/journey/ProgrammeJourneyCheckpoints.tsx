import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { CheckCircle2, Circle, Clock, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useLearnerCanonicalProgress, type LearnerJourneyPoint } from "@/hooks/useLearnerCanonicalProgress";

const STATE_ICON: Record<LearnerJourneyPoint["state"], typeof CheckCircle2> = {
  completed: CheckCircle2,
  current: Clock,
  overdue: AlertTriangle,
  upcoming: Circle,
};

const STATE_CLASS: Record<LearnerJourneyPoint["state"], string> = {
  completed: "text-success",
  current: "text-primary",
  overdue: "text-destructive",
  upcoming: "text-muted-foreground",
};

/**
 * Cross-module programme journey: checkpoints derived from Programme scope
 * (which modules apply and how many units), Cohort schedule (when each
 * milestone is due), and real attributed Activity (what's actually been
 * completed) — the same construction Sponsor Leader Detail renders via
 * sponsor_canonical_leader_journey, just self-authorized instead of
 * sponsor-authorized. There is no client-side date arithmetic here and no
 * fallback week count; a programme with no configured schedule renders
 * nothing rather than an invented timeline.
 */
export function ProgrammeJourneyCheckpoints({ enrollmentId }: { enrollmentId: string | null | undefined }) {
  const { t } = useTranslation("journey");
  const { journey, loading } = useLearnerCanonicalProgress(enrollmentId ?? undefined);

  if (loading || journey.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-muted/30 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("programmeJourney.title")}
        </p>
      </div>
      <ul className="divide-y">
        {journey.map((point) => {
          const Icon = STATE_ICON[point.state];
          return (
            <li key={point.checkpoint_number} className="flex items-center gap-3 px-4 py-3">
              <Icon className={cn("h-4 w-4 shrink-0", STATE_CLASS[point.state])} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {point.label || t("programmeJourney.checkpoint", { number: point.checkpoint_number })}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {format(new Date(point.due_on), "MMM d, yyyy")}
                  {" · "}
                  {t("programmeJourney.unitsOf", { completed: point.completed_units, required: point.required_units })}
                </p>
              </div>
              <span className={cn("shrink-0 text-[10px] font-bold uppercase tracking-widest", STATE_CLASS[point.state])}>
                {t(`programmeJourney.states.${point.state}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
