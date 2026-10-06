import { useTranslation } from "react-i18next";
import { ArrowUpRight, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { pendingReviewCount, useCoachAssessmentInbox } from "@/hooks/assessments/useCoachAssessments";
import { DashboardCardShell, CardEmptyHint, CardFooterLink } from "./shared";

/**
 * Coach dashboard: "Submissions to assess (n)", n = new assignments plus
 * reviews Admin returned (coach_assessment_inbox). Hidden for a coach who has
 * never been assigned anything to assess, so it only appears once loaded.
 */
export function SubmissionsToAssessCard() {
  const { t } = useTranslation("assessments");
  const { data: rows = [], isLoading, isError } = useCoachAssessmentInbox();

  if (isLoading || isError || rows.length === 0) return null;

  const pending = pendingReviewCount(rows);
  const overdue = rows.filter((r) => r.isOverdue).length;
  const returned = rows.filter((r) => r.tab === "returned").length;

  return (
    <div data-testid="submissions-to-assess-card" className="contents">
      <DashboardCardShell
        icon={ClipboardCheck}
        title={t("dashboardCard.title", { count: pending })}
        badge={overdue > 0 ? <Badge variant="destructive">{t("dashboardCard.overdue", { count: overdue })}</Badge> : undefined}
      >
        {pending === 0 ? (
          <CardEmptyHint text={t("dashboardCard.none")} />
        ) : (
          <div className="flex-1 space-y-1 py-2 text-sm">
            <p className="font-semibold">{t("dashboardCard.pending", { count: pending })}</p>
            {returned > 0 && <p className="text-xs text-warning">{t("dashboardCard.returned", { count: returned })}</p>}
          </div>
        )}
        <div className="mt-auto pt-3">
          <CardFooterLink to={returned > 0 && returned === pending ? "/coach/submissions?tab=returned" : "/coach/submissions"}>
            {t("dashboardCard.open")} <ArrowUpRight className="h-3 w-3" />
          </CardFooterLink>
        </div>
      </DashboardCardShell>
    </div>
  );
}
