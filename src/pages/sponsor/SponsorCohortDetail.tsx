import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import {
  Users, CheckCircle2, AlertTriangle, CalendarCheck, Star, Clock,
  ArrowLeft, Loader2, Gauge, UserX, ShieldCheck,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Kpi, Pill, Avatar } from "@/pages/admin/_shared";
import {
  RosterTable, GoalGrowthCard, ProgrammeEngagementTable, CoachUtilisationBars,
} from "@/pages/sponsor/_shared";
import { cohortProgress } from "@/pages/sponsor/sponsorUtils";
import { useSponsorCohortData } from "@/hooks/sponsor/useSponsorCohortData";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { SponsorLeaderDrawer } from "./SponsorLeaderDrawer";
import { supabase } from "@/integrations/supabase/client";

interface CohortRecord {
  name: string;
  start_date: string | null;
  end_date: string | null;
}

const FUNNEL_TONES = ["bg-teal-500", "bg-teal-400", "bg-amber-300", "bg-amber-400", "bg-amber-500"];

export default function SponsorCohortDetail() {
  const { cohortId = "" } = useParams<{ cohortId: string }>();
  const cohortName = decodeURIComponent(cohortId);
  const { t } = useTranslation("sponsor");
  const {
    kpis, goalGrowth, roster, satisfaction, minLeadersForDistribution,
    programmeEngagement, redFlags, coachUtilisation, loading,
  } = useSponsorCohortData(cohortName);
  const [cohort, setCohort] = useState<CohortRecord | null>(null);
  const [selectedLeader, setSelectedLeader] = useState<SponsorRosterRow | null>(null);

  // The one direct table query on this page — cohorts is the exception to
  // the sponsor_* RPC-only rule, since none of those RPCs carry per-cohort
  // dates. `.eq('name', ...)` rather than `.eq('id', ...)` because
  // sponsor_roster() (and every other sponsor_* RPC) only ever returns
  // cohort_name, never a cohort id — the route param is the name.
  useEffect(() => {
    let mounted = true;
    supabase
      .from("cohorts")
      .select("name, start_date, end_date")
      .eq("name", cohortName)
      .maybeSingle()
      .then(({ data }) => {
        if (mounted && data) setCohort(data);
      });
    return () => {
      mounted = false;
    };
  }, [cohortName]);

  const suppressIndividuals = roster.length < minLeadersForDistribution;

  const progress = cohort ? cohortProgress(cohort.start_date, cohort.end_date) : null;
  const programmeStatus: "upcoming" | "active" | "complete" | null = (() => {
    if (!cohort?.start_date) return null;
    const now = Date.now();
    if (new Date(cohort.start_date).getTime() > now) return "upcoming";
    if (cohort.end_date && new Date(cohort.end_date).getTime() < now) return "complete";
    return "active";
  })();
  const sessionsPerLeader = roster.length ? Math.max(...roster.map((r) => r.sessions_entitled)) : null;

  const sessionsCompleted = roster.reduce((s, r) => s + r.sessions_completed, 0);
  const sessionsEntitled = roster.reduce((s, r) => s + r.sessions_entitled, 0);
  const atRiskCount = roster.filter((r) => r.enrollment_status === "at_risk").length;
  const daysRemaining = progress ? Math.max(0, progress.total - progress.elapsed) : null;
  const avgGoalGrowthShown = !suppressIndividuals && goalGrowth?.pct_progressing != null;

  const funnel = useMemo(() => {
    const enrolled = roster.length;
    const stages = [
      { key: "enrolled", count: enrolled },
      { key: "firstSession", count: roster.filter((r) => r.sessions_completed >= 1).length },
      { key: "midpoint", count: roster.filter((r) => r.sessions_completed >= r.sessions_entitled * 0.5).length },
      { key: "finalSession", count: roster.filter((r) => r.sessions_entitled > 0 && r.sessions_completed >= r.sessions_entitled).length },
      { key: "complete", count: roster.filter((r) => r.enrollment_status === "completed").length },
    ];
    return stages.map((s) => ({ ...s, pct: enrolled > 0 ? (s.count / enrolled) * 100 : 0 }));
  }, [roster]);

  const paceRisk = useMemo(() => {
    if (!progress || progress.elapsed <= 0) return null;
    const atRisk = roster.filter((r) => {
      const projected = (r.sessions_completed / progress.elapsed) * progress.total;
      return projected < r.sessions_entitled * 0.8;
    });
    return atRisk;
  }, [roster, progress]);

  const neverStartedCount = roster.filter((r) => r.sessions_completed === 0).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/sponsor/cohorts" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("cohorts.header.title")} {t("cohorts.header.emphasis")}
      </Link>

      <PageHeader
        eyebrow={t("cohortDetail.header.eyebrow")}
        title={t("cohortDetail.header.title")}
        emphasis={cohortName}
        subtitle={t("cohortDetail.header.subtitle")}
      />

      {/* SECTION 1 — HIGHLIGHT NUMBERS */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <Kpi label={t("dashboard.kpis.leadersEnrolled")} value={roster.length} icon={Users} tone="primary" />
        <Kpi label={t("dashboard.kpis.onTrack")} value={kpis?.on_track_count ?? 0} icon={CheckCircle2} tone="success" />
        <Kpi label={t("dashboard.kpis.enrolledActive")} value={kpis?.enrolled_active_count ?? 0} icon={Users} tone="primary" />
        <Kpi label={t("dashboard.kpis.atRisk")} value={atRiskCount} icon={AlertTriangle} tone="warning" />
        <Kpi
          label={t("dashboard.kpis.sessionsUsed")}
          value={`${sessionsCompleted} / ${sessionsEntitled} · ${sessionsEntitled > 0 ? Math.round((sessionsCompleted / sessionsEntitled) * 100) : 0}%`}
          icon={CalendarCheck}
          tone="secondary"
        />
        <Kpi
          label={t("dashboard.kpis.avgSatisfaction")}
          value={satisfaction?.avg_rating != null ? `${satisfaction.avg_rating.toFixed(1)} / 5.0` : "—"}
          icon={Star}
          tone="accent"
        />
        {daysRemaining != null && (
          <Kpi label={t("dashboard.timeline.label")} value={daysRemaining} icon={Clock} tone="secondary" />
        )}
        <Kpi
          label={t("dashboard.goalGrowth.averageGrowth")}
          value={avgGoalGrowthShown ? `${Math.round(goalGrowth!.pct_progressing)}%` : t("cohorts.suppressed", { min: minLeadersForDistribution })}
          tone="accent"
        />
      </div>

      {/* SECTION 2 — PROGRAMME DETAILS */}
      <SectionCard label={t("cohortDetail.programmeDetails.label")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium">
              {cohort?.start_date ? format(new Date(cohort.start_date), "MMM d, yyyy") : "—"}
              {" → "}
              {cohort?.end_date ? format(new Date(cohort.end_date), "MMM d, yyyy") : "—"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {sessionsPerLeader != null
                ? t("cohortDetail.programmeDetails.sessionsPerLeader", { count: sessionsPerLeader })
                : null}
            </p>
          </div>
          {programmeStatus && (
            <Pill tone={programmeStatus === "active" ? "success" : programmeStatus === "upcoming" ? "primary" : "muted"}>
              {t(`cohortDetail.programmeDetails.status.${programmeStatus}`)}
            </Pill>
          )}
        </div>
        {progress && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{cohort?.start_date ? format(new Date(cohort.start_date), "MMM d") : ""}</span>
              <span className="font-medium text-foreground">
                {t("cohortDetail.programmeDetails.dayOf", { elapsed: progress.elapsed, total: progress.total })}
              </span>
              <span>{cohort?.end_date ? format(new Date(cohort.end_date), "MMM d") : ""}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, progress.pct)}%` }} />
            </div>
          </div>
        )}
      </SectionCard>

      {/* SECTION 3 — GOAL GROWTH */}
      <GoalGrowthCard goalGrowth={goalGrowth} minLeadersForDistribution={minLeadersForDistribution} />

      {/* SECTION 4 — PROGRAMME ENGAGEMENT */}
      {programmeEngagement.length > 0 && (
        <SectionCard label={t("dashboard.programmeEngagement.label")}>
          <ProgrammeEngagementTable rows={programmeEngagement} lowCompletionNote />
        </SectionCard>
      )}

      {/* SECTION 5 — COMPLETION FUNNEL */}
      <SectionCard label={t("cohortDetail.completionFunnel.label")}>
        <div className="space-y-2.5">
          {funnel.map((stage, i) => (
            <div key={stage.key}>
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">{t(`cohortDetail.completionFunnel.${stage.key}`)}</span>
                <span className="font-medium">{stage.count} · {Math.round(stage.pct)}%</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${FUNNEL_TONES[i]}`} style={{ width: `${stage.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* SECTION 6 — FALLING BEHIND */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard label={t("dashboard.redFlags.label")}>
          {redFlags.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">{t("dashboard.alerts.empty")}</p>
          ) : suppressIndividuals ? (
            <p className="text-[12px] text-muted-foreground">{t("cohorts.suppressed", { min: minLeadersForDistribution })}: {redFlags.length}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {redFlags.map((r) => (
                <div key={r.user_id} className="flex items-center gap-3">
                  <Avatar name={r.full_name} tone="accent" size={24} />
                  <span className="flex-1 text-[12px]">{r.full_name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {r.days_since_last_activity >= 999
                      ? t("dashboard.redFlags.noActivityYet")
                      : t("dashboard.redFlags.daysInactive", { count: r.days_since_last_activity })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard label={t("cohortDetail.paceRisk.label")}>
          {paceRisk == null ? (
            <p className="text-[12px] italic text-muted-foreground">—</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Gauge className="h-5 w-5 text-warning" />
                <p className="font-display text-[1.75rem] font-normal leading-none">{paceRisk.length}</p>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{t("cohortDetail.paceRisk.description")}</p>
              {!suppressIndividuals && paceRisk.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {paceRisk.map((r) => (
                    <span key={r.enrollment_id} className="text-[12px]">{r.full_name}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard label={t("cohortDetail.neverStarted.label")}>
          <div className="flex items-center gap-2">
            <UserX className="h-5 w-5 text-muted-foreground" />
            <p className="font-display text-[1.75rem] font-normal leading-none">{neverStartedCount}</p>
          </div>
        </SectionCard>
      </div>

      {/* SECTION 7 — ROSTER */}
      <SectionCard label={t("dashboard.roster.label", { count: roster.length })}>
        <RosterTable rows={roster} onSelect={setSelectedLeader} showCohortColumn={false} sortable />
      </SectionCard>

      {/* SECTION 8 — COACH UTILISATION */}
      {coachUtilisation.length > 0 && (
        <SectionCard label={t("dashboard.coachUtilisation.label")}>
          <CoachUtilisationBars rows={coachUtilisation} />
        </SectionCard>
      )}

      <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        {t("cohorts.privacyNote")}
      </div>

      <SponsorLeaderDrawer leader={selectedLeader} onClose={() => setSelectedLeader(null)} />
    </div>
  );
}
