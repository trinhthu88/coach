import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Users,
  UserCheck,
  Layers,
  Calendar,
  AlertTriangle,
  Star,
  TrendingUp,
  CheckCircle2,
  MessagesSquare,
  ArrowUpRight,
  Loader2,
} from "lucide-react";
import { format, subDays, subMonths, startOfMonth, startOfWeek, addWeeks } from "date-fns";
import { AdminPageHeader, Kpi, SectionCard, Pill, Avatar } from "./_shared";
import { cn } from "@/lib/utils";

interface Bucket { label: string; count: number; }

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    coachees: 0,
    coaches: 0,
    trainees: 0,
    sessionsThisMonth: 0,
    peerSessionsThisMonth: 0,
    avgRating: 0,
    avgGoalProgress: 0,
    actionCompletion: 0,
    atRisk: 0,
    onTrack: 0,
    needsAttention: 0,
    pendingApproval: 0,
  });
  const [weekly, setWeekly] = useState<Bucket[]>([]);
  const [topCoaches, setTopCoaches] = useState<{ id: string; name: string; coachees: number; rating: number; tone: string }[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const monthStart = startOfMonth(new Date()).toISOString();
      const eightWeeksAgo = subDays(new Date(), 56).toISOString();

      const [
        { data: roles },
        { data: profiles },
        { data: coachProfs },
        { data: sessions },
        { data: peerSessions },
        { data: enrollments },
        { data: alertRows },
        { data: goals },
      ] = await Promise.all([
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("profiles").select("id, full_name, status, created_at"),
        supabase.from("coach_profiles").select("id, rating_avg, peer_coaching_opt_in, approval_status, sessions_completed"),
        supabase.from("sessions").select("id, coach_id, start_time, status, action_items, coachee_rating"),
        supabase.from("peer_sessions").select("id, peer_coach_id, peer_coachee_id, start_time, status"),
        supabase.from("programme_enrollments").select("id, status, progress_pct"),
        supabase.from("admin_alerts").select("*").eq("resolved", false).order("created_at", { ascending: false }).limit(5),
        supabase.from("coachee_goals").select("id, status"),
      ]);

      const coacheeIds = new Set((roles || []).filter((r) => r.role === "coachee").map((r) => r.user_id));
      const coachIds = new Set((roles || []).filter((r) => r.role === "coach").map((r) => r.user_id));
      const profById = new Map((profiles || []).map((p: any) => [p.id, p]));

      const peerOptIn = (coachProfs || []).filter((c: any) => c.peer_coaching_opt_in).length;
      const sessionsThisMonth = (sessions || []).filter((s: any) => new Date(s.start_time) >= new Date(monthStart)).length;
      const peerThisMonth = (peerSessions || []).filter((s: any) => new Date(s.start_time) >= new Date(monthStart)).length;

      const ratings = (sessions || []).map((s: any) => s.coachee_rating).filter((r: any) => r);
      const avgRating = ratings.length ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : 0;

      // Action items
      let totalActions = 0;
      let doneActions = 0;
      (sessions || []).forEach((s: any) => {
        const items = Array.isArray(s.action_items) ? s.action_items : [];
        items.forEach((it: any) => {
          totalActions++;
          if (it.done) doneActions++;
        });
      });

      const onTrack = (enrollments || []).filter((e: any) => e.status === "active").length;
      const needsAttention = (enrollments || []).filter((e: any) => e.status === "paused").length;
      const atRisk = (enrollments || []).filter((e: any) => e.status === "at_risk").length;

      const avgGoal = (() => {
        const list = enrollments || [];
        if (!list.length) return 0;
        return list.reduce((acc: number, e: any) => acc + (e.progress_pct || 0), 0) / list.length;
      })();

      const pending = (profiles || []).filter((p: any) => p.status === "pending_approval").length;

      setStats({
        coachees: Array.from(coacheeIds).filter((id) => profById.get(id)?.status === "active").length,
        coaches: Array.from(coachIds).filter((id) => profById.get(id)?.status === "active").length,
        trainees: peerOptIn,
        sessionsThisMonth,
        peerSessionsThisMonth: peerThisMonth,
        avgRating,
        avgGoalProgress: avgGoal,
        actionCompletion: totalActions ? (doneActions / totalActions) * 100 : 0,
        atRisk,
        onTrack,
        needsAttention,
        pendingApproval: pending,
      });

      // Weekly bars (last 8 weeks)
      const weeks: Bucket[] = [];
      const wkStart = startOfWeek(subDays(new Date(), 49), { weekStartsOn: 1 });
      for (let i = 0; i < 8; i++) {
        const from = addWeeks(wkStart, i);
        const to = addWeeks(wkStart, i + 1);
        const cnt =
          (sessions || []).filter((s: any) => {
            const d = new Date(s.start_time);
            return d >= from && d < to;
          }).length +
          (peerSessions || []).filter((s: any) => {
            const d = new Date(s.start_time);
            return d >= from && d < to;
          }).length;
        weeks.push({ label: `W${format(from, "w")}`, count: cnt });
      }
      setWeekly(weeks);

      // Top coaches by sessions completed
      const coachSessionCount = new Map<string, number>();
      (sessions || []).forEach((s: any) => {
        if (s.status === "completed") coachSessionCount.set(s.coach_id, (coachSessionCount.get(s.coach_id) || 0) + 1);
      });
      const tones = ["primary", "success", "accent", "warning", "secondary"];
      const top = (coachProfs || [])
        .filter((c: any) => c.approval_status === "active")
        .map((c: any, i: number) => ({
          id: c.id,
          name: profById.get(c.id)?.full_name || "—",
          coachees: coachSessionCount.get(c.id) || 0,
          rating: Number(c.rating_avg || 5),
          tone: tones[i % tones.length],
        }))
        .sort((a, b) => b.rating - a.rating || b.coachees - a.coachees)
        .slice(0, 4);
      setTopCoaches(top);

      setAlerts(alertRows || []);

      // Activity feed: last 5 status changes from sessions/peer
      const activityFeed: any[] = [];
      (sessions || [])
        .filter((s: any) => s.status === "completed")
        .slice(0, 3)
        .forEach((s: any) => {
          activityFeed.push({
            kind: "session",
            tone: "primary",
            title: `Session completed`,
            sub: format(new Date(s.start_time), "PP"),
          });
        });
      (peerSessions || [])
        .filter((s: any) => s.status === "completed")
        .slice(0, 2)
        .forEach((s: any) => {
          activityFeed.push({
            kind: "peer",
            tone: "accent",
            title: `Peer session completed`,
            sub: format(new Date(s.start_time), "PP"),
          });
        });
      setActivity(activityFeed.slice(0, 5));

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

  const maxBar = Math.max(1, ...weekly.map((w) => w.count));

  return (
    <div>
      <AdminPageHeader
        title="Platform"
        emphasize="dashboard"
        subtitle={`${format(new Date(), "EEEE, MMM d, yyyy")} · All systems operational`}
      />

      {/* Top KPIs */}
      <div className="mb-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Active coachees" value={stats.coachees} icon={Users} tone="primary" hint={stats.pendingApproval ? `${stats.pendingApproval} pending` : "All approved"} hintTone="muted" />
        <Kpi label="Active coaches" value={stats.coaches} icon={UserCheck} tone="success" hint={`${stats.trainees} peer-enabled`} />
        <Kpi label="Coach trainees" value={stats.trainees} icon={Layers} tone="accent" hint="Peer coaching opt-in" />
        <Kpi label="Sessions this month" value={stats.sessionsThisMonth} icon={Calendar} tone="primary" />
        <Kpi label="At-risk programmes" value={stats.atRisk} icon={AlertTriangle} tone="destructive" hint={stats.atRisk ? "Needs attention" : "None flagged"} />
      </div>

      {/* Row 2 */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Avg satisfaction" value={stats.avgRating ? stats.avgRating.toFixed(1) : "—"} icon={Star} tone="warning" />
        <Kpi label="Avg goal progress" value={`${Math.round(stats.avgGoalProgress)}%`} icon={TrendingUp} tone="success" />
        <Kpi label="Action completion" value={`${Math.round(stats.actionCompletion)}%`} icon={CheckCircle2} tone="primary" />
        <Kpi label="Peer sessions / month" value={stats.peerSessionsThisMonth} icon={MessagesSquare} tone="accent" />
      </div>

      {/* Alerts + Activity */}
      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <SectionCard
          label="Critical alerts"
          action={<Link to="/admin/alerts" className="text-[11px] text-primary hover:underline">See all →</Link>}
        >
          {alerts.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No active alerts. 🎉</p>
          ) : (
            <ul className="divide-y">
              {alerts.map((a: any) => (
                <li key={a.id} className="flex items-start gap-2 py-2.5">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.severity === "critical" ? "bg-destructive" : a.severity === "warning" ? "bg-warning" : "bg-primary")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium leading-tight text-foreground">{a.title}</p>
                    {a.message && <p className="mt-0.5 text-[11px] text-muted-foreground">{a.message}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          label="Activity feed"
          action={<Link to="/admin/activity" className="text-[11px] text-primary hover:underline">See all →</Link>}
        >
          {activity.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No recent activity.</p>
          ) : (
            <ul className="divide-y">
              {activity.map((a, i) => (
                <li key={i} className="flex items-start gap-2 py-2.5">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.tone === "accent" ? "bg-accent" : "bg-primary")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium leading-tight text-foreground">{a.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{a.sub}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Three col: chart, programme health, top coaches */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard label="Sessions — last 8 weeks">
          <div className="flex h-24 items-end gap-1.5">
            {weekly.map((w, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-primary/70"
                  style={{ height: `${(w.count / maxBar) * 100}%`, minHeight: w.count > 0 ? 4 : 2 }}
                  title={`${w.count} sessions`}
                />
                <span className="text-[9px] text-muted-foreground">{w.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Coaching + peer sessions combined</p>
        </SectionCard>

        <SectionCard label="Programme health">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-success/10 p-3 text-center">
              <p className="text-xl font-semibold text-success">{stats.onTrack}</p>
              <p className="text-[10px] font-medium text-success">On track</p>
            </div>
            <div className="rounded-lg bg-warning/15 p-3 text-center">
              <p className="text-xl font-semibold text-warning">{stats.needsAttention}</p>
              <p className="text-[10px] font-medium text-warning">Needs attn</p>
            </div>
            <div className="rounded-lg bg-destructive/10 p-3 text-center">
              <p className="text-xl font-semibold text-destructive">{stats.atRisk}</p>
              <p className="text-[10px] font-medium text-destructive">At risk</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to="/admin/assignments">Manage assignments <ArrowUpRight className="ml-1 h-3 w-3" /></Link>
          </Button>
        </SectionCard>

        <SectionCard
          label="Top coaches"
          action={<Link to="/admin/coaches" className="text-[11px] text-primary hover:underline">All →</Link>}
        >
          {topCoaches.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No coaches yet.</p>
          ) : (
            <ul className="space-y-2">
              {topCoaches.map((c) => (
                <li key={c.id} className="flex items-center gap-2.5">
                  <Avatar name={c.name} tone={c.tone} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-foreground">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {c.coachees} session{c.coachees === 1 ? "" : "s"} · ★ {c.rating.toFixed(1)}
                    </p>
                  </div>
                  <Pill tone={c.rating >= 4.5 ? "success" : c.rating >= 4 ? "primary" : "warning"}>
                    {c.rating >= 4.5 ? "Top" : c.rating >= 4 ? "Active" : "Review"}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
