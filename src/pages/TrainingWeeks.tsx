import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Circle,
  FileText,
  HelpCircle,
  Loader2,
  Lock,
  MessageSquare,
  PenLine,
  type LucideIcon,
} from "lucide-react";
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
  const [expanded, setExpanded] = useState(isCurrent);

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
                  requirementState === "completed_late" && "bg-[#faf0e3] text-[#a8541c]",
                  requirementState === "current" && "bg-[#e4f3f7] text-[#2c8fa8]",
                  requirementState === "overdue" && "bg-[#fdf4ef] text-[#a8341c]",
                  requirementState === "upcoming" && "bg-[#f2eee6] text-[#8a847d]"
                )}
              >
                {t(`list.requirementState.${requirementState}`)}
              </span>
            )}
          </p>
        )}
        {week.locked ? (
          <>
            <p className="mt-2 text-xs font-semibold text-muted-foreground">
              {week.effective_unlock_date ? t("list.unlockDate", { date: format(new Date(week.effective_unlock_date), "MMM d, yyyy") }) : t("list.locked")}
            </p>
            {items.length > 0 && (
              <div className="mt-4 border-t border-[#efeae1] pt-4 text-[12.5px]">
                <ContentToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} t={t} />
              </div>
            )}
          </>
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

            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#efeae1] pt-4 text-[12.5px]">
              <ContentToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} t={t} />
              {isCurrent && reflectionStreak > 0 && <span className="text-muted-foreground">{t("list.promptStreak", { count: reflectionStreak })}</span>}
            </div>
          </>
        )}

        {expanded && (
          <WeekContentList
            week={week}
            items={items}
            quizAssignmentId={quizAssignmentId}
            quizScore={quizScore}
            t={t}
          />
        )}
      </Card>
    </div>
  );
}

function ContentToggle({
  expanded,
  onToggle,
  t,
}: {
  expanded: boolean;
  onToggle: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      data-testid="week-content-toggle"
      className="inline-flex items-center gap-1 font-semibold text-[#2c8fa8] hover:underline"
    >
      {t(expanded ? "list.content.hide" : "list.content.show")}
      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
    </button>
  );
}

const CONTENT_ICON: Record<string, LucideIcon> = {
  skill_cards: FileText,
  quizzes: HelpCircle,
  reflections: PenLine,
  daily_prompts: MessageSquare,
};

type ContentState = "completed" | "notStarted" | "upcoming" | "overdue";

/**
 * A week's content with its own status. Skill Card, Quiz and Reflection make
 * the week complete; Daily Prompts are optional evidence, so they show a count
 * and never read as overdue. A locked week's content is Upcoming whatever its
 * counts say: nothing can be completed before the week opens.
 */
function contentState(item: TrainingWeekItem, locked: boolean): ContentState {
  if (locked) return "upcoming";
  if (item.required_units > 0 && item.completed_units >= item.required_units) return "completed";
  if (item.item_type !== "daily_prompts" && item.overdue_units > 0) return "overdue";
  return "notStarted";
}

const STATE_ICON: Record<ContentState, LucideIcon> = {
  completed: Check,
  notStarted: Circle,
  upcoming: Lock,
  overdue: AlertTriangle,
};

function WeekContentList({
  week,
  items,
  quizAssignmentId,
  quizScore,
  t,
}: {
  week: RawWeek;
  items: TrainingWeekItem[];
  quizAssignmentId: string | null;
  quizScore: { weekNumber: number; scorePct: number } | undefined;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const hrefFor = (type: string): string | null => {
    if (week.locked) return null;
    if (type === "quizzes") return quizAssignmentId ? `/training/${week.id}/quiz/${quizAssignmentId}` : null;
    if (type === "reflections") return `/training/${week.id}/reflect`;
    return `/training/${week.id}`;
  };

  return (
    <ul data-testid="week-content" className="mt-3 divide-y divide-[#efeae1] rounded-2xl border border-[#efeae1] bg-[#faf8f4]">
      {items.length === 0 && !week.locked && (
        <li className="px-4 py-3 text-[12.5px]">
          <Link to={`/training/${week.id}`} data-testid="week-skill-card-link" className="font-semibold text-[#2c8fa8] hover:underline">
            {t("list.content.openWeek")} &rarr;
          </Link>
        </li>
      )}
      {quizAssignmentId && !week.locked && !items.some((i) => i.item_type === "quizzes") && (
        <li className="px-4 py-3 text-[12.5px]">
          <Link to={`/training/${week.id}/quiz/${quizAssignmentId}`} className="font-semibold text-[#2c8fa8] hover:underline">
            {quizScore ? t("assignments.quizScored", { score: Math.round(quizScore.scorePct) }) : t("assignments.takeQuiz")} &rarr;
          </Link>
        </li>
      )}
      {items.map((item) => {
        const state = contentState(item, !!week.locked);
        const optional = item.item_type === "daily_prompts";
        const Icon = CONTENT_ICON[item.item_type] ?? FileText;
        const StateIcon = STATE_ICON[state];
        const href = hrefFor(item.item_type);
        const label = t(`list.item.${item.item_type}`, { defaultValue: item.item_type });
        const statusText =
          optional && state !== "upcoming"
            ? t("list.content.promptsCount", { done: item.completed_units, total: item.required_units })
            : state === "completed" && item.item_type === "quizzes" && quizScore
              ? t("assignments.quizScored", { score: Math.round(quizScore.scorePct) })
              : t(`list.content.state.${state}`);

        return (
          <li
            key={item.item_type}
            data-testid={`week-item-${item.item_type}`}
            data-state={state}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[12.5px]"
          >
            <span className="flex items-center gap-2.5">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              {href ? (
                <Link
                  to={href}
                  data-testid={item.item_type === "skill_cards" ? "week-skill-card-link" : undefined}
                  className="font-semibold text-[#062f3e] hover:text-[#2c8fa8] hover:underline"
                >
                  {label}
                </Link>
              ) : (
                <span className="font-semibold text-[#062f3e]">{label}</span>
              )}
              {optional && (
                <span className="rounded-full bg-[#f2eee6] px-2 py-0.5 text-[10px] font-semibold text-[#8a847d]">
                  {t("list.content.optional")}
                </span>
              )}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[11.5px] font-semibold",
                state === "completed" && "text-success",
                state === "overdue" && "text-[#a8341c]",
                (state === "notStarted" || state === "upcoming") && "text-[#8a847d]"
              )}
            >
              <StateIcon className="h-3.5 w-3.5" />
              {statusText}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
