import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Check, AlertTriangle, Bell, RefreshCw } from "lucide-react";
import { format, formatDistanceToNow, subDays } from "date-fns";
import { AdminPageHeader, Pill } from "./_shared";
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
  created_at: string;
}

export default function AdminAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("admin_alerts").select("*").order("created_at", { ascending: false });
    setAlerts((data || []) as Alert[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  /**
   * Run a lightweight scan to derive alerts from session/action-item data
   * and upsert them. Fully client-side using existing tables.
   */
  const runScan = async () => {
    setScanning(true);
    try {
      const sevenDaysAgo = subDays(new Date(), 7);

      const [{ data: sessions }, { data: profiles }, { data: enrollments }] = await Promise.all([
        supabase.from("sessions").select("id, coach_id, coachee_id, status, action_items, start_time"),
        supabase.from("profiles").select("id, full_name"),
        supabase.from("programme_enrollments").select("id, coachee_id, status, progress_pct"),
      ]);

      const profById = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));
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

      // Clear unresolved auto-generated alerts of these types, then re-insert
      await supabase.from("admin_alerts").delete().in("alert_type", ["overdue_actions", "programme_at_risk"]).eq("resolved", false);
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

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const open = alerts.filter((a) => !a.resolved);
  const resolved = alerts.filter((a) => a.resolved);

  return (
    <div>
      <AdminPageHeader
        title="Alerts"
        subtitle="System-flagged issues across coachees, coaches, and programmes."
        right={
          <Button onClick={runScan} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run scan
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Open ({open.length})
        </p>
        {open.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">All clear. Run a scan to refresh.</p>
        ) : (
          <ul className="divide-y">
            {open.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-3">
                <span
                  className={cn(
                    "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                    a.severity === "critical" ? "bg-destructive" : a.severity === "warning" ? "bg-warning" : "bg-primary"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{a.title}</p>
                    <Pill tone={a.severity === "critical" ? "destructive" : a.severity === "warning" ? "warning" : "primary"}>
                      {a.severity}
                    </Pill>
                  </div>
                  {a.message && <p className="mt-1 text-[12px] text-muted-foreground">{a.message}</p>}
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => resolve(a.id)}>
                  <Check className="h-4 w-4" /> Resolve
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {resolved.length > 0 && (
        <Card className="p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Resolved ({resolved.length})
          </p>
          <ul className="divide-y">
            {resolved.slice(0, 10).map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-2">
                <Check className="mt-0.5 h-4 w-4 text-success" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-muted-foreground line-through">{a.title}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
