import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAdminCompletionRate } from "@/lib/adminCanonicalProgress";
import { alertText, type CurrentAlert } from "./alertText";
import { format, parseISO, startOfMonth } from "date-fns";
import { AdminPageHeader } from "./_shared";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatCard } from "@/components/ui/page-header";
import { MiniBarChart, AttentionPanel } from "@/components/ui/proto";
import { Users, UserCheck, Calendar, CheckCircle2 } from "lucide-react";

interface Bucket { label: string; value: number; }

interface DashboardProfileRow {
  id: string;
  full_name: string | null;
  status: string;
  created_at: string;
}

interface DashboardCoachProfileRow {
  id: string;
  approval_status: string;
}

interface DashboardStats {
  coachees: number;
  /** Active learners whose account was created this calendar month (real count, never an estimate). */
  newCoacheesThisMonth: number;
  coaches: number;
  pendingApproval: number;
  newCoachApplications: number;
  newCoacheeApplications: number;
  sessionsThisMonth: number;
  /** Programme units completed over required (admin_canonical_completion_rate); null = none required. */
  completionRate: number | null;
}

interface AlertItem {
  id: string;
  title: string;
  note?: string;
  severity: "critical" | "warning" | "info";
}

interface DashboardQueryData {
  stats: DashboardStats;
  monthly: Bucket[];
  pendingLinkSessions: number;
  /** The most severe current alerts (admin_alerts_current), worded at render time. */
  alerts: CurrentAlert[];
}

