import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Kpi } from "@/pages/admin/_shared";
import { RosterTable } from "@/pages/sponsor/_shared";
import { useSponsorCohortData } from "@/hooks/sponsor/useSponsorCohortData";
import { useState } from "react";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { SponsorLeaderDrawer } from "./SponsorLeaderDrawer";

export default function SponsorCohortDetail() {
  const { cohortId = "" } = useParams<{ cohortId: string }>();
  const { t } = useTranslation("sponsor");
  const { kpis, roster, cohortLabel, suppressed, loading } = useSponsorCohortData(cohortId);
  const [selected, setSelected] = useState<SponsorRosterRow | null>(null);
  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  return <div className="space-y-6">
    <Link to="/sponsor/cohorts" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><ArrowLeft className="h-3.5 w-3.5" /> {t("cohorts.header.title")}</Link>
    <PageHeader eyebrow={t("cohortDetail.header.eyebrow")} title={t("cohortDetail.header.title")} emphasis={cohortLabel ?? "—"} subtitle={t("cohortDetail.header.subtitle")} />
    {suppressed && <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">Aggregate detail is suppressed to protect privacy.</div>}
    {!suppressed && <div className="grid gap-3 sm:grid-cols-4">
       <Kpi label={t("dashboard.kpis.leadersEnrolled")} value={kpis?.enrollment_count ?? 0} />
      <Kpi label={t("dashboard.kpis.onTrack")} value={kpis?.on_track_count ?? 0} />
      <Kpi label={t("dashboard.kpis.sessionsUsed")} value={`${kpis?.completed_units ?? 0} / ${kpis?.required_units ?? 0}`} />
       <Kpi label="Booked / overdue" value={`${kpis?.booked_units ?? 0} / ${kpis?.overdue_units ?? 0}`} />
    </div>}
     {!suppressed && <div className="grid grid-cols-2 gap-2 text-sm">
       <span>Completion <b>{kpis?.full_completion_pct == null ? "—" : `${Math.round(kpis.full_completion_pct)}%`}</b></span>
       <span>Adherence <b>{kpis?.due_adherence_pct == null ? "—" : `${Math.round(kpis.due_adherence_pct)}%`}</b></span>
       <span>Coverage <b>{kpis?.schedule_coverage_pct == null ? "—" : `${Math.round(kpis.schedule_coverage_pct)}%`}</b></span>
       <span>Goals setup / total <b>{kpis?.goal_setup_count ?? 0} / {kpis?.goal_count ?? 0}</b></span>
       <span>Actions complete <b>{kpis?.completed_action_count ?? 0} / {kpis?.total_action_count ?? 0}</b></span>
       <span>Goal progress <b>{kpis?.goal_progress_pct == null ? "—" : `${Math.round(kpis.goal_progress_pct)}%`}</b></span>
       <span>Pace NYD / ahead / on-track <b>{kpis?.not_yet_due_count ?? 0} / {kpis?.ahead_count ?? 0} / {kpis?.on_track_count ?? 0}</b></span>
       <span>Pace scheduled / behind / complete <b>{kpis?.scheduled_count ?? 0} / {kpis?.behind_count ?? 0} / {kpis?.completed_pace_count ?? 0}</b></span>
       <span>Satisfaction <b>{kpis?.satisfaction_avg == null ? "—" : kpis.satisfaction_avg.toFixed(2)}</b></span>
     </div>}
    {!suppressed && <SectionCard label={t("dashboard.roster.label", { count: roster.length })}>
      <RosterTable rows={roster} onSelect={setSelected} showCohortColumn={false} sortable />
    </SectionCard>}
    <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" />{t("cohorts.privacyNote")}</div>
    <SponsorLeaderDrawer leader={selected} onClose={() => setSelected(null)} />
  </div>;
}