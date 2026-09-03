import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { format, differenceInCalendarDays } from "date-fns";
import {
  Users, CheckCircle2, AlertTriangle, CalendarCheck, Star,
  CalendarRange, ShieldCheck, Loader2, ArrowRight, Building2,
  Clock, Filter, ChevronDown, GraduationCap, type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard, Pill, MiniBar } from "@/pages/admin/_shared";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { SponsorLeaderDrawer } from "./SponsorLeaderDrawer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

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

function initials(name: string) {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

export default function SponsorDashboard() {
  const { t } = useTranslation("sponsor");
  const { user } = useAuth();
  const { kpis, goalGrowth, roster, satisfaction, timeline, minLeadersForDistribution, programmeEngagement, redFlags, loading } = useSponsorDashboardData();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [selectedLeader, setSelectedLeader] = useState<SponsorRosterRow | null>(null);
  const [cohortFilter, setCohortFilter] = useState<string>("all");

  useEffect(() => {
    if (!user) return;
    // RLS ("Organizations: sponsor view own") already scopes this to exactly
    // the caller's own org, so no id lookup is needed first. maybeSingle()
    // (not single()) because a sponsor account not yet linked to an
    // organization legitimately has zero rows here — single() 406s on that.
    supabase.from("organizations").select("name").maybeSingle().then(({ data }) => {
      if (data) setOrgName(data.name);
    });
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const isFirstLogin = !kpis || kpis.leaders_enrolled === 0;

  const distributionShown = goalGrowth?.hit_target_count != null && !isFirstLogin;
  const distributionTotal = distributionShown
    ? (goalGrowth!.hit_target_count + goalGrowth!.meaningful_progress_count + goalGrowth!.just_started_count + goalGrowth!.flat_declined_count) || 1
    : 1;

  const daysRemaining = timeline?.latest_end
    ? Math.max(0, differenceInCalendarDays(new Date(timeline.latest_end), new Date()))
    : null;

  const daysUntilStart = timeline?.earliest_start
    ? Math.max(0, differenceInCalendarDays(new Date(timeline.earliest_start), new Date()))
    : null;

  // Cohort filter
  const cohortNames = Array.from(new Set(roster.map(r => r.cohort_name).filter(Boolean)));
  const filteredRoster = cohortFilter === "all"
    ? roster
    : roster.filter(r => r.cohort_name === cohortFilter);

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {orgName && (
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                <span>{orgName}</span>
              </div>
            )}
            <PageHeader
              eyebrow={t("dashboard.header.eyebrow")}
              title={t("dashboard.header.title")}
              emphasis={t("dashboard.header.emphasis")}
              subtitle={t("dashboard.header.subtitle")}
            />
          </div>
          {cohortNames.length > 1 && (
            <Link
              to="/sponsor/cohorts"
              className="flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
            >
              {t("dashboard.compareAllCohorts")} <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        {/* First-login empty state */}
        {isFirstLogin && (
          <div className="rounded-2xl border border-border bg-gradient-to-br from-primary-soft to-card p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                {daysUntilStart !== null && daysUntilStart > 0 ? (
                  <>
                    <p className="font-semibold">{t("dashboard.firstLogin.startsInDay", { count: daysUntilStart })}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("dashboard.firstLogin.startsInBody")}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">{t("dashboard.firstLogin.dataAppears")}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("dashboard.firstLogin.dataAppearsBody")}
                    </p>
                  </>
                )}
                {roster.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {t("dashboard.firstLogin.enrolledAwaiting", { count: roster.length })}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* HEADLINE NUMBERS — a lighter, larger-type summary rather than the
            dense admin-style KPI grid; sponsors are occasional visitors
            checking in, not power users monitoring the whole platform. */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <HeadlineStat label={t("dashboard.kpis.onTrack")} value={kpis?.on_track_count ?? 0} icon={CheckCircle2} tone="success" />
            <HeadlineStat label={t("dashboard.kpis.leadersEnrolled")} value={kpis?.leaders_enrolled ?? 0} icon={Users} tone="primary" />
            <HeadlineStat
              label={t("dashboard.kpis.sessionsUsed")}
              value={`${kpis?.sessions_used ?? 0} / ${kpis?.sessions_entitled ?? 0}`}
              icon={CalendarCheck}
              tone="secondary"
            />
          </div>
          {(kpis?.at_risk_count ?? 0) > 0 && (
            <p className="mt-5 flex items-center gap-1.5 border-t border-border pt-4 text-[12px] font-medium text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t("dashboard.kpis.atRiskInline", { count: kpis?.at_risk_count ?? 0 })}
            </p>
          )}
        </div>

        {!isFirstLogin && (
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left text-[13px] font-semibold text-foreground transition-colors hover:bg-muted/40 [&[data-state=open]>svg]:rotate-180">
              {t("dashboard.detailsToggle")}
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              {/* GOAL GROWTH */}
              <SectionCard label={t("dashboard.goalGrowth.label")} action={
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  {t("dashboard.goalGrowth.scaleNote")}
                </span>
              }>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{t("dashboard.goalGrowth.averageGrowth")}</p>
                    <p className="font-display mt-1 text-[2rem] font-normal leading-none">
                      {goalGrowth?.avg_growth != null ? `+${Math.round(goalGrowth.avg_growth)}` : "—"}
                      <span className="ml-1 text-sm font-normal text-muted-foreground">{t("dashboard.goalGrowth.pts")}</span>
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {goalGrowth?.pct_progressing != null
                        ? t("dashboard.goalGrowth.pctProgressing", { pct: Math.round(goalGrowth.pct_progressing) })
                        : t("dashboard.goalGrowth.noRatingsYet")}
                    </p>
                  </div>
                  <div>
                    {distributionShown ? (
                      <div className="space-y-2">
                        <DistRow label={t("dashboard.goalGrowth.hitTarget")} count={goalGrowth!.hit_target_count} total={distributionTotal} tone="success" />
                        <DistRow label={t("dashboard.goalGrowth.meaningfulProgress")} count={goalGrowth!.meaningful_progress_count} total={distributionTotal} tone="primary" />
                        <DistRow label={t("dashboard.goalGrowth.justStarted")} count={goalGrowth!.just_started_count} total={distributionTotal} tone="warning" />
                        <DistRow label={t("dashboard.goalGrowth.flatDeclined")} count={goalGrowth!.flat_declined_count} total={distributionTotal} tone="destructive" />
                      </div>
                    ) : (
                      <div className="rounded-xl bg-muted/40 p-3">
                        <p className="text-[11px] text-muted-foreground">
                          {t("dashboard.goalGrowth.distributionHidden", { min: minLeadersForDistribution })}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <p className="mt-4 text-[10px] italic text-muted-foreground">
                  {t("dashboard.goalGrowth.footnote")}
                </p>
              </SectionCard>

              {/* TIMELINE + SATISFACTION */}
              <div className="grid gap-4 sm:grid-cols-2">
                <SectionCard label={t("dashboard.timeline.label")}>
                  <div className="flex items-center gap-3">
                    <CalendarRange className="h-8 w-8 text-primary" />
                    <div>
                      <p className="text-[13px] font-medium">
                        {timeline?.earliest_start ? format(new Date(timeline.earliest_start), "MMM d, yyyy") : "—"}
                        {" → "}
                        {timeline?.latest_end ? format(new Date(timeline.latest_end), "MMM d, yyyy") : "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {daysRemaining != null ? t("dashboard.timeline.daysRemaining", { count: daysRemaining }) : t("dashboard.timeline.noEndDate")}
                        {timeline?.programme_names?.length ? ` · ${timeline.programme_names.join(", ")}` : ""}
                      </p>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard label={t("dashboard.satisfaction.label")}>
                  <div className="flex items-center gap-3">
                    <Star className="h-8 w-8 text-warning" />
                    <div>
                      <p className="text-[13px] font-medium">
                        {satisfaction?.avg_rating != null ? `${satisfaction.avg_rating.toFixed(1)} / 5.0` : t("dashboard.satisfaction.noRatingsYet")}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("dashboard.satisfaction.acrossRated", { count: satisfaction?.rated_session_count ?? 0 })}
                      </p>
                      <p className="mt-1 text-[10px] italic text-muted-foreground">{t("dashboard.satisfaction.writtenFeedbackNote")}</p>
                    </div>
                  </div>
                </SectionCard>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* PROGRAMME ENGAGEMENT — only rendered when the org's programme(s)
            actually have training/quiz/triads/daily_prompt modules enabled;
            sponsor_programme_engagement() returns zero rows otherwise, same
            "silently absent" contract as the rest of this dashboard. */}
        {!isFirstLogin && programmeEngagement.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left text-[13px] font-semibold text-foreground transition-colors hover:bg-muted/40 [&[data-state=open]>svg]:rotate-180">
              <span className="inline-flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-primary" /> {t("dashboard.programmeEngagement.label")}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              <SectionCard label={t("dashboard.programmeEngagement.label")}>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold">{t("dashboard.programmeEngagement.columns.week")}</th>
                        <th className="px-2 py-2 text-left font-semibold">{t("dashboard.programmeEngagement.columns.skillCard")}</th>
                        <th className="px-2 py-2 text-left font-semibold">{t("dashboard.programmeEngagement.columns.quiz")}</th>
                        <th className="px-2 py-2 text-left font-semibold">{t("dashboard.programmeEngagement.columns.triad")}</th>
                        <th className="px-2 py-2 text-left font-semibold">{t("dashboard.programmeEngagement.columns.prompt")}</th>
                        <th className="px-2 py-2 text-left font-semibold">{t("dashboard.programmeEngagement.columns.confidence")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {programmeEngagement.map((w) => (
                        <tr key={`${w.week_number}-${w.week_title}`}>
                          <td className="px-2 py-2 font-medium">W{w.week_number} · {w.week_title}</td>
                          <td className="px-2 py-2 text-muted-foreground">{w.skill_card_completion_pct != null ? `${Math.round(w.skill_card_completion_pct)}%` : "—"}</td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {w.quiz_avg_score != null ? `${Math.round(w.quiz_avg_score)}%` : "—"}
                            {w.quiz_completion_pct != null && <span className="text-muted-foreground/70"> · {Math.round(w.quiz_completion_pct)}% done</span>}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">{w.triad_completion_pct != null ? `${Math.round(w.triad_completion_pct)}%` : "—"}</td>
                          <td className="px-2 py-2 text-muted-foreground">{w.daily_prompt_response_rate != null ? `${Math.round(w.daily_prompt_response_rate)}%` : "—"}</td>
                          <td className="px-2 py-2 text-muted-foreground">{w.avg_confidence_score != null ? Number(w.avg_confidence_score).toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              {redFlags.length > 0 && (
                <SectionCard label={t("dashboard.redFlags.label")}>
                  <ul className="divide-y">
                    {redFlags.map((r) => (
                      <li key={r.user_id} className="flex items-center justify-between gap-3 py-2 text-[12px]">
                        <span className="font-medium">{r.full_name}</span>
                        <span className="inline-flex items-center gap-1 text-warning">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {r.days_since_last_activity >= 999
                            ? t("dashboard.redFlags.noActivityYet")
                            : t("dashboard.redFlags.daysInactive", { count: r.days_since_last_activity })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* ROSTER */}
        <div data-onboarding="sponsor-roster">
        <SectionCard
          label={t("dashboard.roster.label", { count: filteredRoster.length })}
          action={
            cohortNames.length > 1 ? (
              <div className="flex items-center gap-1.5" data-onboarding="sponsor-cohort-filter">
                <Filter className="h-3 w-3 text-muted-foreground" />
                <Select value={cohortFilter} onValueChange={setCohortFilter}>
                  <SelectTrigger className="h-6 w-32 border-0 bg-transparent p-0 text-[10px] text-muted-foreground shadow-none focus:ring-0">
                    <SelectValue placeholder={t("dashboard.roster.allCohorts")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">{t("dashboard.roster.allCohorts")}</SelectItem>
                    {cohortNames.map(c => (
                      <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : undefined
          }
        >
          <p className="mb-3 text-[10px] text-muted-foreground">
            {t("dashboard.roster.note")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">{t("dashboard.roster.columns.leader")}</th>
                  <th className="px-2 py-2 text-left font-semibold hidden sm:table-cell">{t("dashboard.roster.columns.cohort")}</th>
                  <th className="px-2 py-2 text-left font-semibold">{t("dashboard.roster.columns.status")}</th>
                  <th className="px-2 py-2 text-left font-semibold hidden md:table-cell">{t("dashboard.roster.columns.progress")}</th>
                  <th className="px-2 py-2 text-left font-semibold">{t("dashboard.roster.columns.sessions")}</th>
                  <th className="px-2 py-2 text-left font-semibold hidden sm:table-cell">{t("dashboard.roster.columns.growth")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRoster.map((r) => (
                  <tr
                    key={r.enrollment_id}
                    onClick={() => setSelectedLeader(r)}
                    className="cursor-pointer transition-colors hover:bg-muted/40"
                  >
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary">
                          {initials(r.full_name)}
                        </div>
                        <span className="font-medium">{r.full_name}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground hidden sm:table-cell">{r.cohort_name || "—"}</td>
                    <td className="px-2 py-2.5"><Pill tone={STATUS_TONE[r.enrollment_status]}>{t(`status.${STATUS_LABEL_KEY[r.enrollment_status]}`)}</Pill></td>
                    <td className="px-2 py-2.5 hidden md:table-cell">
                      <div className="w-24"><MiniBar pct={r.progress_pct} tone="primary" /></div>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-muted-foreground">{r.sessions_completed}/{r.sessions_entitled}</td>
                    <td className="px-2 py-2.5 hidden sm:table-cell">
                      {r.goal_growth != null ? t("cohorts.growthPts", { n: Math.round(r.goal_growth) }) : <span className="italic text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
                {filteredRoster.length === 0 && (
                  <tr><td colSpan={6} className="px-2 py-8 text-center text-[12px] text-muted-foreground">{t("dashboard.roster.empty")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] italic text-muted-foreground">
            {t("dashboard.roster.footnote")}
          </p>
        </SectionCard>
        </div>

        {/* PRIVACY NOTICE */}
        <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <span className="font-semibold text-foreground">{t("dashboard.privacy.titlePrefix")} </span>
            {t("dashboard.privacy.body")}
          </div>
        </div>
      </div>

      {/* Leader detail drawer */}
      <SponsorLeaderDrawer leader={selectedLeader} onClose={() => setSelectedLeader(null)} />
    </>
  );
}

function HeadlineStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: "primary" | "success" | "secondary";
}) {
  const iconTone: Record<string, string> = {
    primary: "text-primary",
    success: "text-success",
    secondary: "text-secondary",
  };
  return (
    <div className="flex items-start gap-3">
      <Icon className={cn("mt-1 h-5 w-5 shrink-0", iconTone[tone])} />
      <div>
        <p className="font-display text-[2.25rem] font-normal leading-none tracking-tight">{value}</p>
        <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function DistRow({ label, count, total, tone }: { label: string; count: number; total: number; tone: "success" | "primary" | "warning" | "destructive" }) {
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
