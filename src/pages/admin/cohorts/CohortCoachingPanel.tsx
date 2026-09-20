import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getFriendlyErrorMessage } from "@/lib/errors";
import {
  useAdminCohortCoaches,
  useSetCohortCoachAssignment,
} from "@/hooks/coaching/useAdminCohortCoaches";

/**
 * Admin -> Cohort -> Coaching: the cohort's Coach pool.
 *
 * Division of ownership:
 *   Programme  how many Coaching units are required
 *   Cohort     the requirement DATES (edited in CohortRequirementSchedule,
 *              which is module-generic and already validates that the number
 *              of dates matches the programme's required count)
 *   Cohort     the Coach POOL -- this panel
 *
 * A learner books any active Coach in their cohort's pool, and may use a
 * different one for each requirement. There is no per-learner Coach
 * assignment for programme Coaching any more.
 */
export function CohortCoachingPanel({ cohortId }: { cohortId: string | undefined }) {
  const { t } = useTranslation("admin");
  const { data: coaches, isLoading } = useAdminCohortCoaches(cohortId);
  const setAssignment = useSetCohortCoachAssignment(cohortId);

  if (!cohortId) return null;

  const assigned = (coaches ?? []).filter((c) => c.isActive);

  const toggle = (coachId: string, active: boolean) => {
    setAssignment.mutate(
      { coachId, active },
      {
        onError: (e) => toast.error(getFriendlyErrorMessage(e, t)),
        onSuccess: () =>
          toast.success(
            active ? t("cohorts.coaching.assigned") : t("cohorts.coaching.unassigned"),
          ),
      },
    );
  };

  return (
    <Card className="space-y-4 p-4 sm:p-5" data-testid="cohort-coaching-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base leading-tight">
            {t("cohorts.coaching.title")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("cohorts.coaching.intro")}</p>
        </div>
        <Badge variant="secondary" data-testid="cohort-coaching-assigned-count">
          {t("cohorts.coaching.assignedCount", { count: assigned.length })}
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (coaches ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("cohorts.coaching.noCoaches")}</p>
      ) : (
        <ul className="space-y-1.5">
          {(coaches ?? []).map((c) => (
            <li
              key={c.coachId}
              data-testid="cohort-coach-row"
              data-assigned={c.isActive ? "true" : "false"}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
            >
              <Checkbox
                checked={c.isActive}
                disabled={setAssignment.isPending}
                onCheckedChange={(v) => toggle(c.coachId, !!v)}
                aria-label={t("cohorts.coaching.toggleLabel", { name: c.fullName })}
              />
              <span className="text-sm font-medium">{c.fullName}</span>
              {c.title && (
                <span className="truncate text-xs text-muted-foreground">{c.title}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {assigned.length === 0 && !isLoading && (
        // Without a pool no learner in this cohort can book Coaching at all,
        // so this is a configuration error rather than an empty state.
        <p className="text-xs text-warning" data-testid="cohort-coaching-warning">
          {t("cohorts.coaching.noneAssignedWarning")}
        </p>
      )}
    </Card>
  );
}

export default CohortCoachingPanel;
