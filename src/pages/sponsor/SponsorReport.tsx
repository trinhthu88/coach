import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDown, ShieldCheck, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Pill } from "@/pages/admin/_shared";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function SponsorReport() {
  const { t } = useTranslation("sponsor");
  const { cohortSummaries, loading } = useSponsorDashboardData();
  const [detailRows, setDetailRows] = useState<import("@/hooks/sponsor/useSponsorDashboardData").SponsorEnrollmentSummary[]>([]);
  const [scope, setScope] = useState("");
  const [includeRoster, setIncludeRoster] = useState(true);
  const [generated, setGenerated] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const cohorts = cohortSummaries.map((r) => [r.cohort_id, r.cohort_label] as const);
  const selectedSummary = cohortSummaries.find((r) => r.cohort_id === scope);
  const filtered = detailRows;
  const suppressed = selectedSummary?.suppressed ?? false;
  useEffect(() => {
    if (!scope) { setDetailRows([]); return; }
    supabase.rpc("sponsor_enrollment_summaries", { p_cohort_id: scope })
      .then(({ data }) => setDetailRows(data ?? []));
  }, [scope]);

  async function downloadPdf() {
    setPdfLoading(true);
    const { data, error } = await supabase.functions.invoke<{ url: string }>("generate-report-pdf", { body: { p_cohort_id: scope } });
    setPdfLoading(false);
    if (error || !data?.url) { toast.error(t("pdfError")); return; }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("report.header.eyebrow")} title={t("report.header.title")} emphasis={t("report.header.emphasis")} subtitle={t("report.header.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <SectionCard label={t("report.setup.label")}>
          <div className="space-y-4">
            <Select value={scope} onValueChange={(v) => { setScope(v); setGenerated(false); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" disabled>Select a cohort</SelectItem>
                {cohorts.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between">
              <Label htmlFor="include-roster">{t("report.setup.includeRoster")}</Label>
              <Switch id="include-roster" checked={includeRoster} onCheckedChange={setIncludeRoster} />
            </div>
            <Button className="w-full" onClick={() => setGenerated(true)} disabled={!scope}>{t("report.setup.generate")}</Button>
            {generated && <Button variant="outline" className="w-full gap-2" onClick={downloadPdf} disabled={pdfLoading}>
              {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}{t("downloadPdf")}
            </Button>}
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-[10px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" />{t("report.nothingPrivateNote")}</div>
        </SectionCard>
        {!generated ? <div className="flex h-80 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border text-center text-sm text-muted-foreground"><RefreshCw className="mb-3 h-8 w-8 opacity-40" /><p>{t("report.preview.placeholderTitle")}</p></div> :
          <div className="rounded-2xl border border-border bg-white p-6">
            <h2 className="text-lg font-semibold">{cohorts.find(([id]) => id === scope)?.[1]}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label={t("report.kpis.enrolled")} value={filtered.length} />
              <Metric label={t("report.kpis.sessionsUsed")} value={`${filtered.reduce((n, r) => n + r.coaching_completed_count, 0)}/${filtered.reduce((n, r) => n + r.required_units, 0)}`} />
              <Metric label="Due adherence" value={filtered.length ? `${Math.round(filtered.reduce((n, r) => n + (r.due_adherence_pct ?? 0), 0) / filtered.length)}%` : "—"} />
              <Metric label="Open actions" value={filtered.reduce((n, r) => n + r.open_action_count, 0)} />
            </div>
            {suppressed && <p className="mt-5 rounded-lg bg-muted p-3 text-sm text-muted-foreground">Aggregate detail is suppressed to protect privacy.</p>}
            {includeRoster && !suppressed && <div className="mt-6 space-y-2">{filtered.map((r) => <div key={r.enrollment_id} className="flex items-center justify-between border-b py-2 text-sm"><span>{r.learner_display_name}</span><span className="flex items-center gap-3"><Pill tone={r.enrollment_status === "active" ? "success" : "muted"}>{r.enrollment_status}</Pill><span>{r.completed_units}/{r.required_units}</span></span></div>)}</div>}
          </div>}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg border border-border p-3"><p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p><p className="mt-1 text-xl">{value}</p></div>;
}