import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, GraduationCap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useTrainingWeeks } from "@/hooks/training/useTrainingWeeks";

/**
 * "This week's skill card" dashboard widget — shared between the coach and
 * coachee dashboards. Renders nothing while loading or when the active
 * programme doesn't have the training module enabled, so it's safe to drop
 * into either dashboard unconditionally.
 */
export function ThisWeekSkillCard() {
  const { t, i18n } = useTranslation("training");
  const { hasModule, loading: modulesLoading } = useProgrammeModules();
  const { currentWeek, loading: weeksLoading } = useTrainingWeeks();
  const isVi = i18n.language?.startsWith("vi");

  if (modulesLoading || !hasModule("training")) return null;

  const title = currentWeek ? (isVi && currentWeek.title_vi) || currentWeek.title : null;
  const subtitle = currentWeek ? (isVi && currentWeek.subtitle_vi) || currentWeek.subtitle : null;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <GraduationCap className="h-4 w-4 text-primary" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{t("dashboardCard.eyebrow")}</p>
      </div>
      {weeksLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
      ) : !currentWeek ? (
        <p className="text-sm text-muted-foreground">{t("dashboardCard.empty")}</p>
      ) : (
        <>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{subtitle}</p>}
          <Button asChild size="sm" className="mt-4">
            <Link to={`/training/${currentWeek.id}`}>
              {t("dashboardCard.cta")} <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </>
      )}
    </Card>
  );
}
