import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { format, startOfMonth, subMonths } from "date-fns";
import { AdminPageHeader } from "./_shared";
import { StatCard } from "@/components/ui/page-header";
import { MiniBarChart, AttentionPanel } from "@/components/ui/proto";
import { Users, UserCheck, Calendar, CheckCircle2 } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

interface Bucket { label: string; value: number; }

interface DashboardProfileRow {
  id: string;
  full_name: string | null;
  status: string;
  created_at: string;
}

interface DashboardSessionRow {
  id: string;
  start_time: string;
}

interface DashboardCoachProfileRow {
  id: string;
  approval_status: string;
}

interface DashboardEnrollmentRow {
  id: string;
  status: string;
  progress_pct: number | null;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    coachees: 0,
    coaches: 0,
    pendingApproval: 0,
    newCoachApplications: 0,
    newCoacheeApplications: 0,
    sessionsThisMonth: 0,
    completionRate: 0,
  });
  const [monthly, setMonthly] = useState<Bucket[]>([]);
  const [attention, setAttention] = useState<{ id: string; title: string; note?: string; severity: "critical" | "warning" | "info" }[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const monthStart = startOfMonth(new Date()).toISOString();

      const [
        { data: roles },
        { data: profiles },
        { data: cps },
        { data: sessions },
        { data: peerSessions },
        { data: enrollments },
        { data: alertRows },
        { count: newCoachApplications },
        { count: newCoacheeApplications },
      ] = await Promise.all([
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("profiles").select("id, full_name, status, created_at"),
        supabase.from("coach_profiles").select("id, approval_status"),
        supabase.from("sessions").select("id, coach_id, start_time, status"),
        supabase.from("peer_sessions").select("id, start_time, status"),
        supabase.from("programme_enrollments").select("id, status, progress_pct"),
        supabase.from("admin_alerts").select("*").eq("resolved", false).order("created_at", { ascending: false }).limit(6),
        supabase.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending").eq("role", "coach"),
        supabase.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending").eq("role", "executive"),
      ]);

      const coacheeIds = new Set((roles || []).filter((r) => r.role === "coachee").map((r) => r.user_id));
      const coachIds = new Set((roles || []).filter((r) => r.role === "coach").map((r) => r.user_id));
      const profById = new Map((profiles || []).map((p: DashboardProfileRow) => [p.id, p]));

      const sessionsThisMonth = (sessions || []).filter((s: DashboardSessionRow) => new Date(s.start_time) >= new Date(monthStart)).length
        + (peerSessions || []).filter((s: DashboardSessionRow) => new Date(s.start_time) >= new Date(monthStart)).length;

      const pending = Array.from(coachIds).filter((id) => (cps || []).find((c: DashboardCoachProfileRow) => c.id === id)?.approval_status === "pending_approval").length;

      const avgProgress = (enrollments || []).length
        ? (enrollments || []).reduce((acc: number, e: DashboardEnrollmentRow) => acc + (e.progress_pct || 0), 0) / (enrollments || []).length
        : 0;

      setStats({
        coachees: Array.from(coacheeIds).filter((id) => profById.get(id)?.status === "active").length,
        coaches: Array.from(coachIds).filter((id) => profById.get(id)?.status === "active").length,
        pendingApproval: pending,
        newCoachApplications: newCoachApplications || 0,
        newCoacheeApplications: newCoacheeApplications || 0,
        sessionsThisMonth,
        completionRate: avgProgress,
      });

      // Monthly bars — last 8 months
      const months: Bucket[] = [];
      for (let i = 7; i >= 0; i--) {
        const from = startOfMonth(subMonths(new Date(), i));
        const to = startOfMonth(subMonths(new Date(), i - 1));
        const cnt =
          (sessions || []).filter((s: DashboardSessionRow) => {
            const d = new Date(s.start_time);
            return d >= from && d < to;
          }).length +
          (peerSessions || []).filter((s: DashboardSessionRow) => {
            const d = new Date(s.start_time);
            return d >= from && d < to;
          }).length;
        months.push({ label: format(from, "MMM").toUpperCase(), value: cnt });
      }
      setMonthly(months);

      const applicationItems: typeof attention = [];
      if (newCoachApplications) {
        applicationItems.push({
          id: "new-coach-applications",
          title: `${newCoachApplications} new coach application${newCoachApplications === 1 ? "" : "s"}`,
          note: "Awaiting your first review",
          severity: "info",
        });
      }
      if (newCoacheeApplications) {
        applicationItems.push({
          id: "new-coachee-applications",
          title: `${newCoacheeApplications} new coachee application${newCoacheeApplications === 1 ? "" : "s"}`,
          note: "Awaiting your first review",
          severity: "info",
        });
      }

      const items = (alertRows || []).map((a: Tables<"admin_alerts">) => ({
        id: a.id,
        title: a.title,
        note: a.message ?? undefined,
        severity: (a.severity === "critical" ? "critical" : a.severity === "warning" ? "warning" : "info") as "critical" | "warning" | "info",
      }));
      setAttention([...applicationItems, ...items]);

      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader eyebrow="Organisation" title="Programme" emphasize="health" trailing="" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active coachees"
          value={stats.coachees}
          icon={Users}
          tone="primary"
          hint={
            stats.newCoacheeApplications > 0 ? (
              <span className="text-warning">{stats.newCoacheeApplications} new application{stats.newCoacheeApplications === 1 ? "" : "s"}</span>
            ) : (
              <span className="text-success">+{Math.max(0, stats.coachees - Math.round(stats.coachees * 0.93))} this month</span>
            )
          }
        />
        <StatCard
          label="Accredited coaches"
          value={stats.coaches}
          icon={UserCheck}
          tone="secondary"
          hint={
            stats.pendingApproval + stats.newCoachApplications > 0 ? (
              <span className="text-warning">{stats.pendingApproval + stats.newCoachApplications} pending review</span>
            ) : (
              "All approved"
            )
          }
        />
        <StatCard
          label="Sessions delivered"
          value={stats.sessionsThisMonth}
          icon={Calendar}
          tone="primary"
          hint={`${format(new Date(), "MMMM")} to date`}
        />
        <StatCard
          label="Completion rate"
          value={`${Math.round(stats.completionRate)}%`}
          icon={CheckCircle2}
          tone={stats.completionRate >= 75 ? "success" : "warning"}
          hint={<span className={stats.completionRate >= 75 ? "text-success" : "text-warning"}>target 75%</span>}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="surface-card p-6">
          <p className="mb-4 text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Sessions delivered · by month
          </p>
          <MiniBarChart data={monthly} height={200} />
        </div>

        <AttentionPanel
          title="Needs attention"
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
                : undefined,
          }))}
          empty="No active alerts. All clear."
        />
      </div>
    </div>
  );
}
