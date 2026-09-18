import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, Clock, Calendar, ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { useEnrollmentActionsSummary } from "@/hooks/dashboard/useEnrollmentActionsSummary";
import { deriveNextUp, type NextUpKind } from "@/lib/nextUp";
import { Card } from "@/components/ui/card";

const ICON_BY_KIND: Record<NextUpKind, typeof AlertTriangle> = {
  overdue_requirement: AlertTriangle,
  overdue_action: AlertTriangle,
  current_requirement: Clock,
  upcoming_session: Calendar,
  upcoming_requirement: Calendar,
};

const CTA_PATH_BY_KIND: Record<NextUpKind, string> = {
  overdue_requirement: "/coachee/journey",
  overdue_action: "/coachee/journey",
  current_requirement: "/coachee/journey",
  upcoming_session: "/sessions",
  upcoming_requirement: "/coachee/journey",
};

/**
 * "Next up" — the deterministic single highest-priority item from
 * deriveNextUp (lib/nextUp.ts), the same priority ordering already used
 * inside MyGoalCard. No second "next up" derivation, no persisted task
 * record, and no fabricated example item when nothing is due.
 */
export function CoacheeNextUpCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const { journey, experience, loading: progressLoading } = useLearnerCanonicalProgress(enrollmentId);
  const actions = useEnrollmentActionsSummary(enrollmentId);

  const loading = enrollmentLoading || progressLoading || actions.loading;

  const nextUp = !loading
    ? deriveNextUp({
        journey,
        learningBreakdown: experience.learningBreakdown,
        overdueActions: actions.overdue,
        nextSessionAt: experience.coachingUtilisation?.next_session_at ?? null,
      })
    : null;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-lg">{t("coacheeDashboard.nextUp.title")}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("coacheeDashboard.nextUp.subtitle")}</p>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="h-16 animate-pulse rounded-xl bg-muted/50" />
        ) : !nextUp ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("coacheeDashboard.nextUp.empty")}
          </p>
        ) : (
          <Link
            to={CTA_PATH_BY_KIND[nextUp.kind]}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40"
          >
            <span
              className={
                nextUp.kind === "overdue_requirement" || nextUp.kind === "overdue_action"
                  ? "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-destructive/15 text-destructive"
                  : "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"
              }
            >
              {(() => {
                const Icon = ICON_BY_KIND[nextUp.kind];
                return <Icon className="h-4 w-4" />;
              })()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold">{nextUp.label}</p>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                {t(`coacheeDashboard.nextUp.kinds.${nextUp.kind}`)}
                {nextUp.dueOn && ` · ${format(new Date(nextUp.dueOn), "MMM d")}`}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        )}
      </div>
    </Card>
  );
}
