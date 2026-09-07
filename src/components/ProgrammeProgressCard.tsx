import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { GraduationCap, Sparkles, HelpCircle, Triangle, BookOpen, ClipboardList, Users2, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useProgrammeProgress } from "@/hooks/dashboard/useProgrammeProgress";
import { useJourneyProgramme } from "@/hooks/journey/useJourneyProgramme";
import { useJourneyGoals } from "@/hooks/journey/useJourneyGoals";
import { DailyPromptCard } from "@/components/training/DailyPromptCard";

/**
 * "My Programme Progress" dashboard widget — shared between the coach and
 * coachee dashboards. Absorbs the "this week's skill card" action, the daily
 * nudge (DailyPromptCard), and a goals summary, so it's the dashboard's one
 * training-programme surface. Gated on hasModule('training') because
 * get_my_training_weeks() (which everything here hangs off) already returns
 * nothing without it; the quiz/triad/daily-prompt sub-sections each
 * additionally check their own module.
 */
export function ProgrammeProgressCard() {
  const { t } = useTranslation("training");
  const { user, role } = useAuth();
  const { hasModule, hasDirection, loading: modulesLoading } = useProgrammeModules();
  const { summary, loading } = useProgrammeProgress(user?.id);
  const receiveEnabled = hasDirection("coaching", "receive");
  const { programme } = useJourneyProgramme(user?.id);
  const { goals } = useJourneyGoals(receiveEnabled ? user?.id : undefined);

  if (modulesLoading || !hasModule("training")) return null;

  if (loading) {
    return (
      <Card className="rounded-[24px] border-[#e8e2d8] p-[26px]">
        <div className="h-24 animate-pulse rounded-lg bg-muted/50" />
      </Card>
    );
  }

  if (summary.weeksTotal === 0) return null;

  const showQuiz = hasModule("quiz") && summary.quizScores.length > 0;
  const showTriads = hasModule("triads");
  const showStreak = hasModule("daily_prompt");
  const journeyPath = role === "coach" ? "/coach/my-journey" : "/coachee/journey";

  const currentWeekQuizDone =
    summary.currentWeek && summary.quizScores.some((q) => q.weekNumber === summary.currentWeek!.week_number);
  const activeGoals = goals.filter((g) => g.status === "active");

  return (
    <Card className="rounded-[24px] border-[#e8e2d8] p-5 shadow-[0_14px_40px_-30px_rgba(6,47,62,0.5)] sm:p-[26px]">
      {/* Programme header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-[.24em] text-muted-foreground">{t("progressCard.eyebrow")}</p>
          <h2 className="font-display mt-2 text-[22px] font-normal tracking-[-0.02em] sm:text-[27px]">
            {programme?.programmeName ?? t("progressCard.defaultProgrammeName")}
          </h2>
        </div>
        {summary.currentWeek && (
          <div className="text-right">
            <p className="text-[11px] font-semibold text-muted-foreground">
              {t("progressCard.weekOfTotal", { week: summary.currentWeek.week_number, total: summary.weeksTotal })}
              {programme?.endDate && ` · ${t("progressCard.endsOn", { date: format(new Date(programme.endDate), "MMM d") })}`}
            </p>
            <div className="mt-2 grid gap-[5px]" style={{ gridTemplateColumns: `repeat(${summary.weeksTotal}, minmax(18px, 1fr))` }}>
              {summary.weeks.map((w) => (
                <span key={w.id} className={cn("h-[7px] rounded-full", w.completed_at ? "bg-primary" : "bg-[#e2dbd0]")} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Module stat cards */}
      <div className="mt-[22px] grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          icon={GraduationCap}
          label={t("progressCard.skillsCompleted")}
          value={`${summary.weeksCompleted}/${summary.weeksTotal}`}
          pct={summary.weeksTotal > 0 ? (summary.weeksCompleted / summary.weeksTotal) * 100 : 0}
        />
        {showStreak && (
          <Stat
            icon={Sparkles}
            label={t("progressCard.reflectionStreak")}
            value={String(summary.reflectionStreak)}
            pct={Math.min(100, (summary.reflectionStreak / 7) * 100)}
          />
        )}
        {showQuiz && (
          <Stat
            icon={HelpCircle}
            label={t("progressCard.quizAvg")}
            value={summary.quizAvg != null ? `${Math.round(summary.quizAvg)}%` : "—"}
            pct={summary.quizAvg ?? 0}
          />
        )}
        {showTriads && (
          <Stat
            icon={Triangle}
            label={t("progressCard.triadSessions")}
            value={String(summary.triadCompletedCount)}
            sub={
              summary.nextTriadDate
                ? t("progressCard.nextTriadOn", { date: format(new Date(summary.nextTriadDate), "MMM d") })
                : t("progressCard.noTriadScheduled")
            }
          />
        )}
      </div>

      {showQuiz && (
        <div className="mt-4 border-t border-[#efeae1] pt-4">
          <p className="mb-2 text-[9px] font-bold uppercase tracking-[.2em] text-muted-foreground">{t("progressCard.quizScoresPerWeek")}</p>
          <div className="flex flex-wrap gap-2">
            {summary.quizScores.map((q) => (
              <span key={q.weekNumber} className="rounded-full bg-[#f2eee6] px-[11px] py-[5px] text-[11px] font-semibold text-[#4a463f]">
                {t("progressCard.weekScorePill", { n: q.weekNumber, score: Math.round(q.scorePct) })}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Daily nudge */}
      {showStreak && (
        <div className="mt-5">
          <DailyPromptCard />
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-5 flex flex-wrap gap-2.5">
        {summary.currentWeek && (
          <GhostAction to={`/training/${summary.currentWeek.id}`} icon={BookOpen}>
            {t("progressCard.viewSkillCard")}
          </GhostAction>
        )}
        {hasModule("quiz") && summary.currentQuizAssignmentId && summary.currentWeek && (
          <GhostAction to={`/training/${summary.currentWeek.id}/quiz/${summary.currentQuizAssignmentId}`} icon={ClipboardList}>
            {currentWeekQuizDone ? t("assignments.viewResults") : t("progressCard.takeQuiz")}
          </GhostAction>
        )}
        {showTriads && (
          <GhostAction to="/triads" icon={Users2}>
            {t("progressCard.triadReflectionAction")}
          </GhostAction>
        )}
      </div>

      {/* Goals mini-section */}
      {receiveEnabled && (
        <div className="mt-5">
          <p className="text-[9.5px] font-bold uppercase tracking-[.24em] text-muted-foreground">{t("progressCard.goalsLabel")}</p>
          <Link
            to={journeyPath}
            className="mt-2 block rounded-[20px] border border-[#e8e2d8] bg-card px-[22px] py-[18px] text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40"
          >
            {activeGoals.length > 0
              ? t("progressCard.goalsSummary", { count: activeGoals.length })
              : t("progressCard.goalsSummaryEmpty")}
          </Link>
        </div>
      )}
    </Card>
  );
}

function GhostAction({ to, icon: Icon, children }: { to: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-[18px] py-[11px] text-xs font-semibold transition-colors hover:border-primary hover:text-[#2c8fa8]"
    >
      <Icon className="h-3.5 w-3.5" /> {children}
    </Link>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  pct,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  pct?: number;
}) {
  return (
    <div className="rounded-2xl border border-[#efeae1] bg-[#faf8f4] p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-primary-soft text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <p className="truncate text-2xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      </div>
      <p className="font-display mt-3 text-xl font-semibold leading-none">{value}</p>
      <p className="mt-1 min-h-[15px] text-[11px] text-muted-foreground">{sub}</p>
      {pct != null && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full bg-primary")} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
      )}
    </div>
  );
}
