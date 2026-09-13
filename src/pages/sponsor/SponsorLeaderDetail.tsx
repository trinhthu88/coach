import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { ArrowLeft, Loader2, ShieldCheck, CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Kpi, Pill } from "@/pages/admin/_shared";
import { OnTrackPill, GoalProgressBar } from "@/pages/sponsor/_shared";
import { LeaderProgrammeJourney } from "@/pages/sponsor/CadenceVisual";
import { useSponsorLeaderDetail } from "@/hooks/sponsor/useSponsorLeaderDetail";
import { STATUS_TONE, leaderHeaderStatusKey } from "@/pages/sponsor/sponsorUtils";

const MIN_RESPONSES_FOR_SATISFACTION = 5;

/**
 * Dedicated Sponsor Leader Detail page (follow-on spec, 2026-09-13),
 * replacing SponsorLeaderDrawer. Every status/metric on this page is read
 * from the same sponsor_enrollment_summaries row the Cohort roster already
 * fetched -- there is no second calculation of Enrollment Status, On Track,
 * Cadence Completion to Date, or Goal Progress anywhere here.
 */
export default function SponsorLeaderDetail() {
  const { cohortId = "", enrollmentId = "" } = useParams<{ cohortId: string; enrollmentId: string }>();
  const { t } = useTranslation("sponsor");
  const { leader, cadenceItems, history, nextSession, notFound, loading } = useSponsorLeaderDetail(cohortId, enrollmentId);

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  if (notFound || !leader) {
    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">{t("leaderDetail.notFound")}</p>
        <Link to={`/sponsor/cohorts/${cohortId}`} className="text-[12px] font-semibold text-primary hover:underline">
          {t("leaderDetail.backToCohort")}
        </Link>
      </div>
    );
  }

  const showSatisfaction = (leader.satisfaction_rated_count ?? 0) >= MIN_RESPONSES_FOR_SATISFACTION;
  const activeGoalCount = leader.goal_setup_count ?? 0;

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <Link to="/sponsor" className="hover:text-foreground">{t("cohortDetail.breadcrumb.sponsor")}</Link>
        <span>/</span>
        <Link to={`/sponsor/cohorts/${cohortId}`} className="hover:text-foreground">{leader.cohort_label ?? "—"}</Link>
        <span>/</span>
        <span className="text-foreground">{leader.learner_display_name}</span>
      </nav>
      <Link to={`/sponsor/cohorts/${cohortId}`} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {leader.cohort_label ?? t("cohorts.header.title")}
      </Link>

      {/* LEADER HEADER — spec section 4. Enrollment Status and On Track are
          shown side by side but are never conflated: at_risk collapses to
          "Active" here (see sponsorUtils.leaderHeaderStatusKey) while On
          Track/Not On Track carries the cadence signal on its own. */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <PageHeader
          eyebrow={leader.programme_label}
          title={leader.learner_display_name}
          subtitle={leader.cohort_label ?? undefined}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill tone={STATUS_TONE[leaderHeaderStatusKey(leader.enrollment_status)]}>
            {t(`status.${leaderHeaderStatusKey(leader.enrollment_status)}`)}
          </Pill>
          <OnTrackPill onTrack={leader.on_track} />
        </div>
      </div>

      {/* CURRENT PROGRAMME INFORMATION — spec section 5. No Time Elapsed %. */}
      <SectionCard label={t("leaderDetail.currentProgramme.label")}>
        <div className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-5">
          <Fact label={t("cohortDetail.overview.programme")} value={leader.programme_label} />
          <Fact label={t("dashboard.currentCohorts.columns.cohort")} value={leader.cohort_label ?? "—"} />
          <Fact
            label={t("leaderDetail.currentProgramme.week")}
            value={leader.programme_start_date
              ? t("dashboard.currentCohorts.weekOf", {
                current: Math.max(1, Math.floor((Date.now() - new Date(leader.programme_start_date).getTime()) / 604800000) + 1),
                total: leader.programme_end_date
                  ? Math.max(1, Math.ceil((new Date(leader.programme_end_date).getTime() - new Date(leader.programme_start_date).getTime()) / 604800000))
                  : "—",
              })
              : "—"}
          />
          <Fact
            label={t("cohortDetail.overview.period")}
            value={`${format(new Date(leader.programme_start_date), "d MMM yyyy")} – ${leader.programme_end_date ? format(new Date(leader.programme_end_date), "d MMM yyyy") : t("leaderDetail.ongoing")}`}
          />
          <Fact label={t("cohortDetail.overview.status")} value={t(`status.${leaderHeaderStatusKey(leader.enrollment_status)}`)} />
        </div>
      </SectionCard>

      {/* ACTIVE PROGRAMME JOURNEY — spec section 6/7. */}
      <SectionCard label={t("leaderDetail.journey.label")}>
        <LeaderProgrammeJourney items={cadenceItems} />
      </SectionCard>

      {/* PROGRESS TO DATE — spec section 8. On Track is deliberately not
          repeated here; it already lives in the header. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Kpi
          label={t("leaderDetail.progress.cadenceToDate")}
          value={leader.due_adherence_pct != null ? `${Math.round(leader.due_adherence_pct)}%` : "—"}
          hint={leader.due_adherence_pct == null ? t("leaderDetail.progress.noneDueYet") : undefined}
        />
        <Kpi
          label={t("leaderDetail.progress.activitiesDueToDate")}
          value={leader.due_units > 0 ? t("leaderDetail.progress.completedOfDue", { completed: Math.min(leader.completed_units, leader.due_units), due: leader.due_units }) : t("leaderDetail.progress.noneDueYet")}
        />
      </div>

      {/* GOALS — spec section 9. A leader without goals reads "—", never 0%. */}
      <SectionCard label={t("leaderDetail.goals.label")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">{t("leaderDetail.goals.activeGoals")}</p>
            <p className="mt-1 font-display text-2xl font-normal">{activeGoalCount}</p>
          </div>
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">{t("leaderDetail.goals.avgProgress")}</p>
            {leader.goal_progress_pct != null ? (
              <div className="mt-2"><GoalProgressBar pct={leader.goal_progress_pct} /></div>
            ) : (
              <p className="mt-1 text-[12px] italic text-muted-foreground">{t("leaderDetail.goals.noGoalsYet")}</p>
            )}
          </div>
        </div>
      </SectionCard>

      {/* COACHING — spec section 10. The primary figure is due-to-date, not
          used-of-total-allocation. */}
      <SectionCard label={t("leaderDetail.coaching.label")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">{t("leaderDetail.coaching.dueToDate")}</p>
            <p className="mt-1 font-display text-xl font-normal">
              {leader.session_due_units > 0
                ? t("leaderDetail.coaching.completedOfDue", { completed: Math.min(leader.session_completed_units, leader.session_due_units), due: leader.session_due_units })
                : t("leaderDetail.progress.noneDueYet")}
            </p>
          </div>
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">{t("leaderDetail.coaching.totalAllocation")}</p>
            <p className="mt-1 font-display text-xl font-normal">{leader.session_required_units}</p>
          </div>
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">{t("leaderDetail.coaching.nextSession")}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium">
              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
              {nextSession ? format(new Date(nextSession), "d MMM yyyy") : t("leaderDetail.coaching.noneScheduled")}
            </p>
          </div>
        </div>
      </SectionCard>

      {/* SATISFACTION / EXPERIENCE — one equal-weighted leader average over
          all applicable numeric Sponsor-visible sources. */}
      {showSatisfaction && (
        <SectionCard label={t("cohortDetail.kpis.overallSatisfaction")}>
          <p className="font-display text-2xl font-normal">{leader.satisfaction_avg?.toFixed(1)} / 5</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("cohortDetail.kpis.responseCount", { count: leader.satisfaction_rated_count })}</p>
        </SectionCard>
      )}

      {/* PROGRAMME HISTORY — spec section 12. Never contributes to any
          current-enrollment calculation above; this is a read-only list. */}
      <SectionCard label={t("leaderDetail.history.label")}>
        {history.length === 0 ? (
          <p className="py-4 text-center text-[12px] italic text-muted-foreground">{t("leaderDetail.history.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">{t("leaderDetail.history.columns.programme")}</th>
                  <th className="px-2 py-2 text-left font-semibold hidden sm:table-cell">{t("leaderDetail.history.columns.cohort")}</th>
                  <th className="px-2 py-2 text-left font-semibold">{t("leaderDetail.history.columns.period")}</th>
                  <th className="px-2 py-2 text-left font-semibold">{t("leaderDetail.history.columns.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.map((h) => (
                  <tr key={h.enrollment_id}>
                    <td className="px-2 py-2.5 font-medium">{h.programme_label}</td>
                    <td className="px-2 py-2.5 text-muted-foreground hidden sm:table-cell">{h.cohort_label}</td>
                    <td className="px-2 py-2.5 text-muted-foreground">
                      {format(new Date(h.start_date), "MMM yyyy")} – {h.end_date ? format(new Date(h.end_date), "MMM yyyy") : "—"}
                    </td>
                    <td className="px-2 py-2.5"><Pill tone="muted">{t("status.completed")}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        {t("cohorts.privacyNote")}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}
