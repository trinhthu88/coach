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
      <Kpi label={t("dashboard.kpis.leadersEnrolled")} value={roster.length} />
      <Kpi label={t("dashboard.kpis.onTrack")} value={kpis?.on_track_count ?? 0} />
      <Kpi label={t("dashboard.kpis.sessionsUsed")} value={`${kpis?.sessions_used ?? 0} / ${kpis?.sessions_entitled ?? 0}`} />
      <Kpi label="Open actions" value={roster.reduce((n, r) => n + r.open_action_count, 0)} />
    </div>}
    {!suppressed && <SectionCard label={t("dashboard.roster.label", { count: roster.length })}>
      <RosterTable rows={roster} onSelect={setSelected} showCohortColumn={false} sortable />
    </SectionCard>}
    <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" />{t("cohorts.privacyNote")}</div>
    <SponsorLeaderDrawer leader={selected} onClose={() => setSelected(null)} />
  </div>;
}