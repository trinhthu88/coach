import { useNavigate } from "react-router-dom";
import { Loader2, Users, CheckCircle2, AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Pill, Kpi } from "@/pages/admin/_shared";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { Card } from "@/components/ui/card";

const STATUS_TONE: Record<SponsorRosterRow["enrollment_status"], "success" | "warning" | "destructive" | "muted"> = {
  active: "success",
  completed: "muted",
  paused: "warning",
  at_risk: "destructive",
};
const STATUS_LABEL: Record<SponsorRosterRow["enrollment_status"], string> = {
  active: "Active",
  completed: "Completed",
  paused: "Paused",
  at_risk: "At risk",
};

type StatusCounts = Record<SponsorRosterRow["enrollment_status"], number>;

function groupByCohort(roster: SponsorRosterRow[]): Map<string, SponsorRosterRow[]> {
  const map = new Map<string, SponsorRosterRow[]>();
  for (const r of roster) {
    const key = r.cohort_name || "Unnamed cohort";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}

function statusCounts(rows: SponsorRosterRow[]): StatusCounts {
  return rows.reduce((acc, r) => {
    acc[r.enrollment_status] = (acc[r.enrollment_status] || 0) + 1;
    return acc;
  }, {} as StatusCounts);
}

const MIN_DISTRIBUTION = 5;

export default function SponsorCohorts() {
  const navigate = useNavigate();
  const { kpis, roster, loading } = useSponsorDashboardData();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const cohortMap = groupByCohort(roster);
  const cohortList = Array.from(cohortMap.entries());

  const avgGrowthAll = (() => {
    const withGrowth = roster.filter(r => r.goal_growth != null);
    if (!withGrowth.length) return null;
    return withGrowth.reduce((s, r) => s + r.goal_growth!, 0) / withGrowth.length;
  })();

  const sessionsUsedAll = roster.reduce((s, r) => s + r.sessions_completed, 0);
  const sessionsEntitledAll = roster.reduce((s, r) => s + r.sessions_entitled, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sponsor"
        title="Across"
        emphasis="programmes."
        subtitle="Rolled up across everything you sponsor, then split by cohort."
      />

      {/* Rolled-up KPIs */}
      <SectionCard label="Rolled up · all cohorts">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          <Kpi label="Leaders enrolled" value={kpis?.leaders_enrolled ?? 0} icon={Users} tone="primary" />
          <Kpi label="On track" value={kpis?.on_track_count ?? 0} icon={CheckCircle2} tone="success" />
          <Kpi label="At risk" value={kpis?.at_risk_count ?? 0} icon={AlertTriangle} tone="warning" />
          <Kpi
            label="Sessions used"
            value={`${sessionsUsedAll} / ${sessionsEntitledAll}`}
            tone="secondary"
          />
          {avgGrowthAll != null && (
            <Kpi label="Avg goal growth" value={`+${Math.round(avgGrowthAll)} pts`} tone="accent" />
          )}
        </div>
      </SectionCard>

      {/* Per-cohort cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {cohortList.map(([cohortName, rows]) => {
          const counts = statusCounts(rows);
          const suppressed = rows.length < MIN_DISTRIBUTION;
          const avgGrowth = (() => {
            const wg = rows.filter(r => r.goal_growth != null);
            if (!wg.length) return null;
            return wg.reduce((s, r) => s + r.goal_growth!, 0) / wg.length;
          })();
          const sessions = { used: rows.reduce((s, r) => s + r.sessions_completed, 0), total: rows.reduce((s, r) => s + r.sessions_entitled, 0) };

          return (
            <Card key={cohortName} className="p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{cohortName}</p>
                  <p className="text-[11px] text-muted-foreground">{rows.length} leader{rows.length === 1 ? "" : "s"}</p>
                </div>
                <button
                  onClick={() => navigate(`/sponsor?cohort=${encodeURIComponent(cohortName)}`)}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-[10px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                >
                  Open in dashboard <ArrowRight className="h-2.5 w-2.5" />
                </button>
              </div>

              {/* Status mix */}
              <div className="mb-3">
                <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Status mix</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(counts) as [SponsorRosterRow["enrollment_status"], number][]).map(([status, n]) => (
                    <Pill key={status} tone={STATUS_TONE[status]}>
                      {n} {STATUS_LABEL[status].toLowerCase()}
                    </Pill>
                  ))}
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Sessions</p>
                  <p className="font-mono text-sm">{sessions.used} / {sessions.total}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Avg growth</p>
                  {suppressed ? (
                    <p className="text-[11px] italic text-muted-foreground">Suppressed &lt;{MIN_DISTRIBUTION}</p>
                  ) : avgGrowth != null ? (
                    <p className="text-sm font-medium">+{Math.round(avgGrowth)} pts</p>
                  ) : (
                    <p className="text-[11px] italic text-muted-foreground">No ratings yet</p>
                  )}
                </div>
              </div>

              {suppressed && (
                <p className="mt-2 text-[10px] italic text-muted-foreground">
                  Breakdowns suppressed — under {MIN_DISTRIBUTION} leaders. View rolled up across all cohorts above.
                </p>
              )}
            </Card>
          );
        })}

        {cohortList.length === 0 && (
          <div className="col-span-2 py-12 text-center text-sm text-muted-foreground">No cohorts found.</div>
        )}
      </div>

      {/* Privacy */}
      <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Cohort comparison uses participation and self-rated progress only. Coach identities, session notes, and goal wording are excluded from every cohort view.
      </div>
    </div>
  );
}
