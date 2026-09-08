import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Star, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { SectionCard, Pill, MiniBar, Avatar, EngagementCell } from "@/pages/admin/_shared";
import type {
  SponsorGoalGrowth,
  SponsorRosterRow,
  SponsorProgrammeEngagementRow,
  SponsorCoachUtilisationRow,
} from "@/hooks/sponsor/useSponsorDashboardData";
import { STATUS_TONE, STATUS_LABEL_KEY, initials, type HealthSignal } from "./sponsorUtils";

export function HealthSignalPill({ signal }: { signal: HealthSignal }) {
  const { t } = useTranslation("sponsor");
  const tone = signal === "attention" ? "destructive" : signal === "watch" ? "warning" : "success";
  return <Pill tone={tone}>{t(`shared.health.${signal}`)}</Pill>;
}

export function DistRow({ label, count, total, tone }: { label: string; count: number; total: number; tone: "success" | "primary" | "warning" | "destructive" }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{count}</span>
      </div>
      <MiniBar pct={pct} tone={tone} />
    </div>
  );
}

export function GoalProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const tone = clamped >= 50 ? "bg-success" : clamped >= 20 ? "bg-warning" : "bg-muted-foreground/40";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${clamped}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] font-medium text-muted-foreground">{Math.round(pct)}%</span>
    </div>
  );
}

/** The goal-growth distribution card — shared between the org dashboard and a single cohort's detail page. */
export function GoalGrowthCard({ goalGrowth, minLeadersForDistribution }: { goalGrowth: SponsorGoalGrowth | null; minLeadersForDistribution: number }) {
  const { t } = useTranslation("sponsor");
  const distributionShown = goalGrowth?.hit_target_count != null;
  const distributionTotal = distributionShown
    ? (goalGrowth!.hit_target_count + goalGrowth!.meaningful_progress_count + goalGrowth!.just_started_count + goalGrowth!.flat_declined_count) || 1
    : 1;

  return (
    <SectionCard label={t("dashboard.goalGrowth.label")} action={
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
        {t("dashboard.goalGrowth.scaleNote")}
      </span>
    }>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{t("dashboard.goalGrowth.averageGrowth")}</p>
          <p className="font-display mt-1 text-[2rem] font-normal leading-none">
            {goalGrowth?.pct_progressing != null ? `${Math.round(goalGrowth.pct_progressing)}%` : "—"}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {goalGrowth?.pct_progressing != null
              ? t("dashboard.goalGrowth.pctProgressing")
              : t("dashboard.goalGrowth.noRatingsYet")}
          </p>
        </div>
        <div>
          {distributionShown ? (
            <div className="space-y-2">
              <DistRow label={t("dashboard.goalGrowth.hitTarget")} count={goalGrowth!.hit_target_count} total={distributionTotal} tone="success" />
              <DistRow label={t("dashboard.goalGrowth.meaningfulProgress")} count={goalGrowth!.meaningful_progress_count} total={distributionTotal} tone="primary" />
              <DistRow label={t("dashboard.goalGrowth.justStarted")} count={goalGrowth!.just_started_count} total={distributionTotal} tone="warning" />
              <DistRow label={t("dashboard.goalGrowth.flatDeclined")} count={goalGrowth!.flat_declined_count} total={distributionTotal} tone="destructive" />
            </div>
          ) : (
            <div className="rounded-xl bg-muted/40 p-3">
              <p className="text-[11px] text-muted-foreground">
                {t("dashboard.goalGrowth.distributionHidden", { min: minLeadersForDistribution })}
              </p>
            </div>
          )}
        </div>
      </div>
      <p className="mt-4 text-[10px] italic text-muted-foreground">
        {t("dashboard.goalGrowth.footnote")}
      </p>
    </SectionCard>
  );
}

