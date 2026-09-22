import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Loader2, Lock, Check } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeProgress, RawWeek, type TrainingWeekItem } from "@/hooks/dashboard/useProgrammeProgress";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";

export default function TrainingWeeks() {
  const { t, i18n } = useTranslation("training");
  const { user } = useAuth();
  const { summary, loading } = useProgrammeProgress(user?.id);
  const { hasModule } = useProgrammeModules();
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
      <PageHeader
        eyebrow={t("list.eyebrow")}
        title={t("list.titleLead")}
        emphasis={t("list.titleEmphasis")}
        trailing={t("list.titleTrailing")}
        subtitle={t("list.subtitle")}
      />

      {summary.weeks.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">{t("list.empty")}</Card>
      ) : (
        <div className="relative pl-[34px]">
          <div aria-hidden className="absolute bottom-[30px] left-[11px] top-[10px] w-[2px] bg-[#e2dbd0]" />
          {summary.weeks.map((week) => (
            <WeekTimelineCard
              key={week.id}
              week={week}
              isCurrent={week.id === summary.currentWeek?.id}
              isVi={isVi}
              t={t}
              // Every unlocked week (current and earlier) opens its own content.
              // Quizzes are offered when the programme makes them part of the
              // week (learning_components) or runs a Quiz module.
              quizAssignmentId={
                hasModule("quiz") || (summary.itemsByWeek[week.id] ?? []).some((i) => i.item_type === "quizzes")
                  ? summary.quizAssignmentIdByWeek[week.id] ?? null
                  : null
              }
              items={summary.itemsByWeek[week.id] ?? []}
              quizScore={summary.quizScores.find((q) => q.weekNumber === week.week_number)}
              reflectionStreak={summary.reflectionStreak}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WeekTimelineCard({
  week,
  isCurrent,
  isVi,
  t,
  quizAssignmentId,
  quizScore,
  reflectionStreak,
  items,
}: {
  week: RawWeek;
  items: TrainingWeekItem[];
  isCurrent: boolean;
  isVi: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
  quizAssignmentId: string | null;
  quizScore: { weekNumber: number; scorePct: number } | undefined;
  reflectionStreak: number;
}) {
  const requirementState = week.requirement_state && week.requirement_state !== "not_required" ? week.requirement_state : null;
  const title = (isVi && week.title_vi) || week.title;
  const subtitle = (isVi && week.subtitle_vi) || week.subtitle;
  const status = week.locked ? "locked" : week.completed_at ? "completed" : isCurrent ? "current" : week.viewed_at ? "viewed" : "notStarted";

  return (
    <div className="relative mb-3.5">
      <span
        className={cn(
          "absolute -left-[34px] top-[26px] grid h-6 w-6 place-items-center rounded-full border-[3px] border-background text-[10px] font-bold",
          status === "completed" && "bg-success text-white",
          status === "current" && "bg-primary text-secondary",
          (status === "locked" || status === "notStarted" || status === "viewed") && "bg-[#e2dbd0] text-[#8a847d]"
        )}
      >
        {status === "completed" ? <Check className="h-3 w-3" /> : status === "locked" ? <Lock className="h-3 w-3" /> : week.week_number}
      </span>

      <Card
        className={cn(
          "rounded-[20px] border-[#e8e2d8] p-[22px] sm:p-6",
          isCurrent && "border-l-4 border-l-primary",
          week.locked && "opacity-60"
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-[.2em] text-muted-foreground">{t("list.weekN", { n: week.week_number })}</p>
            <h3 className="font-display mt-1.5 text-[20px] font-normal tracking-[-0.02em] sm:text-[22px]">{title}</h3>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.1em]",
              status === "completed" && "bg-[#e8f5ef] text-success",
              status === "current" && "bg-primary text-secondary",
              (status === "locked" || status === "notStarted" || status === "viewed") && "bg-[#f2eee6] text-[#8a847d]"
            )}
          >
            {t(`list.pill.${status}`)}
          </span>
        </div>

        {/* The week's programme requirement: its cohort date and canonical
            state (the same row the Dashboard, checkpoints and Sponsor count). */}
        {week.requirement_due_on && (
          <p data-testid="week-requirement" className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
            <span>{t("list.requirementDue", { date: format(new Date(`${week.requirement_due_on}T00:00:00`), "MMM d, yyyy") })}</span>
            {requirementState && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.08em]",
                  requirementState === "completed" && "bg-[#e8f5ef] text-success",
                  requirementState === "overdue" && "bg-[#fdf4ef] text-[#a8341c]",
                  requirementState === "upcoming" && "bg-[#f2eee6] text-[#8a847d]"
                )}
              >
                {t(`list.requirementState.${requirementState}`)}
              </span>
            )}
          </p>
        )}
        {items.length > 0 && (
          <div data-testid="week-items" className="mt-2 flex flex-wrap gap-1.5">
            {items.map((item) => (
              <span
                key={item.item_type}
                data-testid={`week-item-${item.item_type}`}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[10.5px] font-semibold",
                  item.completed_units >= item.required_units
                    ? "bg-[#e8f5ef] text-success"
                    : item.overdue_units > 0
                      ? "bg-[#fdf4ef] text-[#a8341c]"
                      : "bg-[#f2eee6] text-[#8a847d]"
                )}
              >
                {t(`list.item.${item.item_type}`, { defaultValue: item.item_type })} {item.completed_units}/{item.required_units}
              </span>
            ))}
          </div>
        )}

        {week.locked ? (
          <p className="mt-2 text-xs font-semibold text-muted-foreground">
            {week.effective_unlock_date ? t("list.unlockDate", { date: format(new Date(week.effective_unlock_date), "MMM d, yyyy") }) : t("list.locked")}
          </p>
        ) : (
          <>
            {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={cn("rounded-full px-[11px] py-[5px] text-[10.5px] font-semibold", week.completed_at ? "bg-[#e8f5ef] text-success" : "bg-[#f2eee6] text-[#8a847d]")}>
                {week.completed_at ? t("card.completed") : week.viewed_at ? t("list.viewed") : t("list.notStarted")}
              </span>
              {quizScore && (
                <span className="rounded-full bg-[#e8f5ef] px-[11px] py-[5px] text-[10.5px] font-semibold text-success">
                  {t("assignments.quizScored", { score: Math.round(quizScore.scorePct) })}
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-[#efeae1] pt-4 text-[12.5px]">
              <Link to={`/training/${week.id}`} data-testid="week-skill-card-link" className="font-semibold text-[#2c8fa8] hover:underline">
                {t("progressCard.viewSkillCard")} &rarr;
              </Link>
              {quizAssignmentId && (
                <Link to={`/training/${week.id}/quiz/${quizAssignmentId}`} className="text-muted-foreground hover:text-[#2c8fa8]">
                  {quizScore ? t("assignments.quizScored", { score: Math.round(quizScore.scorePct) }) : t("assignments.quizPending")}
                </Link>
              )}
              {isCurrent && reflectionStreak > 0 && <span className="text-muted-foreground">{t("list.promptStreak", { count: reflectionStreak })}</span>}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
