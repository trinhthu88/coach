import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Kpi } from "@/pages/admin/_shared";
import { RosterTable } from "@/pages/sponsor/_shared";
import { CohortCadenceMap } from "@/pages/sponsor/CadenceVisual";
import { useSponsorCohortData } from "@/hooks/sponsor/useSponsorCohortData";

const MIN_RESPONSES_FOR_SATISFACTION = 5;

/**
 * Sponsor Cohort Detail (spec section B). Header + five KPIs, the Programme
 * Cadence visual, a Goals summary, Satisfaction (only once the response
 * count clears the same k-anonymity floor used elsewhere), and the leader
 * roster. Deliberately does not show Time Elapsed %, a separate Overdue
 * KPI, or Actions Complete -- see spec B1/B5/E.
 */
export default function SponsorCohortDetail() {
  const { cohortId = "" } = useParams<{ cohortId: string }>();
  const { t } = useTranslation("sponsor");
  const { kpis, roster, cadenceItems, cohortLabel, suppressed, loading } = useSponsorCohortData(cohortId);

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const showSatisfaction = !suppressed && (kpis?.satisfaction_rated_count ?? 0) >= MIN_RESPONSES_FOR_SATISFACTION;

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <Link to="/sponsor" className="hover:text-foreground">{t("cohortDetail.breadcrumb.sponsor")}</Link>
        <span>/</span>
        <span className="text-foreground">{cohortLabel ?? "—"}</span>
      </nav>
      <Link to="/sponsor/cohorts" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("cohorts.header.title")}
      </Link>

      <PageHeader eyebrow={t("cohortDetail.header.eyebrow")} title={t("cohortDetail.header.title")} emphasis={cohortLabel ?? "—"} subtitle={t("cohortDetail.header.subtitle")} />

      {suppressed ? (
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {t("cohorts.suppressedNote", { min: 5 })}
        </div>
      ) : (
        <>
          {/* HEADER FACTS — spec B1. No Time Elapsed %; "Week X of Y" is
              sufficient. */}
          <SectionCard label={t("cohortDetail.overview.label")}>
            <div className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-3 lg:grid-cols-5">
              <Fact label={t("cohortDetail.overview.programme")} value={kpis?.programme_label ?? "—"} />
              <Fact
                label={t("cohortDetail.overview.period")}
                value={kpis?.cohort_start_date && kpis?.cohort_end_date
                  ? `${format(new Date(kpis.cohort_start_date), "d MMM yyyy")} – ${format(new Date(kpis.cohort_end_date), "d MMM yyyy")}`
                  : "—"}
              />
              <Fact
                label={t("cohortDetail.overview.position")}
                value={kpis?.current_week != null && kpis?.total_weeks != null
                  ? t("dashboard.currentCohorts.weekOf", { current: kpis.current_week, total: kpis.total_weeks })
                  : "—"}
              />
              <Fact label={t("cohortDetail.overview.totalLeaders")} value={String(kpis?.enrollment_count ?? "—")} />
              <Fact label={t("cohortDetail.overview.status")} value={t(`cohortDetail.status.${kpis?.cohort_status ?? "current"}`)} />
            </div>
          </SectionCard>

          {/* MAIN KPIs — spec B2/B3/B4/D. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi
              label={t("dashboard.kpis.onTrack")}
              value={kpis?.on_track_count != null && kpis?.assessable_count != null ? `${kpis.on_track_count} / ${kpis.assessable_count}` : "—"}
              hint={kpis?.on_track_pct != null ? `${Math.round(kpis.on_track_pct)}%` : undefined}
            />
            <Kpi
              label={t("cohortDetail.kpis.cadenceToDate")}
              value={kpis?.cadence_completion_pct != null ? `${Math.round(kpis.cadence_completion_pct)}%` : "—"}
              hint={kpis?.cadence_completion_pct == null ? t("cohortDetail.kpis.noneDueYet") : undefined}
            />
            <Kpi
              label={t("cohortDetail.kpis.leadersWithGoals")}
              value={kpis?.goal_setup_count != null && kpis?.enrollment_count != null ? `${kpis.goal_setup_count} / ${kpis.enrollment_count}` : "—"}
            />
            <Kpi
              label={t("cohortDetail.kpis.avgGoalProgress")}
              value={kpis?.goal_progress_pct != null ? `${Math.round(kpis.goal_progress_pct)}%` : "—"}
            />
            {showSatisfaction && (
              <Kpi
                label={t("cohortDetail.kpis.overallSatisfaction")}
                value={kpis?.satisfaction_avg != null ? `${kpis.satisfaction_avg.toFixed(1)} / 5` : "—"}
                hint={t("cohortDetail.kpis.responseCount", { count: kpis?.satisfaction_rated_count ?? 0 })}
              />
            )}
          </div>

          {/* PROGRAMME CADENCE VISUAL — spec section C. */}
          <SectionCard label={t("cohortDetail.cadenceMap.label")}>
            <CohortCadenceMap items={cadenceItems} />
          </SectionCard>

          {/* ROSTER — spec section G. */}
          <SectionCard label={t("dashboard.roster.label", { count: roster.length })}>
            <RosterTable rows={roster} cohortId={cohortId} />
          </SectionCard>
        </>
      )}

      <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
        {t("cohorts.privacyNote")}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}
