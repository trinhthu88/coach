import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pill, MiniBar, Avatar } from "@/pages/admin/_shared";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { STATUS_TONE, STATUS_LABEL_KEY, effectiveSponsorStatus, initials, type HealthSignal } from "./sponsorUtils";
import { canonicalCompletionPct } from "@/lib/programmeProfile";

export function HealthSignalPill({ signal }: { signal: HealthSignal }) {
  const { t } = useTranslation("sponsor");
  const tone = signal === "attention" ? "destructive" : signal === "watch" ? "warning" : "success";
  return <Pill tone={tone}>{t(`shared.health.${signal}`)}</Pill>;
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
       sorted.sort((a, b) => dir * effectiveSponsorStatus(a).localeCompare(effectiveSponsorStatus(b)));
    } else if (sortKey === "sessions") {
      sorted.sort((a, b) => dir * (a.completed_units - b.completed_units));
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
                    {initials(r.learner_display_name)}
                  </div>
                  <span className="font-medium">{r.learner_display_name}</span>
                </div>
              </td>
              {showCohortColumn && <td className="px-2 py-2.5 text-muted-foreground hidden sm:table-cell">{r.cohort_label || "—"}</td>}
              <td className="px-2 py-2.5"><Pill tone={STATUS_TONE[effectiveSponsorStatus(r)]}>{t(`status.${STATUS_LABEL_KEY[effectiveSponsorStatus(r)]}`)}</Pill></td>
              <td className="px-2 py-2.5 hidden md:table-cell">
                <div className="w-24"><MiniBar pct={canonicalCompletionPct(r.full_completion_pct) ?? 0} tone="primary" /></div>
              </td>
              <td className="px-2 py-2.5 font-mono text-muted-foreground">{r.completed_units}/{r.required_units}</td>
              <td className="px-2 py-2.5 hidden sm:table-cell">
                {r.goal_progress_pct != null ? <GoalProgressBar pct={r.goal_progress_pct} /> : <span className="italic text-muted-foreground">—</span>}
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
