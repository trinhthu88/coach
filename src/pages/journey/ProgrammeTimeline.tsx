import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Lock, MessageSquareText, Users2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useProgrammeTimeline, type TimelineWeek } from "@/hooks/journey/useProgrammeTimeline";

function MiniBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold",
        ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
      )}
    >
      {ok && <CheckCircle2 className="h-2.5 w-2.5" />} {label}
    </span>
  );
}

function WeekCard({ week }: { week: TimelineWeek }) {
  const { t, i18n } = useTranslation("journey");
  const isVi = i18n.language?.startsWith("vi");
  const title = (isVi && week.titleVi) || week.title;

  const card = (
    <Card
      className={cn(
        "flex w-52 shrink-0 flex-col gap-2 p-3.5 transition-colors",
        week.status === "current" && "border-primary shadow-glow",
        week.status === "locked" && "opacity-60"
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("programmeTimeline.weekN", { n: week.weekNumber })}
        </p>
        {week.status === "locked" ? (
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        ) : week.status === "completed" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        ) : week.status === "current" ? (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-primary-foreground">
            {t("programmeTimeline.current")}
          </span>
        ) : null}
      </div>
      <p className="line-clamp-2 text-sm font-semibold leading-tight">{title}</p>

      {week.status !== "locked" && (
        <div className="flex flex-wrap gap-1">
          <MiniBadge ok={!!week.viewedAt} label={t("programmeTimeline.skillCardViewed")} />
          {week.quiz.total > 0 && (
            <MiniBadge
              ok={week.quiz.submitted > 0}
              label={week.quiz.submitted > 0 && week.quiz.scorePct != null ? t("programmeTimeline.quizScore", { score: Math.round(week.quiz.scorePct) }) : t("programmeTimeline.quizPending")}
            />
          )}
          {week.reflection.total > 0 && (
            <MiniBadge ok={week.reflection.submitted > 0} label={week.reflection.submitted > 0 ? t("programmeTimeline.reflectionSubmitted") : t("programmeTimeline.reflectionPending")} />
          )}
          {week.promptStreak.total > 0 && (
            <MiniBadge
              ok={week.promptStreak.done === week.promptStreak.total}
              label={t("programmeTimeline.promptStreak", { done: week.promptStreak.done, total: week.promptStreak.total })}
            />
          )}
          {week.triadStatus && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">
              <Users2 className="h-2.5 w-2.5" />
              {t(`programmeTimeline.triad${week.triadStatus === "completed" ? "Completed" : week.triadStatus === "scheduled" ? "Scheduled" : "NotScheduled"}`)}
            </span>
          )}
        </div>
      )}
    </Card>
  );

  if (week.status === "locked") return card;
  return (
    <Link to={`/training/${week.id}`} className="focus:outline-none">
      {card}
    </Link>
  );
}

export function ProgrammeTimeline() {
  const { t } = useTranslation("journey");
  const { user } = useAuth();
  const { hasModule, loading: modulesLoading } = useProgrammeModules();
  const { weeks, loading } = useProgrammeTimeline(user?.id);

  if (modulesLoading || !hasModule("training") || loading || weeks.length === 0) return null;

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        <MessageSquareText className="h-3.5 w-3.5" /> {t("programmeTimeline.heading")}
      </p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {weeks.map((w) => (
          <WeekCard key={w.id} week={w} />
        ))}
      </div>
    </div>
  );
}
