import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { CheckCircle2, Circle, AlertTriangle, MapPin, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { moduleLabel } from "./sponsorUtils";
import type { SponsorCadenceItem } from "@/hooks/sponsor/useSponsorCohortData";
import type { SponsorLeaderCadenceItem } from "@/hooks/sponsor/useSponsorLeaderDetail";

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Cohort-level Programme Cadence visual (spec section C). One node per
 * configured cadence item (module + sequence), ordered by due date, showing
 * this cohort's completion rate for that specific item -- never a generic
 * whole-programme percentage. Items whose due date hasn't arrived read
 * "Upcoming", never "0%" (spec C1/Rule 3).
 */
export function CohortCadenceMap({ items }: { items: SponsorCadenceItem[] }) {
  const { t } = useTranslation("sponsor");
  const today = todayIso();

  const { sorted, next } = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.due_on.localeCompare(b.due_on));
    const upcoming = sorted.find((i) => i.due_on > today);
    return { sorted, next: upcoming };
  }, [items, today]);

  const grouped = useMemo(() => {
    const firstDate = sorted[0]?.due_on;
    if (!firstDate) return [];
    const groups = new Map<number, SponsorCadenceItem[]>();
    for (const item of sorted) {
      const week = Math.floor((new Date(`${item.due_on}T00:00:00`).getTime() - new Date(`${firstDate}T00:00:00`).getTime()) / 604800000) + 1;
      groups.set(week, [...(groups.get(week) ?? []), item]);
    }
    return Array.from(groups.entries());
  }, [sorted]);

  const activityTypeSummary = useMemo(() => {
    const byModule = new Map<string, { applies: number; completed: number }>();
    for (const item of items) {
      if (item.due_on > today) continue;
      const agg = byModule.get(item.module) ?? { applies: 0, completed: 0 };
      agg.applies += item.applies_count;
      agg.completed += item.completed_count;
      byModule.set(item.module, agg);
    }
    return Array.from(byModule.entries()).map(([module, agg]) => ({
      module,
      pct: agg.applies > 0 ? Math.round((agg.completed / agg.applies) * 100) : null,
    }));
  }, [items, today]);

  if (items.length === 0) {
    return <p className="py-6 text-center text-[12px] italic text-muted-foreground">{t("cohortDetail.cadenceMap.empty")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-start gap-6">
          {grouped.map(([week, weekItems]) => (
            <div key={week} className="space-y-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("cohortDetail.cadenceMap.week", { week })}</p>
              <div className="flex items-stretch gap-0">
                {weekItems.map((item, idx) => {
                  const isPast = item.due_on <= today;
                  const isNext = item === next;
                  const pct = isPast && item.applies_count > 0 ? Math.round((item.completed_count / item.applies_count) * 100) : null;
                  return (
                    <div key={`${item.module}-${item.sequence}`} className="flex items-stretch">
                      {idx > 0 && <div className="mt-6 h-px w-5 shrink-0 self-start bg-border" />}
                      <div className="relative w-32 shrink-0 rounded-xl px-1 text-center">
                        {isNext && (
                          <div className="absolute -top-5 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-primary">
                            <MapPin className="h-3 w-3" /> {t("cohortDetail.cadenceMap.youAreHere")}
                          </div>
                        )}
                        <div
                          className={cn(
                            "mx-auto grid h-9 w-9 place-items-center rounded-full border-2",
                            isNext ? "border-primary bg-primary-soft" : isPast ? "border-success/60 bg-success/10" : "border-border bg-muted/40"
                          )}
                          aria-label={isPast ? t("cohortDetail.cadenceMap.completedState") : t("cohortDetail.cadenceMap.upcoming")}
                        >
                          {isPast ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Clock3 className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <p className="mt-1.5 truncate text-[10.5px] font-semibold">{moduleLabel(item.module)} {item.sequence}</p>
                        <p className="text-[9.5px] text-muted-foreground">{format(new Date(item.due_on), "MMM d")}</p>
                        <p className={cn("mt-0.5 text-[10.5px] font-bold", pct != null && pct < 70 ? "text-warning" : "text-foreground")}>
                          {pct != null ? `${pct}% · ${item.completed_count}/${item.applies_count}` : t("cohortDetail.cadenceMap.upcoming")}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {next && (
        <p className="text-[11px] text-muted-foreground">
          {t("cohortDetail.cadenceMap.nextCheckpoint")}: <span className="font-semibold text-foreground">{moduleLabel(next.module)} {next.sequence}</span> · {format(new Date(next.due_on), "MMM d, yyyy")}
        </p>
      )}

      {activityTypeSummary.length > 0 && (
        <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
           {activityTypeSummary.map((row) => (
            <div key={row.module} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-[11px]">
              <span className="text-muted-foreground">{moduleLabel(row.module)}</span>
              <span className="font-semibold">{row.pct == null ? t("cohortDetail.cadenceMap.notDueYet") : `${row.pct}%`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type JourneyState = "completed" | "current" | "overdue" | "upcoming";

/** Exported for unit testing (spec section 7's item-state rules) — see CadenceVisual.test.ts. */
export function itemState(item: SponsorLeaderCadenceItem, today: string): JourneyState {
  if (item.completed) return "completed";
  const deadline = item.window_end_on ?? item.due_on;
  if (deadline < today) return "overdue";
  if (item.due_on <= today && today <= deadline) return "current";
  return "upcoming";
}

/**
 * Leader-level Active Programme Journey (spec section 6/7). The strongest
 * visual element of the Leader Detail page: one node per required cadence
 * item for this leader's current enrollment, in due-date order, each
 * carrying an explicit state (Completed / Current / Overdue / Upcoming) --
 * never a bare percentage and never "0%" for something not yet due.
 *
 * A vertical, connected timeline is used at every breakpoint rather than a
 * horizontal chain that only degrades on desktop: it keeps sequence, state,
 * activity type and date all readable down to phone width without a second,
 * different mobile-only layout to maintain.
 */
export function LeaderProgrammeJourney({ items }: { items: SponsorLeaderCadenceItem[] }) {
  const { t } = useTranslation("sponsor");
  const today = todayIso();

  const sorted = useMemo(() => [...items].sort((a, b) => a.due_on.localeCompare(b.due_on)), [items]);
  const currentIndex = useMemo(() => {
    const idx = sorted.findIndex((item) => itemState(item, today) !== "completed");
    return idx === -1 ? sorted.length - 1 : idx;
  }, [sorted, today]);

  if (sorted.length === 0) {
    return <p className="py-6 text-center text-[12px] italic text-muted-foreground">{t("leaderDetail.journey.empty")}</p>;
  }

  const stateMeta: Record<JourneyState, { label: string; icon: typeof CheckCircle2; tone: string }> = {
    completed: { label: t("leaderDetail.journey.states.completed"), icon: CheckCircle2, tone: "text-success" },
    current: { label: t("leaderDetail.journey.states.current"), icon: MapPin, tone: "text-primary" },
    overdue: { label: t("leaderDetail.journey.states.overdue"), icon: AlertTriangle, tone: "text-destructive" },
    upcoming: { label: t("leaderDetail.journey.states.upcoming"), icon: Circle, tone: "text-muted-foreground" },
  };

  return (
    <ol className="relative space-y-0 pl-2">
      {sorted.map((item, idx) => {
        const state = itemState(item, today);
        const meta = stateMeta[state];
        const Icon = meta.icon;
        const isHere = idx === currentIndex;
        return (
          <li key={`${item.module}-${item.sequence}`} className="relative flex gap-3 pb-5 last:pb-0">
            {idx < sorted.length - 1 && (
              <span className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-border" aria-hidden />
            )}
            <div
              className={cn(
                "z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 bg-card",
                state === "completed" && "border-success/60",
                state === "current" && "border-primary",
                state === "overdue" && "border-destructive/60",
                state === "upcoming" && "border-border"
              )}
            >
              <Icon className={cn("h-4 w-4", meta.tone)} />
            </div>
            <div className="flex-1 pt-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <p className="text-[13px] font-semibold">{moduleLabel(item.module)} {item.sequence}</p>
                {isHere && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                    {t("leaderDetail.journey.youAreHere")}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{format(new Date(item.due_on), "MMM d, yyyy")}</p>
              <p className={cn("mt-0.5 text-[11px] font-semibold", meta.tone)}>{meta.label}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
