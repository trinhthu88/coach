import { format, differenceInCalendarDays } from "date-fns";
import { Users, CheckCircle2, AlertTriangle, CalendarCheck, Star, CalendarRange, ShieldCheck, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Kpi, SectionCard, Pill, MiniBar } from "@/pages/admin/_shared";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";

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

export default function SponsorDashboard() {
  const { kpis, goalGrowth, roster, satisfaction, timeline, minLeadersForDistribution, loading } = useSponsorDashboardData();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const distributionShown = goalGrowth?.hit_target_count != null;
  const distributionTotal = distributionShown
    ? (goalGrowth!.hit_target_count + goalGrowth!.meaningful_progress_count + goalGrowth!.just_started_count + goalGrowth!.flat_declined_count) || 1
    : 1;

  const daysRemaining = timeline?.latest_end
    ? Math.max(0, differenceInCalendarDays(new Date(timeline.latest_end), new Date()))
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Programme"
        title="Sponsor"
        emphasis="dashboard"
        subtitle="Participation, progress, and outcomes for your organization's leaders."
      />

      {/* KPI ROW */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <Kpi label="Leaders enrolled" value={kpis?.leaders_enrolled ?? 0} icon={Users} tone="primary" />
        <Kpi label="On track" value={kpis?.on_track_count ?? 0} icon={CheckCircle2} tone="success" />
        <Kpi label="At risk" value={kpis?.at_risk_count ?? 0} icon={AlertTriangle} tone="warning" />
        <Kpi
          label="Sessions used"
          value={`${kpis?.sessions_used ?? 0} / ${kpis?.sessions_entitled ?? 0}`}
          icon={CalendarCheck}
          tone="secondary"
        />
      </div>

      {/* GOAL GROWTH */}
      <SectionCard label="Goal growth">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Average growth</p>
            <p className="font-display mt-1 text-[1.8rem] font-normal leading-none">
              {goalGrowth?.avg_growth != null ? `+${Math.round(goalGrowth.avg_growth)}` : "—"}
              <span className="ml-1 text-sm font-normal text-muted-foreground">rating pts</span>
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {goalGrowth?.pct_progressing != null
                ? `${Math.round(goalGrowth.pct_progressing)}% of leaders have closed at least half the gap to their target`
                : "No goal ratings yet"}
            </p>
          </div>
          <div>
            {distributionShown ? (
              <div className="space-y-2">
                <Row label="Hit target" count={goalGrowth!.hit_target_count} total={distributionTotal} tone="success" />
                <Row label="Meaningful progress" count={goalGrowth!.meaningful_progress_count} total={distributionTotal} tone="primary" />
                <Row label="Just started" count={goalGrowth!.just_started_count} total={distributionTotal} tone="warning" />
                <Row label="Flat / declined" count={goalGrowth!.flat_declined_count} total={distributionTotal} tone="destructive" />
              </div>
            ) : (
              <p className="rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">
                Distribution hidden — shown once your organization has at least {minLeadersForDistribution} enrolled leaders, so no individual's progress can be singled out.
              </p>
            )}
          </div>
        </div>
        <p className="mt-4 text-[10px] italic text-muted-foreground">
          Goal titles and descriptions are never shared — only overall growth in self-rated progress.
        </p>
      </SectionCard>

      {/* ROSTER */}
      <SectionCard label={`Roster (${roster.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left font-semibold">Leader</th>
                <th className="px-2 py-2 text-left font-semibold">Cohort</th>
                <th className="px-2 py-2 text-left font-semibold">Status</th>
                <th className="px-2 py-2 text-left font-semibold">Progress</th>
                <th className="px-2 py-2 text-left font-semibold">Sessions</th>
                <th className="px-2 py-2 text-left font-semibold">Goal growth</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {roster.map((r) => (
                <tr key={r.enrollment_id}>
                  <td className="px-2 py-2.5 font-medium">{r.full_name}</td>
                  <td className="px-2 py-2.5 text-muted-foreground">{r.cohort_name || "—"}</td>
                  <td className="px-2 py-2.5"><Pill tone={STATUS_TONE[r.enrollment_status]}>{STATUS_LABEL[r.enrollment_status]}</Pill></td>
                  <td className="px-2 py-2.5">
                    <div className="w-24"><MiniBar pct={r.progress_pct} tone="primary" /></div>
                  </td>
                  <td className="px-2 py-2.5 font-mono text-muted-foreground">{r.sessions_completed}/{r.sessions_entitled}</td>
                  <td className="px-2 py-2.5">
                    {r.goal_growth != null ? `+${Math.round(r.goal_growth)} pts` : <span className="italic text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
              {roster.length === 0 && (
                <tr><td colSpan={6} className="px-2 py-8 text-center text-muted-foreground">No leaders enrolled yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* TIMELINE + SATISFACTION */}
      <div className="grid gap-4 sm:grid-cols-2">
        <SectionCard label="Programme timeline">
          <div className="flex items-center gap-3">
            <CalendarRange className="h-8 w-8 text-primary" />
            <div>
              <p className="text-[13px] font-medium">
                {timeline?.earliest_start ? format(new Date(timeline.earliest_start), "MMM d, yyyy") : "—"}
                {" → "}
                {timeline?.latest_end ? format(new Date(timeline.latest_end), "MMM d, yyyy") : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {daysRemaining != null ? `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining` : "No end date set"}
                {timeline?.programme_names?.length ? ` · ${timeline.programme_names.join(", ")}` : ""}
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard label="Satisfaction">
          <div className="flex items-center gap-3">
            <Star className="h-8 w-8 text-warning" />
            <div>
              <p className="text-[13px] font-medium">
                {satisfaction?.avg_rating != null ? `${satisfaction.avg_rating.toFixed(1)} / 5` : "No ratings yet"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {satisfaction?.rated_session_count ?? 0} rated session{satisfaction?.rated_session_count === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* PRIVACY NOTICE */}
      <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
        Session notes, chat messages, and personal reflections stay private between the leader and their coach. Goal titles and descriptions are never shared — only overall growth in self-rated progress.
      </div>
    </div>
  );
}

function Row({ label, count, total, tone }: { label: string; count: number; total: number; tone: "success" | "primary" | "warning" | "destructive" }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{count}</span>
      </div>
      <MiniBar pct={pct} tone={tone} />
    </div>
  );
}
