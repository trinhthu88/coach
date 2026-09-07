import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Users, Clock, CheckCircle2, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useCoachDashboardData } from "@/hooks/dashboard/useCoachDashboardData";
import { DashboardCardShell, CardMetricRow, CardFooterLink, CardEmptyHint } from "./shared";

/** "My clients" card — active client count, next session, pending approvals,
 * sessions delivered. Data comes from the same hook CoachDashboardView used. */
export function CoachingGiveCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { hasDirection, loading: modulesLoading } = useProgrammeModules();
  const enabled = hasDirection("coaching", "give");
  const { sessions, profilesById, loading } = useCoachDashboardData(user?.id ?? "");

  if (!modulesLoading && !enabled) return null;

  const now = new Date();
  const upcoming = sessions
    .filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const nextSession = upcoming[0];
  const pending = sessions.filter((s) => s.status === "pending_coach_approval");
  const completed = sessions.filter((s) => s.status === "completed");
  const activeClients = new Set(
    sessions.filter((s) => ["confirmed", "completed"].includes(s.status)).map((s) => s.coachee_id)
  ).size;

  return (
    <DashboardCardShell
      icon={Users}
      title={t("cards.coachingGive.title")}
      loading={loading || modulesLoading}
      dataOnboarding="dashboard-next-session"
      badge={
        pending.length > 0 ? (
          <Badge className="bg-warning/15 text-warning hover:bg-warning/15">
            {t("cards.coachingGive.pendingBadge", { count: pending.length })}
          </Badge>
        ) : undefined
      }
    >
      {nextSession ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("cards.coachingGive.nextSession")}
          </p>
          <p className="mt-1 truncate text-sm font-semibold">
            {profilesById[nextSession.coachee_id]?.full_name || t("cards.coachingGive.defaultClient")}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {nextSession.topic} · {format(new Date(nextSession.start_time), "MMM d · p")}
          </p>
        </div>
      ) : (
        <CardEmptyHint text={t("cards.coachingGive.noUpcoming")} />
      )}

      <div className="mt-3" data-onboarding="dashboard-booking-requests">
        <CardMetricRow label={t("cards.coachingGive.activeClients")} value={activeClients} />
        <CardMetricRow label={t("cards.coachingGive.sessionsDelivered")} value={completed.length} />
        <CardMetricRow
          label={t("cards.coachingGive.pendingApprovals")}
          value={
            pending.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-warning">
                <Clock className="h-3.5 w-3.5" /> {pending.length}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> 0
              </span>
            )
          }
        />
      </div>

      <div className="mt-auto flex flex-wrap gap-3 pt-3">
        <CardFooterLink to="/coach/clients">
          {t("cards.coachingGive.viewClients")} <ArrowUpRight className="h-3 w-3" />
        </CardFooterLink>
        <CardFooterLink to="/sessions">
          {t("cards.coachingGive.viewSessions")} <ArrowUpRight className="h-3 w-3" />
        </CardFooterLink>
      </div>
    </DashboardCardShell>
  );
}