/** admin_dashboard_summary(): held sessions over the reporting population (20261007001100). */
interface DashboardSummary {
  sessions_this_month: number;
  practice_this_month: number;
  pending_link_sessions: number;
  monthly: { month: string; sessions: number; practice: number }[];
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

const EMPTY_STATS: DashboardStats = {
  coachees: 0,
  newCoacheesThisMonth: 0,
  coaches: 0,
  pendingApproval: 0,
  newCoachApplications: 0,
  newCoacheeApplications: 0,
  sessionsThisMonth: 0,
  completionRate: null,
};

// Translated strings (sessions-needing-link / new-application banners) are
// built at render time from the raw counts here, not baked into the cached
// query data — a language switch shouldn't require a refetch just to
// relabel the same numbers. admin_alerts rows carry their own title/message
// text already, so those are fine to map directly.
async function fetchAdminDashboardData(): Promise<DashboardQueryData> {
  const monthStart = startOfMonth(new Date()).toISOString();

  const [
    { data: roles },
    { data: profiles },
    { data: cps },
    summaryRes,
    alertsRes,
    { count: newCoachApplications },
    { count: newCoacheeApplications },
  ] = await Promise.all([
    supabase.from("user_roles").select("user_id, role"),
    supabase.from("profiles").select("id, full_name, status, created_at"),
    supabase.from("coach_profiles").select("id, approval_status"),
    // Session counts are the server's: held sessions over the reporting
    // population, Peer in canonical units, practice apart (20261007001100).
    supabase.rpc("admin_dashboard_summary"),
    // What needs attention is what admin_alerts_current() says is true now.
    supabase.rpc("admin_alerts_current"),
    supabase.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending").eq("role", "coach"),
    supabase.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending").eq("role", "executive"),
  ]);

  const coacheeIds = new Set((roles || []).filter((r) => r.role === "coachee").map((r) => r.user_id));
  const coachIds = new Set((roles || []).filter((r) => r.role === "coach").map((r) => r.user_id));
  const profById = new Map((profiles || []).map((p: DashboardProfileRow) => [p.id, p]));

  if (summaryRes.error) throw summaryRes.error;
  if (alertsRes.error) throw alertsRes.error;
  const summary = summaryRes.data as unknown as DashboardSummary;

  const pending = Array.from(coachIds).filter((id) => (cps || []).find((c: DashboardCoachProfileRow) => c.id === id)?.approval_status === "pending_approval").length;

  const pendingLinkSessions = summary.pending_link_sessions;

  // Completion comes from the canonical engine Learner and Sponsor use.
  const avgProgress = await fetchAdminCompletionRate();

  const stats: DashboardStats = {
    coachees: Array.from(coacheeIds).filter((id) => profById.get(id)?.status === "active").length,
    newCoacheesThisMonth: Array.from(coacheeIds).filter((id) => {
      const p = profById.get(id);
      return p?.status === "active" && new Date(p.created_at) >= new Date(monthStart);
    }).length,
    coaches: Array.from(coachIds).filter((id) => profById.get(id)?.status === "active").length,
    pendingApproval: pending,
    newCoachApplications: newCoachApplications || 0,
    newCoacheeApplications: newCoacheeApplications || 0,
    sessionsThisMonth: summary.sessions_this_month,
    completionRate: avgProgress,
  };

  // Monthly bars — the last 8 months of held programme sessions.
  const monthly: Bucket[] = summary.monthly.map((m) => ({
    label: format(parseISO(m.month), "MMM").toUpperCase(),
    value: m.sessions,
  }));

  const alerts = ((alertsRes.data ?? []) as CurrentAlert[])
    .slice()
    .sort((x, y) => (SEVERITY_RANK[x.severity] ?? 3) - (SEVERITY_RANK[y.severity] ?? 3))
    .slice(0, 6);

  return { stats, monthly, pendingLinkSessions, alerts };
}

export default function AdminDashboard() {
  const { t, i18n } = useTranslation("admin");
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: fetchAdminDashboardData,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const stats = data?.stats ?? EMPTY_STATS;
  const monthly = data?.monthly ?? [];

  const attention = useMemo<AlertItem[]>(() => {
    if (!data) return [];
    const applicationItems: AlertItem[] = [];
    if (data.pendingLinkSessions) {
      applicationItems.push({
        id: "sessions-needing-link",
        title: t("dashboard.sessionsNeedingLink", { count: data.pendingLinkSessions }),
        note: t("dashboard.awaitingMeetingLink"),
        severity: "warning",
      });
    }
    if (data.stats.newCoachApplications) {
      applicationItems.push({
        id: "new-coach-applications",
        title: t("dashboard.newCoachApplications", { count: data.stats.newCoachApplications }),
        note: t("dashboard.awaitingFirstReview"),
        severity: "info",
      });
    }
    if (data.stats.newCoacheeApplications) {
      applicationItems.push({
        id: "new-coachee-applications",
        title: t("dashboard.newCoacheeApplications", { count: data.stats.newCoacheeApplications }),
        note: t("dashboard.awaitingFirstReview"),
        severity: "info",
      });
    }
    const alertItems: AlertItem[] = data.alerts.map((a) => {
      const { title, message } = alertText(a, t);
      return { id: a.alert_key, title, note: message || undefined, severity: a.severity };
    });
    return [...applicationItems, ...alertItems];
  }, [data, t]);

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <div>
      <AdminPageHeader eyebrow={t("dashboard.eyebrow")} title={t("dashboard.title")} emphasize={t("dashboard.titleEmphasis")} trailing="" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("dashboard.statActiveCoachees")}
          value={stats.coachees}
          icon={Users}
          tone="primary"
          hint={
            stats.newCoacheeApplications > 0 ? (
              <span className="text-warning">{t("dashboard.newApplications", { count: stats.newCoacheeApplications })}</span>
            ) : (
              <span className="text-success">{t("dashboard.growthThisMonth", { count: stats.newCoacheesThisMonth })}</span>
            )
          }
        />
        <StatCard
          label={t("dashboard.statAccreditedCoaches")}
          value={stats.coaches}
          icon={UserCheck}
          tone="secondary"
          hint={
            stats.pendingApproval + stats.newCoachApplications > 0 ? (
              <span className="text-warning">{t("dashboard.pendingReview", { count: stats.pendingApproval + stats.newCoachApplications })}</span>
            ) : (
              t("dashboard.allApproved")
            )
          }
        />
        <StatCard
          label={t("dashboard.statSessionsDelivered")}
          value={stats.sessionsThisMonth}
          icon={Calendar}
          tone="primary"
          hint={t("dashboard.toDateSuffix", { month: format(new Date(), i18n.language === "vi" ? "M" : "MMMM") })}
        />
        <StatCard
          label={t("dashboard.statCompletionRate")}
          value={stats.completionRate == null ? "—" : `${stats.completionRate}%`}
          icon={CheckCircle2}
          tone={(stats.completionRate ?? 0) >= 75 ? "success" : "warning"}
          hint={<span className={(stats.completionRate ?? 0) >= 75 ? "text-success" : "text-warning"}>{t("dashboard.targetSuffix")}</span>}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="surface-card p-4 sm:p-6">
          <p className="mb-4 text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            {t("dashboard.chartCaption")}
          </p>
          <div className="overflow-x-auto">
            <MiniBarChart data={monthly} height={200} className="min-w-[420px]" />
          </div>
        </div>

        <AttentionPanel
          title={t("dashboard.needsAttention")}
          items={attention.map((a) => ({
            id: a.id,
            title: a.title,
            note: a.note,
            severity: a.severity,
            onClick:
              a.id === "new-coach-applications"
                ? () => navigate("/admin/coaches")
                : a.id === "new-coachee-applications"
                ? () => navigate("/admin/coachees")
                : a.id === "sessions-needing-link"
                ? () => navigate("/admin/sessions")
                : undefined,
          }))}
          empty={t("dashboard.noActiveAlerts")}
        />
      </div>
    </div>
  );
}
