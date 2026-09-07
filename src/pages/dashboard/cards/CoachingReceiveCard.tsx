import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Compass, ArrowUpRight, ListChecks } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useCoachingReceiveCardData } from "@/hooks/dashboard/useCoachingReceiveCardData";
import { ProgressRing } from "@/components/ui/proto";
import { DashboardCardShell, CardMetricRow, CardFooterLink, CardEmptyHint } from "./shared";

/** "My coaching" card — the receiving-coaching experience, shown for both
 * coach (coach-as-coachee) and coachee roles depending on programme config. */
export function CoachingReceiveCard() {
  const { t } = useTranslation("dashboard");
  const { user, role } = useAuth();
  const { hasDirection, loading: modulesLoading } = useProgrammeModules();
  const enabled = hasDirection("coaching", "receive");
  const { data, loading } = useCoachingReceiveCardData(user?.id, role, enabled);

  if (!modulesLoading && !enabled) return null;

  const journeyPath = role === "coach" ? "/coach/my-journey" : "/coachee/journey";

  return (
    <DashboardCardShell icon={Compass} title={t("cards.coachingReceive.title")} loading={loading || modulesLoading}>
      <div data-onboarding="dashboard-next-session" className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          {data.nextSession ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("cards.coachingReceive.nextSession")}
              </p>
              <p className="mt-1 truncate text-sm font-semibold">
                {data.nextSession.coach?.full_name || t("cards.coachingReceive.defaultCoach")}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {data.nextSession.topic} · {format(new Date(data.nextSession.start_time), "MMM d · p")}
              </p>
            </div>
          ) : (
            <CardEmptyHint text={t("cards.coachingReceive.noUpcoming")} />
          )}
        </div>
        <ProgressRing
          value={data.goalProgressPct}
          tone="primary"
          size={64}
          label={<span className="text-[7px] tracking-widest">{t("cards.coachingReceive.goalsLabel")}</span>}
        />
      </div>

      <div className="mt-3">
        <CardMetricRow
          label={t("cards.coachingReceive.actionItemsDue")}
          value={
            <span className="inline-flex items-center gap-1">
              <ListChecks className="h-3.5 w-3.5" /> {data.actionItemsOpen}
            </span>
          }
        />
        <CardMetricRow
          label={t("cards.coachingReceive.sessionsUsed")}
          value={data.sessionLimit != null ? `${data.sessionsUsed} / ${data.sessionLimit}` : data.sessionsUsed}
        />
      </div>

      <div className="mt-auto pt-3" data-onboarding="dashboard-session-log">
        <CardFooterLink to={journeyPath}>
          {t("cards.coachingReceive.openJourney")} <ArrowUpRight className="h-3 w-3" />
        </CardFooterLink>
      </div>
    </DashboardCardShell>
  );
}
