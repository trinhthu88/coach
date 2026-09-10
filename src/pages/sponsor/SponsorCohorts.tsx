import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Pill, Kpi } from "@/pages/admin/_shared";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import { Card } from "@/components/ui/card";

export default function SponsorCohorts() {
  const { t } = useTranslation("sponsor");
  const { kpis, cohortSummaries, loading } = useSponsorDashboardData();
  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  return <div className="space-y-6">
    <PageHeader eyebrow={t("cohorts.header.eyebrow")} title={t("cohorts.header.title")} emphasis={t("cohorts.header.emphasis")} subtitle={t("cohorts.header.subtitle")} />
    <SectionCard label={t("cohorts.rolledUpLabel")}><div className="grid gap-3 sm:grid-cols-3">
      <Kpi label={t("cohorts.kpis.leadersEnrolled")} value={kpis?.leaders_enrolled ?? 0} />
      <Kpi label={t("cohorts.kpis.onTrack")} value={kpis?.on_track_count ?? 0} />
      <Kpi label={t("cohorts.kpis.sessionsUsed")} value={`${kpis?.sessions_used ?? 0} / ${kpis?.sessions_entitled ?? 0}`} />
    </div></SectionCard>
    <div className="grid gap-4 sm:grid-cols-2">
      {cohortSummaries.map((cohort) => <Card key={cohort.cohort_id} className="p-4">
        <div className="mb-3 flex items-start justify-between"><div><p className="font-semibold">{cohort.cohort_label}</p>{!cohort.suppressed && <p className="text-[11px] text-muted-foreground">{cohort.enrollment_count} enrollments</p>}</div>
          {cohort.suppressed && <Pill tone="muted">Suppressed</Pill>}</div>
        {cohort.suppressed ? <p className="text-[11px] italic text-muted-foreground">Aggregate detail is suppressed for privacy.</p> :
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm"><span>Completed units <b>{cohort.completed_units ?? 0}</b></span><span>Due adherence <b>{cohort.due_adherence_pct == null ? "—" : `${Math.round(cohort.due_adherence_pct)}%`}</b></span></div>}
        <Link to={`/sponsor/cohorts/${cohort.cohort_id}`} className="mt-3 flex justify-end text-[11px] font-semibold text-primary hover:underline">View cohort →</Link>
      </Card>)}
      {cohortSummaries.length === 0 && <div className="col-span-2 py-12 text-center text-sm text-muted-foreground">{t("cohorts.noCohortsFound")}</div>}
    </div>
    <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{t("cohorts.privacyNote")}</div>
  </div>;
}