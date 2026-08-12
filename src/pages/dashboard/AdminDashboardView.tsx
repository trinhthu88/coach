import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Loader2, Users, CalendarCheck, CheckCircle2, XCircle } from "lucide-react";
import { useAdminDashboardStats } from "@/hooks/dashboard/useAdminDashboardStats";

export function AdminDashboardView() {
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
          label="Total users"
          value={String(stats.totalCoachees)}
          hint="Coachee accounts"
          icon={Users}
        />
        <StatCard
          label="Booked sessions"
          value={String(stats.bookedSessions)}
          hint="Pending + confirmed + done"
          icon={CalendarCheck}
        />
        <StatCard
          label="Completed sessions"
          value={`${stats.completedSessions} (${pct(stats.completedSessions)}%)`}
          hint="Of all sessions"
          icon={CheckCircle2}
        />
        <StatCard
          label="Cancelled sessions"
          value={`${stats.cancelledSessions} (${pct(stats.cancelledSessions)}%)`}
          hint="Of all sessions"
          icon={XCircle}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Pending sessions
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {stats.pendingLinkSessions === 0
                  ? "All upcoming sessions have a meeting link."
                  : `${stats.pendingLinkSessions} session${stats.pendingLinkSessions === 1 ? "" : "s"} still need a meeting link.`}
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/admin/sessions">Set links</Link>
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Coaches
          </p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold">{stats.newCoachApplications}</p>
              <p className="text-sm text-muted-foreground">
                {stats.newCoachApplications === 0 ? "No new applications." : "New application" + (stats.newCoachApplications === 1 ? "" : "s") + " to review."}
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/admin/coaches">Review</Link>
            </Button>
          </div>
          {stats.pendingCoaches > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {stats.pendingCoaches} existing profile{stats.pendingCoaches === 1 ? "" : "s"} awaiting approval
              </p>
              <Button asChild size="sm" variant="outline">
                <Link to="/admin/registrations">Review</Link>
              </Button>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Coachees
          </p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold">{stats.newCoacheeApplications}</p>
              <p className="text-sm text-muted-foreground">
                {stats.newCoacheeApplications === 0 ? "No new applications." : "New application" + (stats.newCoacheeApplications === 1 ? "" : "s") + " to review."}
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/admin/coachees">Review</Link>
            </Button>
          </div>
          {stats.pendingCoachees > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {stats.pendingCoachees} existing profile{stats.pendingCoachees === 1 ? "" : "s"} awaiting approval
              </p>
              <Button asChild size="sm" variant="outline">
                <Link to="/admin/registrations">Review</Link>
              </Button>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
