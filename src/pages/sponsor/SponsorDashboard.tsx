import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { format, differenceInCalendarDays, addDays } from "date-fns";
import {
  Users, CheckCircle2, AlertTriangle, CalendarCheck, Star,
  CalendarRange, ShieldCheck, Loader2, ArrowRight, Building2,
  Clock, ChevronDown, MessageCircle, type LucideIcon,
  Wallet, Info, FileDown, Layers,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { SectionCard, MiniBar } from "@/pages/admin/_shared";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import type { SponsorRosterRow, SponsorSatisfactionTrendRow } from "@/hooks/sponsor/useSponsorDashboardData";
import {
  RosterTable, CoachUtilisationBars,
  HealthSignalPill, Avatar,
} from "@/pages/sponsor/_shared";
import { healthSignal, cohortProgress } from "@/pages/sponsor/sponsorUtils";
import { SponsorLeaderDrawer } from "./SponsorLeaderDrawer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface OrgBannerData {
  name: string;
  logo_url: string | null;
  subscription_tier: string | null;
  contract_start: string | null;
  contract_end: string | null;
  coaching_budget: number | null;
  account_manager: { full_name: string } | null;
}

export default function SponsorDashboard() {
  const { t } = useTranslation("sponsor");
  const { user } = useAuth();
  const {
    kpis, roster, satisfaction, timeline,
    redFlags, satisfactionTrend, coachUtilisation, loading,
  } = useSponsorDashboardData();
  const [org, setOrg] = useState<OrgBannerData | null>(null);
  const [selectedLeader, setSelectedLeader] = useState<SponsorRosterRow | null>(null);
  const [cohortDates, setCohortDates] = useState<Map<string, { start_date: string | null; end_date: string | null }>>(new Map());
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

  const cohortNames = useMemo(
    () => Array.from(new Set(roster.map((r) => r.cohort_name).filter(Boolean))),
    [roster]
  );

  // Cohort start/end dates for the health matrix's session-pace bar — cohorts
  // is the one table sponsor pages may query directly (RLS: any authenticated
  // user may SELECT it), since none of the sponsor_* RPCs carry per-cohort
  // dates.
  useEffect(() => {
    if (cohortNames.length === 0) return;
    let mounted = true;
    supabase
      .from("cohorts")
      .select("name, start_date, end_date")
      .in("name", cohortNames)
      .then(({ data }) => {
        if (!mounted || !data) return;
        setCohortDates(new Map(data.map((c) => [c.name, { start_date: c.start_date, end_date: c.end_date }])));
      });
    return () => {
      mounted = false;
    };
  }, [cohortNames]);

  // Cohort Health Matrix — one row per cohort, aggregated from the same
  // roster the rest of this dashboard already has. Satisfaction has no
  // per-cohort breakdown anywhere in the sponsor_* surface (sponsor_
  // satisfaction_summary is a single org-wide row), so every row shows the
  // same org-wide average rather than fabricating a per-cohort figure.
  const cohortHealthRows = useMemo(() => {
    const byCohort = new Map<string, SponsorRosterRow[]>();
    roster.forEach((r) => {
      if (!r.cohort_name) return;
      if (!byCohort.has(r.cohort_name)) byCohort.set(r.cohort_name, []);
      byCohort.get(r.cohort_name)!.push(r);
    });
    return Array.from(byCohort.entries()).map(([cohortName, rows]) => {
      const onTrack = rows.filter((r) => r.enrollment_status === "active").length;
      const atRisk = rows.filter((r) => r.enrollment_status === "at_risk").length;
      const sessionsCompleted = rows.reduce((s, r) => s + r.sessions_completed, 0);
      const sessionsEntitled = rows.reduce((s, r) => s + r.sessions_entitled, 0);
      const withGrowth = rows.filter((r) => r.goal_growth != null);
      const avgGoalGrowth = withGrowth.length ? withGrowth.reduce((s, r) => s + r.goal_growth!, 0) / withGrowth.length : null;
      const dates = cohortDates.get(cohortName);
      const progress = dates ? cohortProgress(dates.start_date, dates.end_date) : null;
      const pace = progress && progress.elapsed > 0 && sessionsEntitled > 0
        ? Math.min(100, ((sessionsCompleted / progress.elapsed) * progress.total / sessionsEntitled) * 100)
        : null;
      return {
        cohortName,
        leaders: rows.length,
        onTrackPct: rows.length ? (onTrack / rows.length) * 100 : 0,
        pace,
        avgGoalGrowth,
        signal: healthSignal(atRisk, rows.length),
      };
    });
  }, [roster, cohortDates]);

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

  const daysRemaining = timeline?.latest_end
    ? Math.max(0, differenceInCalendarDays(new Date(timeline.latest_end), new Date()))
    : null;

  const daysUntilStart = timeline?.earliest_start
    ? Math.max(0, differenceInCalendarDays(new Date(timeline.earliest_start), new Date()))
    : null;

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
            <HeadlineStat label={t("dashboard.kpis.enrolledActive")} value={kpis?.enrolled_active_count ?? 0} icon={Users} tone="primary" />
            <HeadlineStat label={t("dashboard.kpis.leadersEnrolled")} value={kpis?.leaders_enrolled ?? 0} icon={Users} tone="primary" />
            <HeadlineStat
              label={t("dashboard.kpis.sessionsUsed")}
              value={`${kpis?.sessions_used ?? 0} / ${kpis?.sessions_entitled ?? 0}`}
              icon={CalendarCheck}
              tone="secondary"
            />
            <HeadlineStat
              label={t("dashboard.kpis.avgSatisfaction")}
              value={satisfaction?.avg_rating != null ? `${satisfaction.avg_rating.toFixed(1)} / 5.0` : "—"}
              icon={Star}
              tone="primary"
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

        {/* COHORT HEALTH MATRIX — this already is the "Your Cohorts" summary
            (leaders / on-track % / sessions pace / signal per cohort, each
            row linking to its detail page): adding a second, more compact
            card-based cohort summary directly below an existing table doing
            the same job would just be a redundant twin, not a real
            simplification, so it wasn't added on top of this. */}
        {!isFirstLogin && cohortHealthRows.length > 0 && (
          <SectionCard label={t("dashboard.healthMatrix.label")}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold">{t("dashboard.healthMatrix.columns.cohort")}</th>
                    <th className="px-2 py-2 text-left font-semibold">{t("dashboard.healthMatrix.columns.leaders")}</th>
                    <th className="px-2 py-2 text-left font-semibold hidden sm:table-cell">{t("dashboard.healthMatrix.columns.onTrack")}</th>
                    <th className="px-2 py-2 text-left font-semibold hidden md:table-cell">{t("dashboard.healthMatrix.columns.sessionsPace")}</th>
                    <th className="px-2 py-2 text-left font-semibold hidden sm:table-cell">{t("dashboard.healthMatrix.columns.avgGoalGrowth")}</th>
                    <th className="px-2 py-2 text-left font-semibold hidden lg:table-cell">{t("dashboard.healthMatrix.columns.satisfaction")}</th>
                    <th className="px-2 py-2 text-left font-semibold">{t("dashboard.healthMatrix.columns.signal")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cohortHealthRows.map((row) => (
                    <tr key={row.cohortName} className="transition-colors hover:bg-muted/40">
                      <td className="px-2 py-2.5">
                        <Link to={`/sponsor/cohorts/${encodeURIComponent(row.cohortName)}`} className="font-medium text-primary hover:underline">
                          {row.cohortName}
                        </Link>
                      </td>
                      <td className="px-2 py-2.5">{row.leaders}</td>
                      <td className="px-2 py-2.5 hidden sm:table-cell">{Math.round(row.onTrackPct)}%</td>
                      <td className="px-2 py-2.5 hidden md:table-cell">
                        {row.pace != null ? (
                          <div className="w-24"><MiniBar pct={row.pace} tone={row.pace > 100 ? "warning" : "primary"} /></div>
                        ) : (
                          <span className="italic text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 hidden sm:table-cell">
                        {row.avgGoalGrowth != null ? `${Math.round(row.avgGoalGrowth)}%` : <span className="italic text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-2.5 hidden lg:table-cell">
                        {satisfaction?.avg_rating != null ? `${satisfaction.avg_rating.toFixed(1)} / 5.0` : "—"}
                      </td>
                      <td className="px-2 py-2.5"><HealthSignalPill signal={row.signal} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[10px] italic text-muted-foreground">
              {t("dashboard.healthMatrix.satisfactionNote")}
            </p>
          </SectionCard>
        )}

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

        {/* TIMELINE + SATISFACTION — genuinely org-level metrics (unlike
            goal growth and per-week programme engagement, which are now
            shown correctly per-cohort on each cohort's own detail page and
            were dropped from here rather than duplicated/blended across
            cohorts). Shown directly, no longer behind a collapsible, since
            removing goal growth left just these two compact cards. */}
        {!isFirstLogin && (
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
        )}

        {/* FALLING BEHIND — the per-week programme engagement table and
            completion-funnel chart that used to live alongside this were
            removed (per-cohort versions on SponsorCohortDetail.tsx are the
            correct place for them; org-wide they'd blend cohorts on
            different unlock schedules together). This list stands on its
            own now instead of nesting inside that removed collapsible. */}
        {!isFirstLogin && redFlags.length > 0 && (
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

        {/* ROSTER */}
        <div data-onboarding="sponsor-roster">
        <SectionCard label={t("dashboard.roster.label", { count: roster.length })}>
          <p className="mb-3 text-[10px] text-muted-foreground">
            {t("dashboard.roster.note")}
          </p>
          <RosterTable rows={roster} onSelect={setSelectedLeader} showCohortColumn sortable={false} />
          <p className="mt-3 text-[10px] italic text-muted-foreground">
            {t("dashboard.roster.footnote")}
          </p>
        </SectionCard>
        </div>

        {/* COACH UTILISATION */}
        {coachUtilisation.length > 0 && (
          <SectionCard label={t("dashboard.coachUtilisation.label")}>
            <CoachUtilisationBars rows={coachUtilisation} />
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
