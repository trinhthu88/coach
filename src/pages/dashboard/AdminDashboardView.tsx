import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Loader2, Users, CalendarCheck, CheckCircle2, XCircle } from "lucide-react";
import { useAdminDashboardStats } from "@/hooks/dashboard/useAdminDashboardStats";

export function AdminDashboardView() {
  const { t } = useTranslation("dashboard");
  const { stats, loading } = useAdminDashboardStats();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const pct = (n: number) =>
    stats.totalSessions > 0 ? Math.round((n / stats.totalSessions) * 100) : 0;

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("admin.stats.totalUsers")}
          value={String(stats.totalCoachees)}
          hint={t("admin.stats.totalUsersHint")}
          icon={Users}
        />
        <StatCard
          label={t("admin.stats.bookedSessions")}
          value={String(stats.bookedSessions)}
          hint={t("admin.stats.bookedSessionsHint")}
          icon={CalendarCheck}
        />
        <StatCard
          label={t("admin.stats.completedSessions")}
          value={`${stats.completedSessions} (${pct(stats.completedSessions)}%)`}
          hint={t("admin.stats.completedSessionsHint")}
          icon={CheckCircle2}
        />
        <StatCard
          label={t("admin.stats.cancelledSessions")}
          value={`${stats.cancelledSessions} (${pct(stats.cancelledSessions)}%)`}
          hint={t("admin.stats.cancelledSessionsHint")}
          icon={XCircle}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("admin.pendingSessions.title")}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {stats.pendingLinkSessions === 0
                  ? t("admin.pendingSessions.allSet")
                  : t("admin.pendingSessions.needsLink", { count: stats.pendingLinkSessions })}
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/admin/sessions">{t("admin.pendingSessions.setLinks")}</Link>
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("admin.coaches.title")}
          </p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold">{stats.newCoachApplications}</p>
              <p className="text-sm text-muted-foreground">
                {stats.newCoachApplications === 0 ? t("admin.coaches.noNewApplications") : t("admin.coaches.newApplications", { count: stats.newCoachApplications })}
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/admin/coaches">{t("admin.coaches.review")}</Link>
            </Button>
          </div>
          {stats.pendingCoaches > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {t("admin.coaches.profilesAwaitingApproval", { count: stats.pendingCoaches })}
              </p>
              <Button asChild size="sm" variant="outline">
                <Link to="/admin/registrations">{t("admin.coaches.review")}</Link>
              </Button>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("admin.coachees.title")}
          </p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold">{stats.newCoacheeApplications}</p>
              <p className="text-sm text-muted-foreground">
                {stats.newCoacheeApplications === 0 ? t("admin.coachees.noNewApplications") : t("admin.coachees.newApplications", { count: stats.newCoacheeApplications })}
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/admin/coachees">{t("admin.coachees.review")}</Link>
            </Button>
          </div>
          {stats.pendingCoachees > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {t("admin.coachees.profilesAwaitingApproval", { count: stats.pendingCoachees })}
              </p>
              <Button asChild size="sm" variant="outline">
                <Link to="/admin/registrations">{t("admin.coachees.review")}</Link>
              </Button>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
