import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { Card } from "@/components/ui/card";

/**
 * Module progress — one row per module returned by
 * learner_canonical_module_progress, i.e. only modules actually configured
 * for this enrollment. A module with zero configured requirement never
 * appears here (no "0/0" rows).
 */
export function CoacheeModuleProgressCard() {
  const { t } = useTranslation("dashboard");
  const { t: tTraining } = useTranslation("training");
  const { user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const { modules, loading: progressLoading } = useLearnerCanonicalProgress(enrollmentId);
  const loading = enrollmentLoading || progressLoading;

  return (
    <Card className="p-5">
      <p className="font-display text-lg">{t("coacheeDashboard.moduleProgress.title")}</p>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t("coacheeDashboard.moduleProgress.subtitle")}</p>

      {loading ? (
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-muted/50" />
      ) : modules.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("coacheeDashboard.moduleProgress.empty")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {modules.map((m) => (
            <div key={m.module} className="flex items-center gap-3">
              <p className="w-[140px] shrink-0 truncate text-[11.5px] font-semibold">
                {tTraining(`progressCard.modules.${m.module}`, { defaultValue: m.module })}
              </p>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(0, Math.min(100, m.full_completion_pct ?? 0))}%` }}
                />
              </div>
              <p className="w-14 shrink-0 text-right font-display text-sm">
                {m.completed_units}/{m.required_units}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
