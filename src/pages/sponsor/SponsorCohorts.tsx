import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  Layers3,
  Loader2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import type { SponsorCohortSummary } from "@/hooks/sponsor/useSponsorDashboardData";
import { cn } from "@/lib/utils";

export default function SponsorCohorts() {
  const { t } = useTranslation("sponsor");
  const { kpis, cohortSummaries, minLeadersForDistribution, loading } = useSponsorDashboardData();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t("cohorts.header.eyebrow")}
        title={t("cohorts.header.title")}
        emphasis={t("cohorts.header.emphasis")}
        subtitle={t("cohorts.header.subtitle")}
      />

      <section className="overflow-hidden rounded-[24px] border border-secondary/20 bg-secondary text-secondary-foreground shadow-[0_18px_50px_-32px_rgba(8,28,38,.8)]">
        <div className="flex flex-wrap items-start justify-between gap-5 border-b border-white/10 px-6 py-6 sm:px-8">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary-foreground/60">
              {t("cohorts.rolledUpLabel")}
            </p>
            <h2 className="mt-2 font-display text-[clamp(1.8rem,4vw,2.7rem)] font-light leading-none tracking-tight">
              {kpis?.enrollment_count ?? 0}{" "}
              <span className="text-primary-foreground/60">{t("cohorts.kpis.leadersEnrolled").toLowerCase()}</span>
            </h2>
            <p className="mt-3 max-w-xl text-[12px] leading-relaxed text-primary-foreground/65">
              {t("cohorts.rolledUpDescription")}
            </p>
          </div>
          <Link
            to="/sponsor"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3.5 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-white/10"
          >
            {t("cohorts.backToDashboard")} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid divide-y divide-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <RollupMetric
            icon={CheckCircle2}
            label={t("cohorts.kpis.onTrack")}
            value={kpis?.on_track_count ?? 0}
            sub={t("cohorts.kpis.onTrackSub", { total: kpis?.enrollment_count ?? 0 })}
            tone="teal"
          />
          <RollupMetric
            icon={CircleAlert}
            label={t("cohorts.kpis.atRisk")}
            value={kpis?.at_risk_count ?? 0}
            sub={t("cohorts.kpis.atRiskSub")}
            tone="amber"
          />
          <RollupMetric
            icon={BarChart3}
            label={t("cohorts.kpis.sessionsUsed")}
            value={`${kpis?.completed_units ?? 0} / ${kpis?.required_units ?? 0}`}
            sub={t("cohorts.kpis.sessionsSub")}
            tone="blue"
          />
        </div>
      </section>

      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">{t("cohorts.cardEyebrow")}</p>
          <h2 className="mt-1 font-display text-[1.8rem] font-light tracking-tight text-foreground">
            {t("cohorts.cardTitle")}
          </h2>
        </div>
        <span className="hidden text-[11px] text-muted-foreground sm:block">
          {cohortSummaries.length} {t("cohorts.cardCount")}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {cohortSummaries.map((cohort) => (
          <CohortCard
            key={cohort.cohort_id}
            cohort={cohort}
            minLeadersForDistribution={minLeadersForDistribution}
          />
        ))}
        {cohortSummaries.length === 0 && (
          <div className="col-span-full rounded-[24px] border border-dashed border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
            {t("cohorts.noCohortsFound")}
          </div>
        )}
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-primary/10 bg-primary-soft/50 px-5 py-4 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>{t("cohorts.privacyNote")}</span>
      </div>
    </div>
  );
}

function RollupMetric({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string | number;
  sub: string;
  tone: "teal" | "amber" | "blue";
}) {
  return (
    <div className="flex items-start gap-3 px-6 py-5 sm:px-8">
      <Icon
        className={cn(
          "mt-1 h-4 w-4 shrink-0",
          tone === "teal" && "text-[#7dd6c0]",
          tone === "amber" && "text-[#f0c36a]",
          tone === "blue" && "text-[#8bc7ed]",
        )}
      />
      <div>
        <p className="font-display text-3xl font-light leading-none">{value}</p>
        <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">{label}</p>
        <p className="mt-1 text-[10px] text-white/45">{sub}</p>
      </div>
    </div>
  );
}

