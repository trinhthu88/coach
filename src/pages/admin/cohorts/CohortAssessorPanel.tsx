import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useAdminCohortAssessors, useSetCohortAssessor } from "@/hooks/assessments/useAdminAssessments";

/**
 * Admin -> Cohort -> Assessor pool: which Coaches may review this cohort's
 * Triad submissions and Final Assessments. Built like the Mentor pool.
 *
 * An assessor is a Coach with an assessor assignment for this cohort,
 * independent of their Coaching and Mentoring assignments. The pool only says
 * who MAY be assigned: Admin assigns each submission from the queue, and the
 * server refuses the learner's own programme coach there.
 */
export function CohortAssessorPanel({ cohortId }: { cohortId: string | undefined }) {
  const { t } = useTranslation("admin");
  const { data: coaches, isLoading, isError } = useAdminCohortAssessors(cohortId);
  const setAssessor = useSetCohortAssessor(cohortId);

  if (!cohortId) return null;

  const assigned = (coaches ?? []).filter((c) => c.isActive);
  const assignedButInactive = assigned.filter((c) => !c.accountActive);

  const toggle = (coachId: string, active: boolean) => {
    setAssessor.mutate(
      { coachId, active },
      {
        onError: (e) => toast.error(getFriendlyErrorMessage(e, t)),
        onSuccess: () =>
          toast.success(active ? t("cohorts.assessors.assigned") : t("cohorts.assessors.unassigned")),
      },
    );
  };

  return (
    <Card className="space-y-4 p-4 sm:p-5" data-testid="cohort-assessor-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base leading-tight">{t("cohorts.assessors.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("cohorts.assessors.intro")}</p>
        </div>
        <Badge variant="secondary" data-testid="cohort-assessor-assigned-count">
          {t("cohorts.assessors.assignedCount", { count: assigned.length })}
        </Badge>
      </div>

      {isError ? (
        <p role="alert" data-testid="cohort-assessor-error" className="text-sm text-destructive">
          {t("cohorts.assessors.loadError")}
        </p>
      ) : isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (coaches ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("cohorts.assessors.noCoaches")}</p>
      ) : (
        <ul className="space-y-1.5">
          {(coaches ?? []).map((c) => (
            <li
              key={c.coachId}
              data-testid="cohort-assessor-row"
              data-assigned={c.isActive ? "true" : "false"}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
            >
              <Checkbox
                checked={c.isActive}
                disabled={setAssessor.isPending}
                onCheckedChange={(v) => toggle(c.coachId, !!v)}
                aria-label={t("cohorts.assessors.toggleLabel", { name: c.fullName })}
              />
              <span className="text-sm font-medium">{c.fullName}</span>
              {!c.accountActive && (
                <span className="text-xs text-warning">{t("cohorts.assessors.accountInactive")}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isLoading && !isError && assigned.length === 0 && (
        <p className="text-xs text-warning" data-testid="cohort-assessor-warning">
          {t("cohorts.assessors.noneAssignedWarning")}
        </p>
      )}
      {!isLoading && !isError && assignedButInactive.length > 0 && (
        <p className="text-xs text-warning" data-testid="cohort-assessor-inactive-warning">
          {t("cohorts.assessors.inactiveAssignedWarning", { count: assignedButInactive.length })}
        </p>
      )}
    </Card>
  );
}

export default CohortAssessorPanel;
