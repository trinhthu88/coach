import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Sparkles, HelpCircle, BookOpen, ClipboardList, Users2, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useEnrollmentProgress, type EnrollmentProgressModule } from "@/hooks/useEnrollmentProgress";
import { useProgrammeProgress } from "@/hooks/dashboard/useProgrammeProgress";
import { useJourneyProgramme } from "@/hooks/journey/useJourneyProgramme";
import { useJourneyGoals } from "@/hooks/journey/useJourneyGoals";
import { DailyPromptCard } from "@/components/training/DailyPromptCard";

export function ProgrammeProgressCard() {
  const { t } = useTranslation("training");
  const { user, role } = useAuth();
  const { hasModule, hasDirection, loading: modulesLoading } = useProgrammeModules();
  const { enrollmentId, summary, loading: trainingLoading } = useProgrammeProgress(user?.id);
  const { modules: moduleProgress, loading: progressLoading, error: progressError } = useEnrollmentProgress(enrollmentId);
  const receiveEnabled = hasDirection("coaching", "receive");
  const { programme } = useJourneyProgramme(user?.id);
  const { goals } = useJourneyGoals(user?.id);

  if (modulesLoading || trainingLoading || progressLoading) {
    return (
      <Card className="rounded-[24px] border-[#e8e2d8] p-[26px]">
        <div className="h-24 animate-pulse rounded-lg bg-muted/50" />
      </Card>
    );
  }

  if (progressError) {
    return (
      <Card className="rounded-[24px] border-[#e8e2d8] p-[26px] text-sm text-muted-foreground">
        {t("progressCard.loadError")}
      </Card>
    );
  }

  if (!enrollmentId) {
    return (
      <Card className="rounded-[24px] border-[#e8e2d8] p-[26px] text-sm text-muted-foreground">
        {t("progressCard.enrollmentRequired")}
      </Card>
    );
  }

  if (moduleProgress.length === 0) return null;

  const hasTrainingContent = hasModule("training") && summary.weeksTotal > 0;
  const showQuiz = hasTrainingContent && hasModule("quiz") && summary.quizScores.length > 0;
  const showTriads = hasModule("triads");
  const showStreak = hasTrainingContent && hasModule("daily_prompt");
  const journeyPath = role === "coach" ? "/coach/my-journey" : "/coachee/journey";
  const currentWeekQuizDone =
    summary.currentWeek && summary.quizScores.some((q) => q.weekNumber === summary.currentWeek!.week_number);
  const activeGoals = goals.filter((g) => g.status === "active");

  return (
    <Card className="rounded-[24px] border-[#e8e2d8] p-5 shadow-[0_14px_40px_-30px_rgba(6,47,62,0.5)] sm:p-[26px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-[.24em] text-muted-foreground">{t("progressCard.eyebrow")}</p>
          <h2 className="font-display mt-2 text-[22px] font-normal tracking-[-0.02em] sm:text-[27px]">
            {programme?.programmeName ?? t("progressCard.defaultProgrammeName")}
          </h2>
        </div>
        {hasTrainingContent && summary.currentWeek && (
          <div className="text-right">
            <p className="text-[11px] font-semibold text-muted-foreground">
              {t("progressCard.weekOfTotal", { week: summary.currentWeek.week_number, total: summary.weeksTotal })}
              {programme?.endDate && ` · ${t("progressCard.endsOn", { date: format(new Date(programme.endDate), "MMM d") })}`}
            </p>
            <div className="mt-2 grid gap-[5px]" style={{ gridTemplateColumns: `repeat(${summary.weeksTotal}, minmax(18px, 1fr))` }}>
              {summary.weeks.map((week) => (
                <span key={week.id} className={cn("h-[7px] rounded-full", week.completed_at ? "bg-primary" : "bg-[#e2dbd0]")} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-[22px] grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {moduleProgress.map((progress) => (
          <ModuleProgressStat key={progress.module} progress={progress} t={t} />
        ))}
      </div>

      {(showStreak || showQuiz) && (
        <div className="mt-5 border-t border-[#efeae1] pt-5">
          <p className="mb-3 text-[9.5px] font-bold uppercase tracking-[.24em] text-muted-foreground">
            {t("progressCard.trainingActivity")}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            {showStreak && (
              <Stat
                icon={Sparkles}
                label={t("progressCard.reflectionStreak")}
                value={String(summary.reflectionStreak)}
              />
            )}
            {showQuiz && (
              <Stat
                icon={HelpCircle}
                label={t("progressCard.quizAvg")}
                value={summary.quizAvg != null ? `${Math.round(summary.quizAvg)}%` : "—"}
              />
            )}
          </div>
        </div>
      )}

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

      {showStreak && (
        <div className="mt-5">
          <DailyPromptCard />
        </div>
      )}

      {(hasTrainingContent || showTriads) && (
        <div className="mt-5 flex flex-wrap gap-2.5">
          {hasTrainingContent && summary.currentWeek && (
            <GhostAction to={`/training/${summary.currentWeek.id}`} icon={BookOpen}>
              {t("progressCard.viewSkillCard")}
            </GhostAction>
          )}
          {hasTrainingContent && hasModule("quiz") && summary.currentQuizAssignmentId && summary.currentWeek && (
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
      )}

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

function ModuleProgressStat({
  progress,
  t,
}: {
  progress: EnrollmentProgressModule;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const completion = progress.full_completion_pct;
  const due = progress.due_adherence_pct;

  return (
    <div className="rounded-2xl border border-[#efeae1] bg-[#faf8f4] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {t(`progressCard.modules.${progress.module}`)}
        </p>
        <span className="rounded-full bg-primary-soft px-2 py-1 text-[10px] font-semibold text-primary">
          {t(`progressCard.pace.${progress.pace_status}`)}
        </span>
      </div>
      <p className="font-display mt-3 text-2xl font-semibold leading-none">
        {completion == null ? "—" : `${Math.round(completion)}%`}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {progress.required_units > 0
          ? t("progressCard.completedUnits", { completed: progress.completed_units, required: progress.required_units })
          : t("progressCard.completedUnitsNoRequirement", { completed: progress.completed_units })}
      </p>
      {due != null && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("progressCard.dueAdherence", { pct: Math.round(due), due: progress.due_units })}
        </p>
      )}
      {completion != null && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, completion))}%` }} />
        </div>
      )}
    </div>
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

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#efeae1] bg-[#faf8f4] p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-primary-soft text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <p className="truncate text-2xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      </div>
      <p className="font-display mt-3 text-xl font-semibold leading-none">{value}</p>
    </div>
  );
}
