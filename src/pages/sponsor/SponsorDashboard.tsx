import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { differenceInCalendarDays } from "date-fns";
import {
  Users, CheckCircle2, Layers,
  ShieldCheck, Loader2, ArrowRight, Building2,
  Clock, MessageCircle, type LucideIcon,
  FileDown,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { SectionCard } from "@/pages/admin/_shared";
import { useSponsorDashboardData } from "@/hooks/sponsor/useSponsorDashboardData";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
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

/**
 * Executive-level Sponsor Dashboard (spec section A). Exactly four primary
 * KPIs, driven entirely by the currently-running cohorts scope that
 * public.sponsor_organisation_summary() now applies -- no client-side
 * re-derivation of who counts as "current". No completion/adherence/
 * coverage percentages, no sessions/budget tiles, no roster: those either
 * moved to Cohort Detail or were dropped outright per spec section A3.
 */
export default function SponsorDashboard() {
  const { t } = useTranslation("sponsor");
  const { user } = useAuth();
  const { kpis, cohortSummaries, loading } = useSponsorDashboardData();
  const [org, setOrg] = useState<OrgBannerData | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactMessage, setContactMessage] = useState("");
  const [contactSending, setContactSending] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const kpiRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
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

  const currentCohorts = useMemo(
    () => cohortSummaries.filter((c) => c.cohort_status === "current"),
    [cohortSummaries]
  );

  const orgName = org?.name ?? null;
  const contractDaysRemaining = org?.contract_end
    ? differenceInCalendarDays(new Date(org.contract_end), new Date())
    : null;
  const contractStatus: "active" | "expiring" | "expired" | null =
    contractDaysRemaining == null ? null : contractDaysRemaining < 0 ? "expired" : contractDaysRemaining < 60 ? "expiring" : "active";

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

  const isFirstLogin = !kpis || kpis.enrollment_count == null || kpis.enrollment_count === 0;
  const activeLeaders = (kpis?.active_count ?? 0) + (kpis?.at_risk_count ?? 0);
  const onTrackCount = kpis?.on_track_count ?? null;
  const onTrackDenominator = kpis?.assessable_count ?? null;
  const onTrackPct = onTrackDenominator && onTrackDenominator > 0 && onTrackCount != null
    ? Math.round((onTrackCount / onTrackDenominator) * 100)
    : null;

  return (
    <>
      <div className="space-y-6">
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
        </div>

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

        {isFirstLogin ? (
          <div className="rounded-2xl border border-border bg-gradient-to-br from-primary-soft to-card p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">{t("dashboard.firstLogin.dataAppears")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("dashboard.firstLogin.dataAppearsBody")}</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* FOUR PRIMARY KPIs — spec A1. Nothing else belongs at this
                altitude: no completion/adherence/coverage %, no sessions or
                budget tiles. */}
            <div ref={kpiRowRef} className="rounded-2xl border border-border bg-card p-6">
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <HeadlineStat label={t("dashboard.kpis.totalLeaders")} value={kpis?.enrollment_count ?? 0} icon={Users} tone="primary" />
                <HeadlineStat label={t("dashboard.kpis.activeLeaders")} value={activeLeaders} icon={Users} tone="secondary" />
                <HeadlineStat label={t("dashboard.kpis.currentCohorts")} value={kpis?.cohort_count ?? 0} icon={Layers} tone="secondary" />
                <HeadlineStat
                  label={t("dashboard.kpis.onTrack")}
                  value={onTrackCount != null && onTrackDenominator != null ? `${onTrackCount} / ${onTrackDenominator}` : "—"}
                  sub={onTrackPct != null ? `${onTrackPct}%` : undefined}
                  icon={CheckCircle2}
                  tone="success"
                />
              </div>
            </div>

            {/* CURRENT COHORTS — spec A4. Completed cohorts are deliberately
                excluded and reached via a separate link (A5); upcoming
                cohorts are not shown here at all (A6). */}
            <SectionCard
              label={t("dashboard.currentCohorts.label")}
              action={
                <Link to="/sponsor/cohorts?status=completed" className="text-[11px] font-semibold text-primary hover:underline">
                  {t("dashboard.currentCohorts.viewCompleted")} <ArrowRight className="inline h-3 w-3" />
                </Link>
              }
            >
              {currentCohorts.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-muted-foreground">{t("dashboard.currentCohorts.empty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold">{t("dashboard.currentCohorts.columns.cohort")}</th>
                        <th className="px-2 py-2 text-left font-semibold hidden sm:table-cell">{t("dashboard.currentCohorts.columns.programme")}</th>
                        <th className="px-2 py-2 text-left font-semibold hidden md:table-cell">{t("dashboard.currentCohorts.columns.position")}</th>
                        <th className="px-2 py-2 text-left font-semibold">{t("dashboard.currentCohorts.columns.leaders")}</th>
                        <th className="px-2 py-2 text-left font-semibold">{t("dashboard.currentCohorts.columns.onTrack")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {currentCohorts.map((c) => (
                        <tr key={c.cohort_id} className="transition-colors hover:bg-muted/40">
                          <td className="px-2 py-2.5">
                            <Link to={`/sponsor/cohorts/${c.cohort_id}`} className="font-medium text-primary hover:underline">
                              {c.cohort_label}
                            </Link>
                          </td>
                          <td className="px-2 py-2.5 text-muted-foreground hidden sm:table-cell">{c.programme_label}</td>
                          <td className="px-2 py-2.5 hidden md:table-cell">
                            {c.current_week != null && c.total_weeks != null
                              ? t("dashboard.currentCohorts.weekOf", { current: c.current_week, total: c.total_weeks })
                              : "—"}
                          </td>
                          <td className="px-2 py-2.5">{c.enrollment_count}</td>
                          <td className="px-2 py-2.5">
                            {c.suppressed
                              ? <span className="italic text-muted-foreground">{t("cohorts.suppressed", { min: 5 })}</span>
                              : (c.on_track_count != null && c.assessable_count != null
                                ? `${c.on_track_count} / ${c.assessable_count}`
                                : "—")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </>
        )}

        <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <span className="font-semibold text-foreground">{t("dashboard.privacy.titlePrefix")} </span>
            {t("dashboard.privacy.body")}
          </div>
        </div>
      </div>

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
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
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
        {sub && <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}
