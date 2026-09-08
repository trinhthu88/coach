import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { format, differenceInCalendarDays, addDays } from "date-fns";
import {
  Users, CheckCircle2, AlertTriangle, CalendarCheck, Star,
  CalendarRange, ShieldCheck, Loader2, ArrowRight, Building2,
  Clock, Filter, ChevronDown, GraduationCap, MessageCircle, type LucideIcon,
  Wallet, Info, FileDown, Layers,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { SectionCard, Pill, MiniBar, Avatar, EngagementCell } from "@/pages/admin/_shared";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import type { SponsorRosterRow, SponsorSatisfactionTrendRow } from "@/hooks/sponsor/useSponsorDashboardData";
import { SponsorLeaderDrawer } from "./SponsorLeaderDrawer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface OrgBannerData {
  name: string;
  logo_url: string | null;
  subscription_tier: string | null;
  contract_start: string | null;
  contract_end: string | null;
  coaching_budget: number | null;
  account_manager: { full_name: string } | null;
}

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
  const {
    kpis, goalGrowth, roster, satisfaction, timeline, minLeadersForDistribution,
    programmeEngagement, redFlags, satisfactionTrend, coachUtilisation, loading,
  } = useSponsorDashboardData();
  const [org, setOrg] = useState<OrgBannerData | null>(null);
  const [selectedLeader, setSelectedLeader] = useState<SponsorRosterRow | null>(null);
  const [cohortFilter, setCohortFilter] = useState<string>("all");
  const [contactOpen, setContactOpen] = useState(false);
  const [contactMessage, setContactMessage] = useState("");
  const [contactSending, setContactSending] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const kpiRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    // RLS ("Organizations: sponsor view own") already scopes this to exactly
    // the caller's own org, so no id lookup is needed first. maybeSingle()
    // (not single()) because a sponsor account not yet linked to an
    // organization legitimately has zero rows here — single() 406s on that.
    supabase
      .from("organizations")
      .select("name, logo_url, subscription_tier, contract_start, contract_end, coaching_budget, account_manager:account_manager_id(full_name)")
      .maybeSingle()
      .then(({ data }) => {
        if (data) setOrg(data as unknown as OrgBannerData);
      });
  }, [user]);

  useEffect(() => {
    const el = kpiRowRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowQuickActions(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading]);

  const orgName = org?.name ?? null;

  const contractDaysRemaining = org?.contract_end
    ? differenceInCalendarDays(new Date(org.contract_end), new Date())
    : null;
  const contractStatus: "active" | "expiring" | "expired" | null =
    contractDaysRemaining == null ? null : contractDaysRemaining < 0 ? "expired" : contractDaysRemaining < 60 ? "expiring" : "active";

  // Budget Used tile — spend_to_date is a proxy (sessions completed / entitled
  // * budget) until real billing data exists, per spec. Projected exhaustion
  // date extrapolates the burn rate seen so far across the contract; only
  // shown once there's enough signal (contract has started, some budget used).
  const budgetUsedPct = org?.coaching_budget != null && kpis?.sessions_entitled
    ? Math.min(100, ((kpis.sessions_used ?? 0) / kpis.sessions_entitled) * 100)
    : null;
  const spendToDate = org?.coaching_budget != null && budgetUsedPct != null
    ? (budgetUsedPct / 100) * org.coaching_budget
    : null;
  const daysElapsedInContract = org?.contract_start
    ? differenceInCalendarDays(new Date(), new Date(org.contract_start))
    : null;
  const projectedExhaustionDate = (() => {
    if (budgetUsedPct == null || budgetUsedPct <= 0 || !daysElapsedInContract || daysElapsedInContract <= 0) return null;
    const dailyBurnPct = budgetUsedPct / daysElapsedInContract;
    if (dailyBurnPct <= 0) return null;
    const daysToExhaust = (100 - budgetUsedPct) / dailyBurnPct;
    return addDays(new Date(), Math.round(daysToExhaust));
  })();

  // Smart Alerts — derived from data already fetched, no extra round trip.
  const alerts = useMemo(() => {
    const list: { key: string; icon: LucideIcon; tone: "warning" | "info"; message: string; to?: string }[] = [];

    roster
      .filter((r) => r.enrollment_status === "at_risk")
      .forEach((r) => {
        const flag = redFlags.find((f) => f.user_id === r.coachee_id);
        if (flag && flag.days_since_last_activity >= 14 && flag.days_since_last_activity < 999) {
          list.push({
            key: `at-risk-${r.enrollment_id}`,
            icon: AlertTriangle,
            tone: "warning",
            message: t("dashboard.alerts.atRiskInactive", { name: r.full_name, count: flag.days_since_last_activity }),
          });
        }
      });

    const byCohort = new Map<string, { used: number; entitled: number }>();
    roster.forEach((r) => {
      const key = r.cohort_name || "";
      if (!key) return;
      const agg = byCohort.get(key) || { used: 0, entitled: 0 };
      agg.used += r.sessions_completed;
      agg.entitled += r.sessions_entitled;
      byCohort.set(key, agg);
    });
    byCohort.forEach((agg, cohortName) => {
      if (agg.entitled > 0 && agg.used / agg.entitled >= 0.9) {
        list.push({
          key: `session-threshold-${cohortName}`,
          icon: Info,
          tone: "info",
          message: t("dashboard.alerts.sessionThreshold", { name: cohortName }),
        });
      }
    });

    if (contractDaysRemaining != null && contractDaysRemaining < 60) {
      list.push({
        key: "contract-expiry",
        icon: AlertTriangle,
        tone: "warning",
        message: t("dashboard.alerts.contractExpiry", { count: Math.max(0, contractDaysRemaining) }),
      });
    }

    return list;
  }, [roster, redFlags, contractDaysRemaining, t]);

  const maxCoachSessions = Math.max(1, ...coachUtilisation.map((c) => c.completed_sessions));

  const contactAdmin = async () => {
    if (!contactMessage.trim()) return;
    setContactSending(true);
    const { error } = await supabase.from("admin_alerts").insert({
      alert_type: "sponsor_request",
      severity: "info",
      title: t("dashboard.contactTeam.alertTitle", { org: orgName || t("dashboard.contactTeam.defaultOrg") }),
      message: contactMessage.trim(),
    });
    setContactSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("dashboard.contactTeam.sent"));
    setContactMessage("");
    setContactOpen(false);
  };

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
              actions={
                <Button variant="outline" size="sm" onClick={() => setContactOpen(true)}>
                  <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> {t("dashboard.contactTeam.button")}
                </Button>
              }
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

        {/* ORG BANNER */}
        {org && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-secondary px-5 py-4 text-secondary-foreground">
            <div className="flex min-w-0 items-center gap-3">
              {org.logo_url ? (
                <img src={org.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-white/10 object-contain" />
              ) : (
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/10">
                  <Building2 className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold">{org.name}</p>
                <p className="truncate text-[11px] text-white/60">
                  {[
                    org.subscription_tier ? t(`dashboard.orgBanner.tiers.${org.subscription_tier}`, org.subscription_tier) : null,
                    org.account_manager ? t("dashboard.orgBanner.accountManager", { name: org.account_manager.full_name }) : null,
                    contractDaysRemaining != null ? t("dashboard.orgBanner.daysRemaining", { count: Math.max(0, contractDaysRemaining) }) : null,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            {contractStatus && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                  contractStatus === "active" && "bg-success/20 text-success",
                  contractStatus === "expiring" && "bg-warning/20 text-warning",
                  contractStatus === "expired" && "bg-destructive/20 text-destructive"
                )}
              >
                {t(`dashboard.orgBanner.status.${contractStatus}`)}
              </span>
            )}
          </div>
        )}

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
        <div ref={kpiRowRef} className="rounded-2xl border border-border bg-card p-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <HeadlineStat label={t("dashboard.kpis.onTrack")} value={kpis?.on_track_count ?? 0} icon={CheckCircle2} tone="success" />
            <HeadlineStat label={t("dashboard.kpis.leadersEnrolled")} value={kpis?.leaders_enrolled ?? 0} icon={Users} tone="primary" />
            <HeadlineStat
              label={t("dashboard.kpis.sessionsUsed")}
              value={`${kpis?.sessions_used ?? 0} / ${kpis?.sessions_entitled ?? 0}`}
              icon={CalendarCheck}
              tone="secondary"
            />
            {budgetUsedPct != null && (
              <div className="flex items-start gap-3">
                <Wallet className={cn("mt-1 h-5 w-5 shrink-0", budgetUsedPct > 95 ? "text-destructive" : budgetUsedPct > 80 ? "text-warning" : "text-secondary")} />
                <div className="min-w-0">
                  <p className={cn("font-display text-[2.25rem] font-normal leading-none tracking-tight", budgetUsedPct > 95 ? "text-destructive" : budgetUsedPct > 80 ? "text-warning" : "text-foreground")}>
                    {Math.round(budgetUsedPct)}%
                  </p>
                  <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("dashboard.kpis.budgetUsed")}</p>
                  {org?.coaching_budget != null && spendToDate != null && (
                    <p className="mt-1 truncate text-[10.5px] text-muted-foreground">
                      {t("dashboard.kpis.budgetSubline", {
                        spent: new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 0 }).format(spendToDate),
                        total: new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 0 }).format(org.coaching_budget),
                      })}
                      {projectedExhaustionDate && ` · ${t("dashboard.kpis.budgetRunsOut", { date: format(projectedExhaustionDate, "MMM d") })}`}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          {(kpis?.at_risk_count ?? 0) > 0 && (
            <p className="mt-5 flex items-center gap-1.5 border-t border-border pt-4 text-[12px] font-medium text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t("dashboard.kpis.atRiskInline", { count: kpis?.at_risk_count ?? 0 })}
            </p>
          )}
        </div>

        {/* SMART ALERTS */}
        {!isFirstLogin && (
          <Collapsible defaultOpen={alerts.length > 0}>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left text-[13px] font-semibold text-foreground transition-colors hover:bg-muted/40 [&[data-state=open]>svg]:rotate-180">
              <span className="inline-flex items-center gap-2">
                {t("dashboard.alerts.label")}
                {alerts.length > 0 && (
                  <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-bold text-warning">{alerts.length}</span>
                )}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <Card className="divide-y p-0">
                {alerts.length === 0 ? (
                  <p className="p-4 text-[12px] text-muted-foreground">{t("dashboard.alerts.empty")}</p>
                ) : (
                  alerts.map((a) => (
                    <div key={a.key} className="flex items-center gap-3 px-4 py-3">
                      <a.icon className={cn("h-4 w-4 shrink-0", a.tone === "warning" ? "text-warning" : "text-primary")} />
                      <span className="flex-1 text-[12.5px]">{a.message}</span>
                      {a.to && (
                        <Link to={a.to} className="shrink-0 text-[11px] font-semibold text-primary hover:underline">
                          {t("dashboard.alerts.view")}
                        </Link>
                      )}
                    </div>
                  ))
                )}
              </Card>
            </CollapsibleContent>
          </Collapsible>
        )}

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
                      {goalGrowth?.pct_progressing != null ? `${Math.round(goalGrowth.pct_progressing)}%` : "—"}
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {goalGrowth?.pct_progressing != null
                        ? t("dashboard.goalGrowth.pctProgressing")
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
                  {satisfactionTrend.length > 0 ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Star className="h-5 w-5 text-warning" />
                        <p className="text-[13px] font-medium">
                          {satisfaction?.avg_rating != null ? `${satisfaction.avg_rating.toFixed(1)} / 5.0` : t("dashboard.satisfaction.noRatingsYet")}
                        </p>
                        <span className="text-[11px] text-muted-foreground">
                          {t("dashboard.satisfaction.acrossRated", { count: satisfaction?.rated_session_count ?? 0 })}
                        </span>
                      </div>
                      <SatisfactionTrendChart data={satisfactionTrend} />
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Star className="h-8 w-8 text-warning" />
                      <div>
                        <p className="text-[13px] font-medium">
                          {satisfaction?.avg_rating != null ? `${satisfaction.avg_rating.toFixed(1)} / 5.0` : t("dashboard.satisfaction.noRatingsYet")}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {t("dashboard.satisfaction.acrossRated", { count: satisfaction?.rated_session_count ?? 0 })}
                        </p>
                      </div>
                    </div>
                  )}
                  <p className="mt-1 text-[10px] italic text-muted-foreground">{t("dashboard.satisfaction.writtenFeedbackNote")}</p>
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
              <Card className="overflow-hidden">
                <div className="grid grid-cols-[64px_repeat(5,1fr)] gap-0 border-b bg-muted/30 px-4 py-2.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span>{t("dashboard.programmeEngagement.columns.week")}</span>
                  <span>{t("dashboard.programmeEngagement.columns.skillCard")}</span>
                  <span>{t("dashboard.programmeEngagement.columns.quiz")}</span>
                  <span>{t("dashboard.programmeEngagement.columns.reflection")}</span>
                  <span>{t("dashboard.programmeEngagement.columns.triad")}</span>
                  <span>{t("dashboard.programmeEngagement.columns.prompt")}</span>
                </div>
                <div className="divide-y">
                  {programmeEngagement.map((w) => (
                    <div key={`${w.week_number}-${w.week_title}`} className="grid grid-cols-[64px_repeat(5,1fr)] items-center gap-0 px-4 py-3 text-[12.5px]">
                      <span className="font-bold">W{w.week_number}</span>
                      <EngagementCell pct={w.skill_card_completion_pct} />
                      <EngagementCell pct={w.quiz_completion_pct} sub={w.quiz_avg_score != null ? `${Math.round(w.quiz_avg_score)}% avg` : undefined} />
                      <EngagementCell pct={w.reflection_completion_pct} />
                      <div>
                        <EngagementCell pct={w.triad_completion_pct} />
                        {w.triad_satisfaction_avg != null && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                            {w.triad_satisfaction_avg.toFixed(1)}<span className="opacity-60">/5</span>
                          </span>
                        )}
                      </div>
                      <EngagementCell pct={w.daily_prompt_response_rate} tone="accent" />
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <p className="mb-3 text-2xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  {t("dashboard.programmeEngagement.completionFunnel")}
                </p>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={programmeEngagement.map((w) => ({
                        week: `W${w.week_number}`,
                        pct: w.skill_card_completion_pct ?? 0,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="week" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          fontSize: 11,
                        }}
                        formatter={(value: number) => [`${Math.round(value)}%`, "Completed"]}
                      />
                      <Bar dataKey="pct" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {redFlags.length > 0 && (
                <Card className="border-l-4 border-l-accent p-5">
                  <p className="text-2xs font-bold uppercase tracking-[0.2em] text-accent">{t("dashboard.redFlags.label")}</p>
                  <div className="mt-3.5 flex flex-col gap-2.5">
                    {redFlags.map((r) => (
                      <div key={r.user_id} className="flex items-center gap-3">
                        <Avatar name={r.full_name} tone="accent" size={26} />
                        <span className="flex-1 text-[12.5px]">{r.full_name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {r.days_since_last_activity >= 999
                            ? t("dashboard.redFlags.noActivityYet")
                            : t("dashboard.redFlags.daysInactive", { count: r.days_since_last_activity })}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
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
                  <th className="px-2 py-2 text-left font-semibold hidden sm:table-cell">{t("dashboard.roster.columns.goalProgress")}</th>
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
                      {r.goal_growth != null ? <GoalProgressBar pct={r.goal_growth} /> : <span className="italic text-muted-foreground">—</span>}
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

        {/* COACH UTILISATION */}
        {coachUtilisation.length > 0 && (
          <SectionCard label={t("dashboard.coachUtilisation.label")}>
            <div className="space-y-2.5">
              {coachUtilisation.map((c) => (
                <div key={c.coach_name} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-[12px] font-medium">{c.coach_name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(c.completed_sessions / maxCoachSessions) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{c.completed_sessions}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* PRIVACY NOTICE */}
        <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <span className="font-semibold text-foreground">{t("dashboard.privacy.titlePrefix")} </span>
            {t("dashboard.privacy.body")}
          </div>
        </div>
      </div>

      {/* QUICK ACTIONS — sticky, only shown once the user has scrolled past
          the KPI row (IntersectionObserver on kpiRowRef toggles it), so it
          doesn't compete with the header's own actions above the fold. */}
      <div
        className={cn(
          "sticky bottom-0 z-10 flex items-center justify-center gap-2 border-t border-border bg-card/95 px-4 py-2.5 backdrop-blur transition-transform duration-200 sm:justify-end",
          showQuickActions ? "translate-y-0" : "pointer-events-none translate-y-full"
        )}
      >
        <Button variant="outline" size="sm" onClick={() => setContactOpen(true)}>
          <MessageCircle className="h-3.5 w-3.5" /> {t("dashboard.contactTeam.button")}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to="/sponsor/report"><FileDown className="h-3.5 w-3.5" /> {t("dashboard.quickActions.downloadReport")}</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to="/sponsor/cohorts"><Layers className="h-3.5 w-3.5" /> {t("dashboard.quickActions.compareCohorts")}</Link>
        </Button>
      </div>

      {/* Leader detail drawer */}
      <SponsorLeaderDrawer leader={selectedLeader} onClose={() => setSelectedLeader(null)} />

      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dashboard.contactTeam.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={5}
            value={contactMessage}
            onChange={(e) => setContactMessage(e.target.value)}
            placeholder={t("dashboard.contactTeam.placeholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactOpen(false)} disabled={contactSending}>
              {t("dashboard.contactTeam.cancel")}
            </Button>
            <Button onClick={contactAdmin} disabled={contactSending || !contactMessage.trim()}>
              {contactSending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("dashboard.contactTeam.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function SatisfactionTrendChart({ data }: { data: SponsorSatisfactionTrendRow[] }) {
  const width = 280;
  const height = 90;
  const padTop = 8;
  const padBottom = 18;
  const plotHeight = height - padTop - padBottom;
  const domainMin = 1;
  const domainMax = 5;

  const points = data.map((d, i) => {
    const x = data.length > 1 ? (i / (data.length - 1)) * width : width / 2;
    const clamped = Math.min(domainMax, Math.max(domainMin, d.avg_rating));
    const y = padTop + (1 - (clamped - domainMin) / (domainMax - domainMin)) * plotHeight;
    return { x, y, month: d.month_start };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].x} ${height - padBottom} L ${points[0].x} ${height - padBottom} Z`
    : "";
  const last = points[points.length - 1];

  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 90 }}>
        {areaPath && <path d={areaPath} fill="hsl(var(--primary))" opacity={0.15} />}
        {linePath && <path d={linePath} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
        {last && <circle cx={last.x} cy={last.y} r={3} fill="hsl(var(--primary))" />}
      </svg>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        {points.map((p) => (
          <span key={p.month}>{format(new Date(p.month), "MMM")}</span>
        ))}
      </div>
    </div>
  );
}

function GoalProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const tone = clamped >= 50 ? "bg-success" : clamped >= 20 ? "bg-warning" : "bg-muted-foreground/40";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${clamped}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] font-medium text-muted-foreground">{Math.round(pct)}%</span>
    </div>
  );
}
