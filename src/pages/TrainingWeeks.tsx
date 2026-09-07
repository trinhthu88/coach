import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Loader2, Lock, CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTrainingWeeks, TrainingWeekListItem } from "@/hooks/training/useTrainingWeeks";

export default function TrainingWeeks() {
  const { t, i18n } = useTranslation("training");
  const { weeks, loading } = useTrainingWeeks();
  const isVi = i18n.language?.startsWith("vi");

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader eyebrow={t("list.eyebrow")} title={t("list.title")} trailing="" subtitle={t("list.subtitle")} />

      {weeks.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">{t("list.empty")}</Card>
      ) : (
        <div className="space-y-3">
          {weeks.map((w) => (
            <WeekCard key={w.id} week={w} isVi={isVi} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function WeekCard({
  week,
  isVi,
  t,
}: {
  week: TrainingWeekListItem;
  isVi: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const title = (isVi && week.title_vi) || week.title;
  const subtitle = (isVi && week.subtitle_vi) || week.subtitle;

  if (week.locked) {
    return (
      <Card className="flex flex-wrap items-center gap-4 p-5 opacity-65">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("list.weekN", { n: week.week_number })}
          </p>
        </div>
        <div className="min-w-[220px] flex-1"><h3 className="text-base font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}</div>
        <p className="text-xs font-semibold text-muted-foreground">
          {week.unlock_date ? t("list.unlockDate", { date: format(new Date(week.unlock_date), "MMM d, yyyy") }) : t("list.locked")}
        </p>
      </Card>
    );
  }

  const status = week.completed_at ? "completed" : week.viewed_at ? "viewed" : "notStarted";
  const StatusIcon = week.completed_at ? CheckCircle2 : Circle;

  return (
    <Link to={`/training/${week.id}`} className="group block h-full">
      <Card className="flex flex-wrap items-center gap-4 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
            {t("list.weekN", { n: week.week_number })}
          </p>
          <StatusIcon className={cn("h-4 w-4", week.completed_at ? "text-success" : "text-muted-foreground/50")} />
        </div>
        <div className="min-w-[220px] flex-1"><h3 className="text-base font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}</div>
        {!week.skill_card_visible && (
          <p className="text-[10.5px] font-medium text-muted-foreground">{t("list.skillCardHidden")}</p>
        )}
        <div className="flex min-w-[135px] items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">{t(`list.${status}`)}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-primary">
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Card>
    </Link>
  );
}