function CohortCard({
  cohort,
  minLeadersForDistribution,
}: {
  cohort: SponsorCohortSummary;
  minLeadersForDistribution: number;
}) {
  const { t } = useTranslation("sponsor");
  const suppressed = cohort.suppressed;
  const leaderCount = cohort.enrollment_count ?? 0;
  const onTrackPct = cohort.on_track_pct ?? 0;
  const completionPct = cohort.full_completion_pct ?? 0;
  return (
    <article className="group overflow-hidden rounded-[24px] border border-[#e6dfd4] bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_18px_42px_-28px_rgba(20,80,90,.45)]">
      <div className="h-1 bg-gradient-to-r from-primary via-[#7dcfe3] to-transparent" />
      <div className="p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              <Layers3 className="h-3.5 w-3.5" />
              {cohort.programme_label || t("cohorts.unnamedCohort")}
            </p>
            <h3 className="truncate font-display text-[1.45rem] font-normal leading-tight tracking-tight">
              {cohort.cohort_label || t("cohorts.unnamedCohort")}
            </h3>
          </div>
          <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
            {suppressed ? t("cohorts.suppressedLabel") : cohort.pace_status === "completed" ? t("cohorts.complete") : t("cohorts.active")}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
          <DateMetric label={t("cohorts.programmeDates.starts")} value={cohort.programme_start_date} fallback={t("cohorts.programmeDates.notSet")} />
          <DateMetric label={t("cohorts.programmeDates.ends")} value={cohort.programme_end_date} fallback={t("cohorts.programmeDates.ongoing")} />
        </div>

        <div className="mt-6 flex items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="font-display text-2xl font-normal">{suppressed ? "—" : leaderCount}</span>
            <span className="pb-0.5 text-[11px] text-muted-foreground">
              {suppressed
                ? t("cohorts.suppressed", { min: minLeadersForDistribution })
                : t("cohorts.leaderCount", { count: leaderCount })}
            </span>
          </div>
          <Link
            to={`/sponsor/cohorts/${cohort.cohort_id}`}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-primary transition-colors hover:text-secondary"
          >
            {t("cohorts.viewCohort")} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {suppressed ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-4 text-[11px] leading-relaxed text-muted-foreground">
            {t("cohorts.suppressedNote", { min: minLeadersForDistribution })}
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 rounded-2xl bg-[#fbf9f6] p-4 sm:grid-cols-4">
              <MiniMetric label={t("cohorts.completion")} value={`${Math.round(completionPct)}%`} />
              <MiniMetric label={t("cohorts.onTrackPct")} value={`${Math.round(onTrackPct)}%`} />
              <MiniMetric label={t("cohorts.avgGrowth")} value={cohort.goal_progress_pct == null ? "—" : `${Math.round(cohort.goal_progress_pct)}%`} />
              <MiniMetric label={t("cohorts.satisfaction")} value={cohort.satisfaction_avg == null ? "—" : cohort.satisfaction_avg.toFixed(1)} />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
              <span>{t("cohorts.sessions")} <b className="text-foreground">{cohort.completed_units ?? 0} / {cohort.required_units ?? 0}</b></span>
              <span>{t("cohorts.goals")} <b className="text-foreground">{cohort.goal_setup_count ?? 0} / {cohort.goal_count ?? 0}</b></span>
              <span>{t("cohorts.actions")} <b className="text-foreground">{cohort.completed_action_count ?? 0} / {cohort.total_action_count ?? 0}</b></span>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg leading-none">{value}</p>
    </div>
  );
}

function DateMetric({ label, value, fallback }: { label: string; value: string | null; fallback: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[11px] font-medium text-foreground">
        {value ? format(new Date(`${value}T12:00:00`), "MMM d, yyyy") : fallback}
      </p>
    </div>
  );
}