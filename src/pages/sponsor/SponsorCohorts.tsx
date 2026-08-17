import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
const STATUS_LABEL_KEY: Record<SponsorRosterRow["enrollment_status"], string> = {
  active: "active",
  completed: "completed",
  paused: "paused",
  at_risk: "atRisk",
};

type StatusCounts = Record<SponsorRosterRow["enrollment_status"], number>;

function groupByCohort(roster: SponsorRosterRow[], unnamedLabel: string): Map<string, SponsorRosterRow[]> {
  const map = new Map<string, SponsorRosterRow[]>();
  for (const r of roster) {
    const key = r.cohort_name || unnamedLabel;
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

export default function SponsorCohorts() {
  const { t } = useTranslation("sponsor");
  const navigate = useNavigate();
  const { kpis, roster, minLeadersForDistribution, loading } = useSponsorDashboardData();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const cohortMap = groupByCohort(roster, t("cohorts.unnamedCohort"));
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
        eyebrow={t("cohorts.header.eyebrow")}
        title={t("cohorts.header.title")}
        emphasis={t("cohorts.header.emphasis")}
        subtitle={t("cohorts.header.subtitle")}
      />

      {/* Rolled-up KPIs */}
      <SectionCard label={t("cohorts.rolledUpLabel")}>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          <Kpi label={t("cohorts.kpis.leadersEnrolled")} value={kpis?.leaders_enrolled ?? 0} icon={Users} tone="primary" />
          <Kpi label={t("cohorts.kpis.onTrack")} value={kpis?.on_track_count ?? 0} icon={CheckCircle2} tone="success" />
          <Kpi label={t("cohorts.kpis.atRisk")} value={kpis?.at_risk_count ?? 0} icon={AlertTriangle} tone="warning" />
          <Kpi
            label={t("cohorts.kpis.sessionsUsed")}
            value={`${sessionsUsedAll} / ${sessionsEntitledAll}`}
            tone="secondary"
          />
          {avgGrowthAll != null && (
            <Kpi label={t("cohorts.kpis.avgGoalGrowth")} value={t("cohorts.growthPts", { n: Math.round(avgGrowthAll) })} tone="accent" />
          )}
        </div>
      </SectionCard>

      {/* Per-cohort cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {cohortList.map(([cohortName, rows]) => {
          const counts = statusCounts(rows);
          const suppressed = rows.length < minLeadersForDistribution;
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
                  <p className="text-[11px] text-muted-foreground">{t("cohorts.leaderCount", { count: rows.length })}</p>
                </div>
                <button
                  onClick={() => navigate(`/sponsor?cohort=${encodeURIComponent(cohortName)}`)}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-[10px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                >
                  {t("cohorts.openInDashboard")} <ArrowRight className="h-2.5 w-2.5" />
                </button>
              </div>

              {/* Status mix */}
              <div className="mb-3">
                <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("cohorts.statusMix")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(counts) as [SponsorRosterRow["enrollment_status"], number][]).map(([status, n]) => (
                    <Pill key={status} tone={STATUS_TONE[status]}>
                      {n} {t(`status.${STATUS_LABEL_KEY[status]}`).toLowerCase()}
                    </Pill>
                  ))}
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("cohorts.sessions")}</p>
                  <p className="font-mono text-sm">{sessions.used} / {sessions.total}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("cohorts.avgGrowth")}</p>
                  {suppressed ? (
                    <p className="text-[11px] italic text-muted-foreground">{t("cohorts.suppressed", { min: minLeadersForDistribution })}</p>
                  ) : avgGrowth != null ? (
                    <p className="text-sm font-medium">{t("cohorts.growthPts", { n: Math.round(avgGrowth) })}</p>
                  ) : (
                    <p className="text-[11px] italic text-muted-foreground">{t("cohorts.noRatingsYet")}</p>
                  )}
                </div>
              </div>

              {suppressed && (
                <p className="mt-2 text-[10px] italic text-muted-foreground">
                  {t("cohorts.suppressedNote", { min: minLeadersForDistribution })}
                </p>
              )}
            </Card>
          );
        })}

        {cohortList.length === 0 && (
          <div className="col-span-2 py-12 text-center text-sm text-muted-foreground">{t("cohorts.noCohortsFound")}</div>
        )}
      </div>

      {/* Privacy */}
      <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        {t("cohorts.privacyNote")}
      </div>
    </div>
  );
}
