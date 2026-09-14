import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Loader2, RefreshCw, Clock3 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Pill } from "@/pages/admin/_shared";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type RequestRow = {
  id: string; cohort_id: string; status: "submitted" | "in_progress" | "ready" | "declined";
  request_notes?: string | null; admin_notes?: string | null; created_at: string; updated_at: string;
};

export default function SponsorReport() {
  const { t } = useTranslation("sponsor");
  const { cohortSummaries, loading } = useSponsorDashboardData();
  const [scope, setScope] = useState("");
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState(false);
  const cohorts = cohortSummaries.map((r) => [r.cohort_id, r.cohort_label] as const);
  const selectedSummary = cohortSummaries.find((r) => r.cohort_id === scope);

  const loadRequests = async () => {
    const { data, error } = await supabase.rpc("sponsor_list_report_requests");
    if (!error) setRequests((data ?? []) as RequestRow[]);
  };
  useEffect(() => { loadRequests(); }, []);

  async function requestReport() {
    if (!scope) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("sponsor_submit_report_request", { p_cohort_id: scope });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Report request submitted");
    setPreview(true);
    loadRequests();
  }

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("report.header.eyebrow")} title={t("report.header.title")} emphasis={t("report.header.emphasis")} subtitle="Request a privacy-safe sponsor report prepared by the Clariva team." />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <SectionCard label="Request report">
          <div className="space-y-4">
            <Select value={scope} onValueChange={(v) => { setScope(v); setPreview(false); }}>
              <SelectTrigger><SelectValue placeholder="Select a cohort" /></SelectTrigger>
              <SelectContent>{cohorts.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent>
            </Select>
            <Button className="w-full" onClick={requestReport} disabled={!scope || submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Request report
            </Button>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-[10px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" />Only approved, privacy-suppressed aggregate data is included. No PDF or private source data is stored.</div>
        </SectionCard>
        {!preview ? <div className="flex h-80 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border text-center text-sm text-muted-foreground"><RefreshCw className="mb-3 h-8 w-8 opacity-40" /><p>Select a cohort to request a manually prepared report.</p></div> :
          <div className="rounded-2xl border border-border bg-white p-6"><h2 className="text-lg font-semibold">{selectedSummary?.cohort_label}</h2><p className="mt-3 text-sm text-muted-foreground">Your request is in the history below. The Clariva team will prepare the report manually.</p></div>}
      </div>
      <SectionCard label="Request history">
        {requests.length === 0 ? <p className="text-sm text-muted-foreground">No report requests yet.</p> :
          <div className="divide-y">{requests.map((r) => <div key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{cohorts.find(([id]) => id === r.cohort_id)?.[1] ?? "Cohort"}<span className="ml-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span></span><span className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-muted-foreground" /><Pill tone={r.status === "ready" ? "success" : r.status === "declined" ? "destructive" : "primary"}>{r.status.replace("_", " ")}</Pill></span></div>)}</div>}
      </SectionCard>
    </div>
  );
}