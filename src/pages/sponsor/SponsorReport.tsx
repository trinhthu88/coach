import { useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { toast } from "sonner";
import { FileDown, ShieldCheck, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Pill, MiniBar } from "@/pages/admin/_shared";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

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

const PERIOD_OPTS = ["all", "90d", "60d", "30d"] as const;

export default function SponsorReport() {
  const { t } = useTranslation("sponsor");
  const { kpis, goalGrowth, roster, satisfaction, timeline, minLeadersForDistribution, loading } = useSponsorDashboardData();
  const [period, setPeriod] = useState("all");
  const [scope, setScope] = useState("all");
  const [includeRoster, setIncludeRoster] = useState(true);
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const cohortNames = Array.from(new Set(roster.map(r => r.cohort_name).filter(Boolean)));

  const filteredRoster = scope === "all" ? roster : roster.filter(r => r.cohort_name === scope);

  // hit_target_count etc. come back null from sponsor_goal_growth_summary()
  // when the server suppresses the distribution (org has fewer than
  // minLeadersForDistribution enrolled leaders) — that's the authoritative
  // signal, not the size of the bucket counts themselves. A cohort with
  // e.g. 6 enrolled leaders but only 2 goal ratings set is legitimately
  // unsuppressed and should still render its (small) real distribution.
  const distributionShown = goalGrowth?.hit_target_count != null;
  const distributionTotal = distributionShown
    ? (goalGrowth!.hit_target_count + goalGrowth!.meaningful_progress_count + goalGrowth!.just_started_count + goalGrowth!.flat_declined_count) || 1
    : 1;

  function handleGenerate() {
    setGenerating(true);
    setTimeout(() => { setGenerating(false); setGenerated(true); }, 800);
  }

  async function handleDownloadPdf() {
    setPdfLoading(true);
    const { data, error } = await supabase.functions.invoke<{ url: string }>("generate-report-pdf");
    setPdfLoading(false);
    if (error || !data?.url) {
      toast.error(t("pdfError"));
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  const scopeLabel = scope === "all" ? t("report.setup.allCohorts") : scope;
  const periodLabel = t(`report.period.${period}`, { defaultValue: t("report.period.all") });
  const today = format(new Date(), "d MMM yyyy");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("report.header.eyebrow")}
        title={t("report.header.title")}
        emphasis={t("report.header.emphasis")}
        subtitle={t("report.header.subtitle")}
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Setup panel */}
        <div className="space-y-4">
          <SectionCard label={t("report.setup.label")}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("report.setup.periodLabel")}</p>
                <Select value={period} onValueChange={v => { setPeriod(v); setGenerated(false); }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIOD_OPTS.map(p => (
                      <SelectItem key={p} value={p} className="text-sm">{t(`report.period.${p}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("report.setup.scopeLabel")}</p>
                <Select value={scope} onValueChange={v => { setScope(v); setGenerated(false); }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-sm">{t("report.setup.allCohorts")}</SelectItem>
                    {cohortNames.map(c => (
                      <SelectItem key={c} value={c} className="text-sm">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="include-roster" className="text-sm font-medium">{t("report.setup.includeRoster")}</Label>
                  <p className="text-[10px] text-muted-foreground">{t("report.setup.includeRosterHint")}</p>
                </div>
                <Switch
                  id="include-roster"
                  checked={includeRoster}
                  onCheckedChange={v => { setIncludeRoster(v); setGenerated(false); }}
                />
              </div>

              <Button onClick={handleGenerate} className="w-full" disabled={generating}>
                {generating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("report.setup.generating")}</> : t("report.setup.generate")}
              </Button>

              {generated && (
                <Button variant="outline" onClick={handleDownloadPdf} disabled={pdfLoading} className="w-full gap-2">
                  {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                  {pdfLoading ? t("generatingPdf") : t("downloadPdf")}
                </Button>
              )}
            </div>
          </SectionCard>

          <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-[10px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            {t("report.nothingPrivateNote")}
          </div>
        </div>

        {/* Preview */}
        <div>
          {!generated ? (
            <div className="flex h-80 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border text-center text-sm text-muted-foreground">
              <RefreshCw className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="font-medium">{t("report.preview.placeholderTitle")}</p>
              <p className="mt-1 text-xs">{t("report.preview.placeholderBody")}</p>
            </div>
          ) : (
            <div className="report-preview rounded-2xl border border-border bg-white shadow-md overflow-hidden print:shadow-none print:border-0">
              {/* Report header */}
              <div className="bg-secondary px-6 py-4 text-white">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">{t("report.documentHeader.brand")}</p>
                <p className="text-lg font-semibold mt-0.5">{scopeLabel}</p>
                <p className="text-sm text-white/70">{t("report.issuedOn", { period: periodLabel, date: today })}</p>
              </div>

              <div className="p-6 space-y-5">
                {/* KPIs */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MiniKpi label={t("report.kpis.enrolled")} value={filteredRoster.length} suffix={t("report.kpis.leadersSuffix")} />
                  <MiniKpi label={t("report.kpis.sessionsUsed")} value={`${filteredRoster.reduce((s,r)=>s+r.sessions_completed,0)}/${filteredRoster.reduce((s,r)=>s+r.sessions_entitled,0)}`} />
                  <MiniKpi label={t("report.kpis.avgRating")} value={satisfaction?.avg_rating?.toFixed(1) ?? "—"} suffix={t("report.kpis.outOfFive")} />
                  <MiniKpi label={t("report.kpis.atRisk")} value={kpis?.at_risk_count ?? 0} />
                </div>

                {/* Goal growth */}
                <div className="rounded-xl border border-border p-4">
                  <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("report.goalGrowth.label")}</p>
                  <p className="font-display text-2xl font-normal">
                    {goalGrowth?.avg_growth != null ? `+${Math.round(goalGrowth.avg_growth)}` : "—"}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">{t("report.goalGrowth.avgGrowthSuffix")}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {goalGrowth?.pct_progressing != null ? t("report.goalGrowth.pctProgressing", { pct: Math.round(goalGrowth.pct_progressing) }) : t("report.goalGrowth.noRatingsYet")}
                  </p>
                  {distributionShown ? (
                    <div className="mt-3 space-y-1.5">
                      {[
                        { label: t("report.goalGrowth.hitTarget"), n: goalGrowth!.hit_target_count, tone: "success" as const },
                        { label: t("report.goalGrowth.meaningfulProgress"), n: goalGrowth!.meaningful_progress_count, tone: "primary" as const },
                        { label: t("report.goalGrowth.justStarted"), n: goalGrowth!.just_started_count, tone: "warning" as const },
                        { label: t("report.goalGrowth.flatDeclined"), n: goalGrowth!.flat_declined_count, tone: "destructive" as const },
                      ].map(b => (
                        <div key={b.label}>
                          <div className="mb-0.5 flex justify-between text-[10px]">
                            <span className="text-muted-foreground">{b.label}</span>
                            <span>{b.n}</span>
                          </div>
                          <MiniBar pct={(b.n / distributionTotal) * 100} tone={b.tone} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] italic text-muted-foreground">{t("report.goalGrowth.distributionWithheld", { min: minLeadersForDistribution })}</p>
                  )}
                </div>

                {/* Programme & satisfaction */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border p-3">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{t("report.programmeSatisfaction.label")}</p>
                    <div className="space-y-1 text-[11px]">
                      <p className="flex justify-between"><span className="text-muted-foreground">{t("report.programmeSatisfaction.daysRemaining")}</span><span>{(() => { const d = timeline?.latest_end ? Math.max(0, Math.round((new Date(timeline.latest_end).getTime() - Date.now())/(1000*60*60*24))) : null; return d != null ? d : "—"; })()}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">{t("report.programmeSatisfaction.avgRating")}</span><span>{satisfaction?.avg_rating?.toFixed(1) ?? "—"} / 5.0</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">{t("report.programmeSatisfaction.ratedSessions")}</span><span>{satisfaction?.rated_session_count ?? 0}</span></p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border p-3">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{t("report.window.label")}</p>
                    <p className="text-[11px]">
                      {timeline?.earliest_start ? format(new Date(timeline.earliest_start), "MMM d, yyyy") : "—"}
                      {" → "}
                      {timeline?.latest_end ? format(new Date(timeline.latest_end), "MMM d, yyyy") : "—"}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{timeline?.programme_names?.join(", ")}</p>
                  </div>
                </div>

                {/* Roster (optional) */}
                {includeRoster && filteredRoster.length > 0 && (
                  <div>
                    <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t("report.roster.label")}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b text-[9px] uppercase tracking-widest text-muted-foreground">
                            <th className="py-1.5 text-left font-semibold">{t("report.roster.columns.leader")}</th>
                            <th className="py-1.5 text-left font-semibold">{t("report.roster.columns.cohort")}</th>
                            <th className="py-1.5 text-left font-semibold">{t("report.roster.columns.status")}</th>
                            <th className="py-1.5 text-left font-semibold">{t("report.roster.columns.progress")}</th>
                            <th className="py-1.5 text-left font-semibold">{t("report.roster.columns.growth")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {filteredRoster.map(r => (
                            <tr key={r.enrollment_id}>
                              <td className="py-1.5 font-medium">{r.full_name}</td>
                              <td className="py-1.5 text-muted-foreground">{r.cohort_name || "—"}</td>
                              <td className="py-1.5"><Pill tone={STATUS_TONE[r.enrollment_status]}>{t(`status.${STATUS_LABEL_KEY[r.enrollment_status]}`)}</Pill></td>
                              <td className="py-1.5 font-mono text-muted-foreground">{r.sessions_completed}/{r.sessions_entitled}</td>
                              <td className="py-1.5">{r.goal_growth != null ? t("cohorts.growthPts", { n: Math.round(r.goal_growth) }) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Footer disclaimer */}
                <p className="text-[9px] italic text-muted-foreground border-t border-border pt-3">
                  {t("report.footerDisclaimer")}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniKpi({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="font-display mt-1 text-xl font-normal leading-none">
        {value}
        {suffix && <span className="ml-1 text-xs font-normal text-muted-foreground">{suffix}</span>}
      </p>
    </div>
  );
}
