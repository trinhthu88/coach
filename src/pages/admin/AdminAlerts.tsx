import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Check, RefreshCw, Flag, Users, BarChart3, Calendar as CalendarIcon, type LucideIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { AdminPageHeader, Pill } from "./_shared";
import { FilterChip } from "@/components/ui/page-header";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { alertText, type CurrentAlert } from "./alertText";

interface ResolvedAlert {
  id: string;
  title: string;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  programme_at_risk: Flag,
  needs_attention: Flag,
  overdue_actions: Users,
  reflection_outstanding: BarChart3,
  mentor_feedback_outstanding: BarChart3,
  prep_file_outstanding: BarChart3,
  stale_programme_participant: Users,
  low_quiz_scores: BarChart3,
  goal_setup_overdue: CalendarIcon,
  coach_flagged_session: Flag,
};

function scopeFor(a: CurrentAlert, t: (key: string) => string) {
  if (a.related_coach_id) return t("alerts.scopeCoachRoster");
  if (a.related_user_id) return t("alerts.scopeCoachee");
  return t("alerts.scopeAllProgrammes");
}

const ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

export default function AdminAlerts() {
  const { t } = useTranslation("admin");
  const [alerts, setAlerts] = useState<CurrentAlert[]>([]);
  const [resolved, setResolved] = useState<ResolvedAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "critical" | "warning" | "info">("all");

  const load = async () => {
    const [current, done] = await Promise.all([
      supabase.rpc("admin_alerts_current"),
      supabase.from("admin_alerts").select("id, title").eq("resolved", true).order("resolved_at", { ascending: false }).limit(10),
    ]);
    if (current.error) toast.error(current.error.message);
    setAlerts((current.data ?? []) as CurrentAlert[]);
    setResolved((done.data ?? []) as ResolvedAlert[]);
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const resolve = async (storedId: string) => {
    await supabase.from("admin_alerts").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", storedId);
    toast.success(t("alerts.alertResolved"));
    load();
  };

  const critical = alerts.filter((a) => a.severity === "critical");
  const warning = alerts.filter((a) => a.severity === "warning");
  const info = alerts.filter((a) => a.severity === "info");

  const visible = useMemo(() => {
    const list = filter === "all" ? alerts : alerts.filter((a) => a.severity === filter);
    return [...list].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (a.subject_name ?? "").localeCompare(b.subject_name ?? ""));
  }, [alerts, filter]);

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
        eyebrow={t("alerts.eyebrow")}
        title={t("alerts.title")}
        trailing=""
        subtitle={t("alerts.subtitle", { count: alerts.length })}
        right={
          <div className="flex items-center gap-2">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>{t("alerts.filterAll")}</FilterChip>
            <FilterChip active={filter === "critical"} onClick={() => setFilter("critical")}>{t("alerts.filterCritical")}</FilterChip>
            <FilterChip active={filter === "warning"} onClick={() => setFilter("warning")}>{t("alerts.filterWarning")}</FilterChip>
            <FilterChip active={filter === "info"} onClick={() => setFilter("info")}>{t("alerts.filterInfo")}</FilterChip>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-4">
          <div className="surface-card border-l-4 border-l-accent p-4">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{t("alerts.statOpen")}</p>
            <p className="font-display mt-2 text-[2rem] leading-none">{alerts.length}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("alerts.statOpenLiveHint")}</p>
          </div>
          <div className="surface-card border-l-4 border-l-destructive p-4">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{t("alerts.statCritical")}</p>
            <p className="font-display mt-2 text-[2rem] leading-none text-destructive">{critical.length}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("alerts.statCriticalHint")}</p>
          </div>
          <div className="surface-card border-l-4 border-l-warning p-4">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{t("alerts.statWarning")}</p>
            <p className="font-display mt-2 text-[2rem] leading-none text-warning">{warning.length}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("alerts.statWarningHint")}</p>
          </div>
          <div className="surface-card border-l-4 border-l-primary p-4">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{t("alerts.statInfo")}</p>
            <p className="font-display mt-2 text-[2rem] leading-none text-primary">{info.length}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("alerts.statInfoHint")}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t("alerts.refresh")}
        </Button>
      </div>

      <div className="space-y-3">
        {visible.length === 0 ? (
          <div className="surface-card p-10 text-center text-sm text-muted-foreground">
            {filter === "all" ? t("alerts.allClearLive") : t("alerts.nothingHere")}
          </div>
        ) : (
          visible.map((a) => {
            const Icon = TYPE_ICON[a.alert_type] || Flag;
            const { title, message } = alertText(a, t);
            return (
              <div key={a.alert_key} className="surface-card flex items-start gap-4 p-5" data-testid="alert-row">
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
                      {t(`alerts.severity.${a.severity}`)}
                    </Pill>
                    <span>
                      {a.created_at ? `${formatDistanceToNow(new Date(a.created_at))} · ` : ""}
                      {scopeFor(a, t)}
                    </span>
                  </div>
                  <p className="mt-2 text-[15px] font-semibold text-foreground">{title}</p>
                  {message && <p className="mt-1 text-[12.5px] text-muted-foreground">{message}</p>}
                </div>
                {a.stored_alert_id && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" onClick={() => resolve(a.stored_alert_id!)}>
                      <Check className="h-3.5 w-3.5" /> {t("alerts.resolve")}
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {resolved.length > 0 && (
        <div className="surface-card mt-4 p-5">
          <p className="mb-3 text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            {t("alerts.resolvedCount", { count: resolved.length })}
          </p>
          <ul className="divide-y">
            {resolved.map((a) => (
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
