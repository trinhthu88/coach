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

function CoachList({ coachSummaries, showDateRange }: { coachSummaries: CoachSummary[]; showDateRange: boolean }) {
  return (
    <ul className="divide-y">
      {coachSummaries.map((c, i) => {
        const accent = ACCENTS[i % ACCENTS.length];
        const lead = i === 0;
        const dateRange =
          c.firstDate && c.lastDate ? `${format(c.firstDate, "MMM d")} → ${format(c.lastDate, "MMM d")}` : "—";
        return (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold", accent.bg, accent.text)}>
              {initials(c.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{c.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {c.completed}/{c.total} sessions completed
                {showDateRange && c.nextDate ? ` · Next ${format(c.nextDate, "MMM d, p")}` : ""}
              </p>
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                lead ? "bg-primary/15 text-primary" : "bg-success/15 text-success"
              )}
            >
              {lead ? "Lead coach" : "Specialist"}
            </span>
            {showDateRange && <span className="shrink-0 text-[11px] text-muted-foreground">{dateRange}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The coachee journey's programme summary card (or, absent an active
 * programme, a plain coach list). Not shared with CoachMyJourney — that
 * page tags coach-list rows by session source (Coach/Peer) rather than
 * lead/specialist, so its equivalent card lives separately.
 */
export function CoacheeProgrammeCard({
  programme,
  programmeWeeks,
  coachSummaries,
  sessionsCompletedCount,
  avgGoalProgress,
}: {
  programme: ProgrammeInfo | null;
  programmeWeeks: ProgrammeWeeks | null;
  coachSummaries: CoachSummary[];
  sessionsCompletedCount: number;
  avgGoalProgress: number;
}) {
  if (!programme) {
    return coachSummaries.length > 0 ? (
      <Card className="overflow-hidden">
        <div className="border-b bg-muted/30 px-4 py-2.5">
          <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Coaches in this programme
          </p>
        </div>
        <CoachList coachSummaries={coachSummaries} showDateRange={false} />
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
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Programme</p>
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
            Week {Math.min(programmeWeeks.elapsedWeeks + 1, programmeWeeks.totalWeeks)} / {programmeWeeks.totalWeeks}
          </span>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid gap-3 p-4 md:grid-cols-3">
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Sessions received</p>
          <p className="mt-1 text-xl font-semibold">
            {sessionsCompletedCount}
            <span className="text-sm font-normal text-muted-foreground"> / {programme.sessionsAllowed || "—"}</span>
          </p>
          <Progress
            value={programme.sessionsAllowed ? Math.min(100, (sessionsCompletedCount / programme.sessionsAllowed) * 100) : 0}
            className="mt-2 h-1.5"
          />
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Programme duration</p>
          <p className="mt-1 text-xl font-semibold">
            {programmeWeeks ? `${programmeWeeks.elapsedWeeks}w` : "—"}
            <span className="text-sm font-normal text-muted-foreground"> / {programmeWeeks?.totalWeeks ?? "—"}w</span>
          </p>
          <Progress
            value={programmeWeeks ? Math.min(100, (programmeWeeks.elapsedWeeks / programmeWeeks.totalWeeks) * 100) : 0}
            className="mt-2 h-1.5"
          />
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Goal progress</p>
          <p className="mt-1 text-xl font-semibold text-primary">{avgGoalProgress}%</p>
          <Progress value={avgGoalProgress} className="mt-2 h-1.5" />
        </div>
      </div>

      {/* Coach row with role badges */}
      {coachSummaries.length > 0 && (
        <div className="border-t">
          <div className="border-b bg-muted/20 px-4 py-2">
            <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Assigned coaches
            </p>
          </div>
          <CoachList coachSummaries={coachSummaries} showDateRange />
        </div>
      )}
    </Card>
  );
}
