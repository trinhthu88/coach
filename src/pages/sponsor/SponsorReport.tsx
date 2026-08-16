import { useState } from "react";
import { format } from "date-fns";
import { FileDown, ShieldCheck, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Pill, MiniBar } from "@/pages/admin/_shared";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

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

const PERIOD_OPTS = [
  { value: "all", label: "All time" },
  { value: "90d", label: "Last 90 days" },
  { value: "60d", label: "Last 60 days" },
  { value: "30d", label: "Last 30 days" },
];

export default function SponsorReport() {
  const { kpis, goalGrowth, roster, satisfaction, timeline, minLeadersForDistribution, loading } = useSponsorDashboardData();
  const [period, setPeriod] = useState("all");
  const [scope, setScope] = useState("all");
  const [includeRoster, setIncludeRoster] = useState(true);
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);

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

  function handlePrint() {
    window.print();
  }

  const scopeLabel = scope === "all" ? "All cohorts" : scope;
  const periodLabel = PERIOD_OPTS.find(p => p.value === period)?.label ?? "All time";
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
        eyebrow="Sponsor"
        title="Export"
        emphasis="report."
        subtitle="A one-pager for your QBR. Same numbers as the dashboard, reformatted for a budget conversation."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Setup panel */}
        <div className="space-y-4">
          <SectionCard label="Report setup">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Period</p>
                <Select value={period} onValueChange={v => { setPeriod(v); setGenerated(false); }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIOD_OPTS.map(p => (
                      <SelectItem key={p.value} value={p.value} className="text-sm">{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Scope</p>
                <Select value={scope} onValueChange={v => { setScope(v); setGenerated(false); }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-sm">All cohorts</SelectItem>
                    {cohortNames.map(c => (
                      <SelectItem key={c} value={c} className="text-sm">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="include-roster" className="text-sm font-medium">Include leader roster</Label>
                  <p className="text-[10px] text-muted-foreground">Off gives a fully aggregate one-pager — no names.</p>
                </div>
                <Switch
                  id="include-roster"
                  checked={includeRoster}
                  onCheckedChange={v => { setIncludeRoster(v); setGenerated(false); }}
                />
              </div>

              <Button onClick={handleGenerate} className="w-full" disabled={generating}>
                {generating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</> : "Generate report"}
              </Button>

              {generated && (
                <Button variant="outline" onClick={handlePrint} className="w-full gap-2">
                  <FileDown className="h-4 w-4" /> Download PDF · 1 page
                </Button>
              )}
            </div>
          </SectionCard>

          <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-[10px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Nothing private is included. The file is safe to forward.
          </div>
        </div>

        {/* Preview */}
        <div>
          {!generated ? (
            <div className="flex h-80 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border text-center text-sm text-muted-foreground">
              <RefreshCw className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="font-medium">Your one-pager previews here</p>
              <p className="mt-1 text-xs">Pick a period and scope, then generate.</p>
            </div>
          ) : (
            <div className="report-preview rounded-2xl border border-border bg-white shadow-md overflow-hidden print:shadow-none print:border-0">
              {/* Report header */}
              <div className="bg-secondary px-6 py-4 text-white">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Clariva Sponsor Summary</p>
                <p className="text-lg font-semibold mt-0.5">{scopeLabel}</p>
                <p className="text-sm text-white/70">{periodLabel} · issued {today}</p>
              </div>

              <div className="p-6 space-y-5">
                {/* KPIs */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MiniKpi label="Enrolled" value={filteredRoster.length} suffix="leaders" />
                  <MiniKpi label="Sessions used" value={`${filteredRoster.reduce((s,r)=>s+r.sessions_completed,0)}/${filteredRoster.reduce((s,r)=>s+r.sessions_entitled,0)}`} />
                  <MiniKpi label="Avg rating" value={satisfaction?.avg_rating?.toFixed(1) ?? "—"} suffix="/ 5.0" />
                  <MiniKpi label="At risk" value={kpis?.at_risk_count ?? 0} />
                </div>

                {/* Goal growth */}
                <div className="rounded-xl border border-border p-4">
                  <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Goal growth</p>
                  <p className="font-display text-2xl font-normal">
                    {goalGrowth?.avg_growth != null ? `+${Math.round(goalGrowth.avg_growth)}` : "—"}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">avg growth</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {goalGrowth?.pct_progressing != null ? `${Math.round(goalGrowth.pct_progressing)}% progressing` : "No ratings yet"}
                  </p>
                  {distributionShown ? (
                    <div className="mt-3 space-y-1.5">
                      {[
                        { label: "Hit target", n: goalGrowth!.hit_target_count, tone: "success" as const },
                        { label: "Meaningful progress", n: goalGrowth!.meaningful_progress_count, tone: "primary" as const },
                        { label: "Just started", n: goalGrowth!.just_started_count, tone: "warning" as const },
                        { label: "Flat / declined", n: goalGrowth!.flat_declined_count, tone: "destructive" as const },
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
                    <p className="mt-2 text-[10px] italic text-muted-foreground">Distribution withheld — cohort under {minLeadersForDistribution} leaders.</p>
                  )}
                </div>

                {/* Programme & satisfaction */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border p-3">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Programme & satisfaction</p>
                    <div className="space-y-1 text-[11px]">
                      <p className="flex justify-between"><span className="text-muted-foreground">Days remaining</span><span>{(() => { const d = timeline?.latest_end ? Math.max(0, Math.round((new Date(timeline.latest_end).getTime() - Date.now())/(1000*60*60*24))) : null; return d != null ? d : "—"; })()}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Avg rating</span><span>{satisfaction?.avg_rating?.toFixed(1) ?? "—"} / 5.0</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Rated sessions</span><span>{satisfaction?.rated_session_count ?? 0}</span></p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border p-3">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Window</p>
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
                    <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Roster</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b text-[9px] uppercase tracking-widest text-muted-foreground">
                            <th className="py-1.5 text-left font-semibold">Leader</th>
                            <th className="py-1.5 text-left font-semibold">Cohort</th>
                            <th className="py-1.5 text-left font-semibold">Status</th>
                            <th className="py-1.5 text-left font-semibold">Prog.</th>
                            <th className="py-1.5 text-left font-semibold">Growth</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {filteredRoster.map(r => (
                            <tr key={r.enrollment_id}>
                              <td className="py-1.5 font-medium">{r.full_name}</td>
                              <td className="py-1.5 text-muted-foreground">{r.cohort_name || "—"}</td>
                              <td className="py-1.5"><Pill tone={STATUS_TONE[r.enrollment_status]}>{STATUS_LABEL[r.enrollment_status]}</Pill></td>
                              <td className="py-1.5 font-mono text-muted-foreground">{r.sessions_completed}/{r.sessions_entitled}</td>
                              <td className="py-1.5">{r.goal_growth != null ? `+${Math.round(r.goal_growth)} pts` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Footer disclaimer */}
                <p className="text-[9px] italic text-muted-foreground border-t border-border pt-3">
                  Prepared from aggregate programme data. Session notes, chat messages, reflections and goal wording are excluded from Clariva sponsor reporting and were not available to the requester.
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
