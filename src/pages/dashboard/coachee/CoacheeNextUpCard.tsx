import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, Clock, Calendar, ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { useEnrollmentActionsSummary } from "@/hooks/dashboard/useEnrollmentActionsSummary";
import { deriveNextUpList, type NextUpItem, type NextUpKind } from "@/lib/nextUp";
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
 * "Next up" — every currently-true candidate from deriveNextUpList
 * (lib/nextUp.ts), capped at 3, in the same priority order deriveNextUp
 * (still used by MyGoalCard's inline hint) picks its single winner from.
 * No second "next up" derivation, no persisted task record, and no
 * fabricated example item when nothing is due.
 */
export function CoacheeNextUpCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const { journey, experience, loading: progressLoading } = useLearnerCanonicalProgress(enrollmentId);
  const actions = useEnrollmentActionsSummary(enrollmentId);

  const loading = enrollmentLoading || progressLoading || actions.loading;

  const nextUpItems: NextUpItem[] = !loading
    ? deriveNextUpList({
        journey,
        learningBreakdown: experience.learningBreakdown,
        overdueActions: actions.overdue,
        nextSessionAt: experience.coachingUtilisation?.next_session_at ?? null,
      })
    : [];

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-lg">{t("coacheeDashboard.nextUp.title")}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("coacheeDashboard.nextUp.subtitle")}</p>
        </div>
        {!loading && nextUpItems.length > 0 && (
          <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-warning">
            {t("coacheeDashboard.nextUp.itemsCount", { count: nextUpItems.length })}
          </span>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="h-16 animate-pulse rounded-xl bg-muted/50" />
        ) : nextUpItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("coacheeDashboard.nextUp.empty")}
          </p>
        ) : (
          nextUpItems.map((item, idx) => {
            const Icon = ICON_BY_KIND[item.kind];
            const isOverdue = item.kind === "overdue_requirement" || item.kind === "overdue_action";
            return (
              <Link
                key={`${item.kind}-${item.label}-${idx}`}
                to={CTA_PATH_BY_KIND[item.kind]}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40"
              >
                <span
                  className={
                    isOverdue
                      ? "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-destructive/15 text-destructive"
                      : "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"
                  }
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold">{item.label}</p>
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {t(`coacheeDashboard.nextUp.kinds.${item.kind}`)}
                    {item.dueOn && ` · ${format(new Date(item.dueOn), "MMM d")}`}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })
        )}
      </div>
    </Card>
  );
}