/** The per-week engagement grid — shared between the org dashboard and a single cohort's detail page. */
export function ProgrammeEngagementTable({ rows, lowCompletionNote }: { rows: SponsorProgrammeEngagementRow[]; lowCompletionNote?: boolean }) {
  const { t } = useTranslation("sponsor");
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[64px_repeat(5,1fr)] gap-0 border-b bg-muted/30 px-4 py-2.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
        <span>{t("dashboard.programmeEngagement.columns.week")}</span>
        <span>{t("dashboard.programmeEngagement.columns.skillCard")}</span>
        <span>{t("dashboard.programmeEngagement.columns.quiz")}</span>
        <span>{t("dashboard.programmeEngagement.columns.reflection")}</span>
        <span>{t("dashboard.programmeEngagement.columns.triad")}</span>
        <span>{t("dashboard.programmeEngagement.columns.prompt")}</span>
      </div>
      <div className="divide-y">
        {rows.map((w) => {
          const pcts = [w.skill_card_completion_pct, w.quiz_completion_pct, w.reflection_completion_pct, w.triad_completion_pct, w.daily_prompt_response_rate].filter((p): p is number => p != null);
          const avgPct = pcts.length ? pcts.reduce((s, p) => s + p, 0) / pcts.length : null;
          return (
            <div key={`${w.week_number}-${w.week_title}`}>
              <div className="grid grid-cols-[64px_repeat(5,1fr)] items-center gap-0 px-4 py-3 text-[12.5px]">
                <span className="font-bold">W{w.week_number}</span>
                <EngagementCell pct={w.skill_card_completion_pct} />
                <EngagementCell pct={w.quiz_completion_pct} sub={w.quiz_avg_score != null ? `${Math.round(w.quiz_avg_score)}% avg` : undefined} />
                <EngagementCell pct={w.reflection_completion_pct} />
                <div>
                  <EngagementCell pct={w.triad_completion_pct} />
                  {w.triad_satisfaction_avg != null && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {w.triad_satisfaction_avg.toFixed(1)}<span className="opacity-60">/5</span>
                    </span>
                  )}
                </div>
                <EngagementCell pct={w.daily_prompt_response_rate} tone="accent" />
              </div>
              {lowCompletionNote && avgPct != null && avgPct < 40 && (
                <p className="px-4 pb-2.5 text-[10px] italic text-warning">
                  {t("cohortDetail.programmeEngagement.lowCompletion", { week: w.week_number })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Horizontal per-coach session bars — shared between the org dashboard and a single cohort's detail page. */
export function CoachUtilisationBars({ rows }: { rows: SponsorCoachUtilisationRow[] }) {
  const maxCoachSessions = Math.max(1, ...rows.map((c) => c.completed_sessions));
  return (
    <div className="space-y-2.5">
      {rows.map((c) => (
        <div key={c.coach_name} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-[12px] font-medium">{c.coach_name}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(c.completed_sessions / maxCoachSessions) * 100}%` }}
            />
          </div>
          <span className="w-6 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{c.completed_sessions}</span>
        </div>
      ))}
    </div>
  );
}

type SortKey = "status" | "sessions" | null;

/** The leader roster table — shared between the org dashboard (all cohorts, unsorted) and a cohort detail page (single cohort, sortable). */
export function RosterTable({
  rows,
  onSelect,
  showCohortColumn = true,
  sortable = false,
}: {
  rows: SponsorRosterRow[];
  onSelect: (leader: SponsorRosterRow) => void;
  showCohortColumn?: boolean;
  sortable?: boolean;
}) {
  const { t } = useTranslation("sponsor");
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: Exclude<SortKey, null>) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const displayRows = (() => {
    if (!sortable || !sortKey) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...rows];
    if (sortKey === "status") {
      sorted.sort((a, b) => dir * a.enrollment_status.localeCompare(b.enrollment_status));
    } else if (sortKey === "sessions") {
      sorted.sort((a, b) => dir * (a.sessions_completed - b.sessions_completed));
    }
    return sorted;
  })();

  const SortableHeader = ({ label, sortKeyName }: { label: string; sortKeyName: Exclude<SortKey, null> }) => (
    <button
      type="button"
      onClick={() => toggleSort(sortKeyName)}
      className={cn("inline-flex items-center gap-1 font-semibold hover:text-foreground", sortKey === sortKeyName && "text-foreground")}
    >
      {label} <ArrowUpDown className="h-2.5 w-2.5" />
    </button>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-left font-semibold">{t("dashboard.roster.columns.leader")}</th>
            {showCohortColumn && <th className="px-2 py-2 text-left font-semibold hidden sm:table-cell">{t("dashboard.roster.columns.cohort")}</th>}
            <th className="px-2 py-2 text-left">
              {sortable ? <SortableHeader label={t("dashboard.roster.columns.status")} sortKeyName="status" /> : t("dashboard.roster.columns.status")}
            </th>
            <th className="px-2 py-2 text-left font-semibold hidden md:table-cell">{t("dashboard.roster.columns.progress")}</th>
            <th className="px-2 py-2 text-left">
              {sortable ? <SortableHeader label={t("dashboard.roster.columns.sessions")} sortKeyName="sessions" /> : t("dashboard.roster.columns.sessions")}
            </th>
            <th className="px-2 py-2 text-left font-semibold hidden sm:table-cell">{t("dashboard.roster.columns.goalProgress")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {displayRows.map((r) => (
            <tr
              key={r.enrollment_id}
              onClick={() => onSelect(r)}
              className="cursor-pointer transition-colors hover:bg-muted/40"
            >
              <td className="px-2 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary">
                    {initials(r.full_name)}
                  </div>
                  <span className="font-medium">{r.full_name}</span>
                </div>
              </td>
              {showCohortColumn && <td className="px-2 py-2.5 text-muted-foreground hidden sm:table-cell">{r.cohort_name || "—"}</td>}
              <td className="px-2 py-2.5"><Pill tone={STATUS_TONE[r.enrollment_status]}>{t(`status.${STATUS_LABEL_KEY[r.enrollment_status]}`)}</Pill></td>
              <td className="px-2 py-2.5 hidden md:table-cell">
                <div className="w-24"><MiniBar pct={r.progress_pct} tone="primary" /></div>
              </td>
              <td className="px-2 py-2.5 font-mono text-muted-foreground">{r.sessions_completed}/{r.sessions_entitled}</td>
              <td className="px-2 py-2.5 hidden sm:table-cell">
                {r.goal_growth != null ? <GoalProgressBar pct={r.goal_growth} /> : <span className="italic text-muted-foreground">—</span>}
              </td>
            </tr>
          ))}
          {displayRows.length === 0 && (
            <tr><td colSpan={showCohortColumn ? 6 : 5} className="px-2 py-8 text-center text-[12px] text-muted-foreground">{t("dashboard.roster.empty")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export { Avatar };
