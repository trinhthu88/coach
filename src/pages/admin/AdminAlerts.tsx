import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Check, RefreshCw, Flag, Users, MessagesSquare, BarChart3, Calendar as CalendarIcon, PanelsTopLeft } from "lucide-react";
import { formatDistanceToNow, subDays } from "date-fns";
import { AdminPageHeader, Pill } from "./_shared";
import { buildFeedbackAlerts } from "./alertScan";
import { StatCard } from "@/components/ui/page-header";
import { FilterChip } from "@/components/ui/page-header";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Alert {
  id: string;
  severity: "info" | "warning" | "critical";
  alert_type: string;
  title: string;
  message: string | null;
  related_coachee_id: string | null;
  related_coach_id: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

const TYPE_ICON: Record<string, any> = {
  overdue_actions: Users,
  programme_at_risk: Flag,
  cohort_underbooked: Flag,
  coach_applications: Users,
  feedback_response: BarChart3,
  coach_capacity: CalendarIcon,
  renewal: PanelsTopLeft,
};

function scopeFor(a: Alert) {
  if (a.related_coach_id) return "Coach roster";
  if (a.related_coachee_id) return "Coachee";
  return "All programmes";
}

export default function AdminAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<"all" | "critical" | "warning" | "info">("all");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("admin_alerts").select("*").order("created_at", { ascending: false });
    setAlerts((data || []) as Alert[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runScan = async () => {
    setScanning(true);
    try {
      const sevenDaysAgo = subDays(new Date(), 7);
      const now = new Date();

      const [
        { data: sessions },
        { data: peerSessions },
        { data: peerFeedback },
        { data: profiles },
        { data: enrollments },
      ] = await Promise.all([
        supabase
          .from("sessions")
          .select("id, coach_id, coachee_id, status, action_items, start_time, coachee_notes"),
        supabase
          .from("peer_sessions")
          .select("id, peer_coach_id, peer_coachee_id, status, start_time"),
        supabase.from("peer_session_competency_feedback").select("peer_session_id"),
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("programme_enrollments").select("id, coachee_id, status, progress_pct"),
      ]);

      const profById = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));
      const emailById = new Map((profiles || []).map((p: any) => [p.id, p.email]));
      const peerFeedbackSessionIds = new Set((peerFeedback || []).map((f: any) => f.peer_session_id));
      const overdueByCoachee = new Map<string, number>();
      (sessions || []).forEach((s: any) => {
        const items = Array.isArray(s.action_items) ? s.action_items : [];
        items.forEach((it: any) => {
          if (!it.done && it.due_date && new Date(it.due_date) < new Date()) {
            overdueByCoachee.set(s.coachee_id, (overdueByCoachee.get(s.coachee_id) || 0) + 1);
          }
        });
      });

      const newAlerts: any[] = [];
      overdueByCoachee.forEach((count, coacheeId) => {
        if (count >= 3) {
          newAlerts.push({
            severity: count >= 5 ? "critical" : "warning",
            alert_type: "overdue_actions",
            title: `${profById.get(coacheeId) || "Coachee"} — ${count} overdue actions`,
            message: count >= 5 ? "Programme at risk · consider intervention" : "Engagement dropping",
            related_coachee_id: coacheeId,
            resolved: false,
          });
        }
      });

      (enrollments || []).forEach((e: any) => {
        if (e.status === "at_risk") {
          newAlerts.push({
            severity: "critical",
            alert_type: "programme_at_risk",
            title: `${profById.get(e.coachee_id) || "Coachee"} — programme at risk`,
            message: `Progress ${e.progress_pct}% · review needed`,
            related_coachee_id: e.coachee_id,
            resolved: false,
          });
        }
      });

      // Missing reflection / competency feedback — regular + peer sessions
      newAlerts.push(
        ...buildFeedbackAlerts({
          sessions: (sessions || []) as any,
          peerSessions: (peerSessions || []) as any,
          peerFeedbackSessionIds,
          nameById: profById,
          emailById,
          now,
        })
      );

      await supabase
        .from("admin_alerts")
        .delete()
        .in("alert_type", ["overdue_actions", "programme_at_risk", "feedback_response"])
        .eq("resolved", false);
      if (newAlerts.length) await supabase.from("admin_alerts").insert(newAlerts);

      toast.success(`Scan complete · ${newAlerts.length} active alerts`);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setScanning(false);
    }
  };

  const resolve = async (id: string) => {
    await supabase.from("admin_alerts").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", id);
    toast.success("Alert resolved");
    load();
  };

  const open = alerts.filter((a) => !a.resolved);
  const resolved = alerts.filter((a) => a.resolved);
  const critical = open.filter((a) => a.severity === "critical");
  const warning = open.filter((a) => a.severity === "warning");
  const resolvedToday = resolved.filter((a) => a.resolved_at && new Date(a.resolved_at).toDateString() === new Date().toDateString());

  const visible = useMemo(() => {
    // Sort by severity first (critical > warning > info), then newest
    const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const list = filter === "all" ? open : open.filter((a) => a.severity === filter);
    return [...list].sort((a, b) => order[a.severity] - order[b.severity] || +new Date(b.created_at) - +new Date(a.created_at));
  }, [open, filter]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="Organisation"
        title="Alerts"
        trailing=""
        subtitle={`${open.length} open. Sorted by what will cost you a cohort first.`}
        right={
          <div className="flex items-center gap-2">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All</FilterChip>
            <FilterChip active={filter === "critical"} onClick={() => setFilter("critical")}>Critical</FilterChip>
            <FilterChip active={filter === "warning"} onClick={() => setFilter("warning")}>Warning</FilterChip>
            <FilterChip active={filter === "info"} onClick={() => setFilter("info")}>Info</FilterChip>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-4">
          <div className="surface-card border-l-4 border-l-accent p-4">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Open</p>
            <p className="font-display mt-2 text-[2rem] leading-none">{open.length}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">of {alerts.length} raised</p>
          </div>
          <div className="surface-card border-l-4 border-l-destructive p-4">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Critical</p>
            <p className="font-display mt-2 text-[2rem] leading-none text-destructive">{critical.length}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">cohort revenue at risk</p>
          </div>
          <div className="surface-card border-l-4 border-l-warning p-4">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Warning</p>
            <p className="font-display mt-2 text-[2rem] leading-none text-warning">{warning.length}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">service standards slipping</p>
          </div>
          <div className="surface-card border-l-4 border-l-success p-4">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Resolved today</p>
            <p className="font-display mt-2 text-[2rem] leading-none text-success">{resolvedToday.length}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">by you</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={runScan} disabled={scanning}>
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Run scan
        </Button>
      </div>

      <div className="space-y-3">
        {visible.length === 0 ? (
          <div className="surface-card p-10 text-center text-sm text-muted-foreground">
            {filter === "all" ? "All clear. Run a scan to refresh." : "Nothing here right now."}
          </div>
        ) : (
          visible.map((a) => {
            const Icon = TYPE_ICON[a.alert_type] || Flag;
            return (
              <div key={a.id} className="surface-card flex items-start gap-4 p-5">
                <span
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-[10px]",
                    a.severity === "critical" ? "bg-destructive/10 text-destructive" : a.severity === "warning" ? "bg-warning/15 text-warning" : "bg-primary-soft text-primary"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    <Pill tone={a.severity === "critical" ? "destructive" : a.severity === "warning" ? "warning" : "primary"}>
                      {a.severity}
                    </Pill>
                    <span>{formatDistanceToNow(new Date(a.created_at))} · {scopeFor(a)}</span>
                  </div>
                  <p className="mt-2 text-[15px] font-semibold text-foreground">{a.title}</p>
                  {a.message && <p className="mt-1 text-[12.5px] text-muted-foreground">{a.message}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" onClick={() => resolve(a.id)}>
                    <Check className="h-3.5 w-3.5" /> Resolve
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {resolved.length > 0 && (
        <div className="surface-card mt-4 p-5">
          <p className="mb-3 text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Resolved ({resolved.length})
          </p>
          <ul className="divide-y">
            {resolved.slice(0, 10).map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-2">
                <Check className="mt-0.5 h-4 w-4 text-success" />
                <p className="min-w-0 flex-1 text-[12px] font-medium text-muted-foreground line-through">{a.title}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
