import { useTranslation } from "react-i18next";
import { Users, GraduationCap } from "lucide-react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { ProgrammeInfo } from "@/hooks/journey/types";
import type { CoachSummary } from "@/hooks/journey/useCoachSummaries";
import { ACCENTS, initials } from "./journeyDisplay";

interface ProgrammeWeeks {
  start: Date;
  end: Date;
  totalWeeks: number;
  elapsedWeeks: number;
}

function CoachList({ coachSummaries }: { coachSummaries: CoachSummary[] }) {
  const { t } = useTranslation("journey");
  return (
    <ul className="divide-y">
      {coachSummaries.map((c, i) => {
        const accent = ACCENTS[i % ACCENTS.length];
        const dateRange =
          c.firstDate && c.lastDate ? `${format(c.firstDate, "MMM d")} → ${format(c.lastDate, "MMM d")}` : "—";
        const isCoach = c.sources.has("coaching");
        const isPeer = c.sources.has("peer");
        const tag = isCoach && isPeer ? t("programmeCard.coachPeerTag") : isCoach ? t("programmeCard.coachTag") : t("programmeCard.peerTag");
        return (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold", accent.bg, accent.text)}>
              {initials(c.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{c.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {t("programmeCard.sessionsCompletedOf", { completed: c.completed, total: c.total })}
                {c.nextDate ? t("programmeCard.nextDateSuffix", { date: format(c.nextDate, "MMM d, p") }) : ""}
              </p>
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                isCoach && isPeer ? "bg-warning/15 text-warning" : isCoach ? "bg-primary/15 text-primary" : "bg-success/15 text-success"
              )}
            >
              {tag}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{dateRange}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The coach's own journey programme summary card (or, absent an active
 * programme, a plain coach list) — tags rows Coach/Peer/Coach + Peer since
 * this page mixes coaching and peer sessions. Not shared with
 * CoacheeJourney, whose equivalent card tags rows Lead coach/Specialist.
 */
export function CoachProgrammeCard({
  programme,
  programmeWeeks,
  coachSummaries,
  coaching,
  avgGoalProgress,
}: {
  programme: ProgrammeInfo | null;
  programmeWeeks: ProgrammeWeeks | null;
  coachSummaries: CoachSummary[];
  /**
   * Canonical Coaching programme progress.
   *   object     the canonical figures
   *   null       Coaching is not a required module of this programme
   *   undefined  canonical progress has not loaded (or failed to)
   * Nothing else may answer these numbers.
   */
  coaching?: {
    requiredUnits: number;
    completedUnits: number;
    bookedUnits: number;
    overdueUnits: number;
    postSessionPending: number;
  } | null;
  avgGoalProgress: number | null;
}) {
  const { t } = useTranslation("journey");
  if (!programme) {
    return coachSummaries.length > 0 ? (
      <Card className="overflow-hidden">
        <div className="border-b bg-muted/30 px-4 py-2.5">
          <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> {t("programmeCard.coachesInProgramme")}
          </p>
        </div>
        <CoachList coachSummaries={coachSummaries} />
      </Card>
    ) : null;
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{t("programmeCard.programme")}</p>
            <p className="text-base font-semibold leading-tight">{programme.programmeName}</p>
            <p className="text-[11px] text-muted-foreground">
              {programme.startDate ? format(new Date(programme.startDate), "MMM d, yyyy") : "—"}
              {" → "}
              {programme.endDate
                ? format(new Date(programme.endDate), "MMM d, yyyy")
                : programmeWeeks
                ? format(programmeWeeks.end, "MMM d, yyyy")
                : "—"}
            </p>
          </div>
        </div>
        {programmeWeeks && (
          <span className="inline-flex items-center rounded-full bg-secondary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-secondary">
            {t("programmeCard.weekOf", { current: Math.min(programmeWeeks.elapsedWeeks + 1, programmeWeeks.totalWeeks), total: programmeWeeks.totalWeeks })}
          </span>
        )}
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-3">
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("programmeCard.sessionsReceived")}</p>
          {/* Canonical Coaching units, or nothing. A session that has been
              held but whose post-session evidence is outstanding counts as
              booked, not completed, so this can read lower than the number of
              sessions that took place.

              There is deliberately no fallback. This tile used to fall back to
              a raw completed-session count over programmes.coachee_session_limit
              when canonical progress was absent -- a second answer to a
              programme question, produced in the browser, that disagreed with
              every other surface. Absent canonical progress now means one of
              two honest states: Coaching is not a requirement of this
              programme (null), or the figures could not be loaded
              (undefined). */}
          {coaching ? (
            <>
              <p className="mt-1 text-xl font-semibold">
                {coaching.completedUnits}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}/ {coaching.requiredUnits}
                </span>
              </p>
              <Progress
                value={
                  coaching.requiredUnits
                    ? Math.min(100, (coaching.completedUnits / coaching.requiredUnits) * 100)
                    : 0
                }
                className="mt-2 h-1.5"
              />
            </>
          ) : coaching === null ? (
            <p className="mt-1 text-sm text-muted-foreground" data-testid="coaching-not-required">
              {t("programmeCard.coachingNotRequired")}
            </p>
          ) : (
            <div data-testid="coaching-progress-unavailable">
              <p className="mt-1 text-sm font-semibold text-warning">
                {t("programmeCard.progressUnavailable")}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t("programmeCard.progressUnavailableHint")}
              </p>
            </div>
          )}
          {coaching && coaching.postSessionPending > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("programmeCard.postSessionPending", { n: coaching.postSessionPending })}
            </p>
          )}
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("programmeCard.programmeDuration")}</p>
          <p className="mt-1 text-xl font-semibold">
            {programmeWeeks ? t("programmeCard.weeksValue", { n: programmeWeeks.elapsedWeeks }) : "—"}
            <span className="text-sm font-normal text-muted-foreground"> / {programmeWeeks ? t("programmeCard.weeksValue", { n: programmeWeeks.totalWeeks }) : "—"}</span>
          </p>
          <Progress
            value={programmeWeeks ? Math.min(100, (programmeWeeks.elapsedWeeks / programmeWeeks.totalWeeks) * 100) : 0}
            className="mt-2 h-1.5"
          />
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("programmeCard.goalProgress")}</p>
          <p className="mt-1 text-xl font-semibold text-primary">{avgGoalProgress == null ? "—" : `${avgGoalProgress}%`}</p>
          <Progress value={avgGoalProgress ?? 0} className="mt-2 h-1.5" />
        </div>
      </div>

      {coachSummaries.length > 0 && (
        <div className="border-t">
          <div className="border-b bg-muted/20 px-4 py-2">
            <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> {t("programmeCard.coachesInProgramme")}
            </p>
          </div>
          <CoachList coachSummaries={coachSummaries} />
        </div>
      )}
    </Card>
  );
}
