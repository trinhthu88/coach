import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getFriendlyErrorMessage } from "@/lib/errors";
import {
  useAdminCohortMentors,
  useSetCohortMentorAssignment,
} from "@/hooks/mentoring/useAdminCohortMentors";

/**
 * Admin -> Cohort -> Mentoring: the cohort's mentor pool.
 *
 * Division of ownership, the same as Coaching:
 *   Programme  how many Mentoring units are required
 *   Cohort     the requirement DATES (CohortRequirementSchedule, module-generic)
 *   Cohort     the mentor POOL -- this panel
 *
 * A Mentor is not a user type: it is a Coach with a Mentoring assignment for
 * this cohort. The candidate list is therefore the same Coach population the
 * Coaching panel offers, and the two assignments are independent -- assigning
 * somebody here grants nothing for Coaching, and vice versa.
 *
 * Coach identity itself (role, account state, profile, bio) is administered in
 * Admin -> Coaches; this panel only decides who mentors for this cohort.
 */
export function CohortMentoringPanel({ cohortId }: { cohortId: string | undefined }) {
  const { t } = useTranslation("admin");
  const { data: mentors, isLoading } = useAdminCohortMentors(cohortId);
  const setAssignment = useSetCohortMentorAssignment(cohortId);

  if (!cohortId) return null;

  const assigned = (mentors ?? []).filter((m) => m.isActive);
  // Assigned but the Coach account is inactive: bookable by nobody, and worth
  // surfacing because the cohort looks staffed when it is not.
  const assignedButInactive = assigned.filter((m) => !m.accountActive);

  const toggle = (mentorUserId: string, active: boolean) => {
    setAssignment.mutate(
      { mentorUserId, active },
      {
        onError: (e) => toast.error(getFriendlyErrorMessage(e, t)),
        onSuccess: () =>
          toast.success(
            active ? t("cohorts.mentoring.assigned") : t("cohorts.mentoring.unassigned"),
          ),
      },
    );
  };

  return (
    <Card className="space-y-4 p-4 sm:p-5" data-testid="cohort-mentoring-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base leading-tight">
            {t("cohorts.mentoring.title")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("cohorts.mentoring.intro")}</p>
        </div>
        <Badge variant="secondary" data-testid="cohort-mentoring-assigned-count">
          {t("cohorts.mentoring.assignedCount", { count: assigned.length })}
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (mentors ?? []).length === 0 ? (
        // There are no Coaches at all -- not "no mentors", which would imply
        // Mentor is a separate kind of account.
        <p className="text-sm text-muted-foreground">{t("cohorts.mentoring.noCoaches")}</p>
      ) : (
        <ul className="space-y-1.5">
          {(mentors ?? []).map((m) => (
            <li
              key={m.mentorUserId}
              data-testid="cohort-mentor-row"
              data-assigned={m.isActive ? "true" : "false"}
              data-account-active={m.accountActive ? "true" : "false"}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
            >
              <Checkbox
                checked={m.isActive}
                disabled={setAssignment.isPending}
                onCheckedChange={(v) => toggle(m.mentorUserId, !!v)}
                aria-label={t("cohorts.mentoring.toggleLabel", { name: m.fullName })}
              />
              <span className="text-sm font-medium">{m.fullName}</span>
              {m.title && <span className="text-xs text-muted-foreground">{m.title}</span>}
              {!m.accountActive && (
                <span className="text-xs text-warning">
                  {t("cohorts.mentoring.accountInactive")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isLoading && assigned.length === 0 && (
        // Without a pool no learner in this cohort can book Mentoring, so this
        // is a configuration error rather than an empty state.
        <p className="text-xs text-warning" data-testid="cohort-mentoring-warning">
          {t("cohorts.mentoring.noneAssignedWarning")}
        </p>
      )}
      {!isLoading && assignedButInactive.length > 0 && (
        <p className="text-xs text-warning" data-testid="cohort-mentoring-inactive-warning">
          {t("cohorts.mentoring.inactiveAssignedWarning", { count: assignedButInactive.length })}
        </p>
      )}
    </Card>
  );
}

export default CohortMentoringPanel;
