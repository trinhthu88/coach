import { useTranslation } from "react-i18next";
import { Compass, ListChecks } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useCoachingReceiveCardData } from "@/hooks/dashboard/useCoachingReceiveCardData";
import { NextSessionHero, HeroMetricRow, HeroFooterLink, HeroSkeleton } from "./NextSessionHero";

/** "My coaching" hero — the receiving-coaching experience, shown for both
 * coach (coach-as-coachee) and coachee roles depending on programme config. */
export function CoachingReceiveCard() {
  const { t } = useTranslation("dashboard");
  const { user, role } = useAuth();
  const { hasDirection, loading: modulesLoading } = useProgrammeModules();
  const enabled = hasDirection("coaching", "receive");
  // Fetch runs as soon as we know who's asking — it doesn't need to wait on
  // the programme-modules RPC too. `enabled` above still gates whether the
  // card renders at all; this just stops that check from serializing behind
  // it (see 2026-09-08 dashboard-load-latency investigation).
  const { data, loading } = useCoachingReceiveCardData(user?.id, role, true);

  if (!modulesLoading && !enabled) return null;
  if (modulesLoading || loading) return <HeroSkeleton />;

  const journeyPath = role === "coach" ? "/coach/my-journey" : "/coachee/journey";

  return (
    <div data-onboarding="dashboard-next-session">
      <NextSessionHero
        icon={Compass}
        eyebrowLabel={t("cards.coachingReceive.title")}
        nextSession={
          data.nextSession
            ? {
                topic: data.nextSession.topic,
                startTime: data.nextSession.start_time,
                counterpartName: data.nextSession.coach?.full_name || t("cards.coachingReceive.defaultCoach"),
              }
            : null
        }
        ctaLabel={t("coachee.nextSession.joinAndPrepare")}
        ctaHref={data.nextSession ? `/sessions/${data.nextSession.id}` : journeyPath}
        emptyTitle={t("coachee.nextSession.noneTitle")}
        emptyBody={t("cards.coachingReceive.noUpcoming")}
      >
        <div data-onboarding="dashboard-session-log">
          <HeroMetricRow
            label={t("cards.coachingReceive.actionItemsDue")}
            value={
              <span className="inline-flex items-center gap-1">
                <ListChecks className="h-3.5 w-3.5" /> {data.actionItemsOpen}
              </span>
            }
          />
          <HeroMetricRow
            label={t("cards.coachingReceive.sessionsUsed")}
            value={data.sessionLimit != null ? `${data.sessionsUsed} / ${data.sessionLimit}` : data.sessionsUsed}
          />
          <HeroMetricRow label={t("cards.coachingReceive.goalsLabel")} value={`${data.goalProgressPct}%`} />
          <HeroFooterLink to={journeyPath} className="mt-2">
            {t("cards.coachingReceive.openJourney")}
          </HeroFooterLink>
        </div>
      </NextSessionHero>
    </div>
  );
}
