import { useTranslation } from "react-i18next";
import { Compass, ListChecks } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useCoachingReceiveCardData } from "@/hooks/dashboard/useCoachingReceiveCardData";
import { useLearnerCanonicalEngagement } from "@/hooks/useLearnerCanonicalProgress";
import { canonicalCompletionPct } from "@/lib/programmeProfile";
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
  const { data, loading, error: progressError, enrollmentId } = useCoachingReceiveCardData(user?.id, role, true);
  // Goal progress is the canonical enrollment figure, never a milestone ratio.
  const { engagement, error: engagementError } = useLearnerCanonicalEngagement(enrollmentId ?? undefined);
  const goalPct = canonicalCompletionPct(engagement.goal_progress_pct);

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
          {/* Canonical programme progress: a completed session = a fulfilled
              requirement unit, capped at the programme requirement. A failed
              read says so -- never a silent 0. */}
          <HeroMetricRow
            label={t("cards.coachingReceive.programmeUnits")}
            value={
              progressError ? (
                <span className="text-destructive" data-testid="coaching-progress-error">{t("cards.progressUnavailable")}</span>
              ) : data.requiredUnits == null ? (
                "—"
              ) : (
                `${data.completedUnits} / ${data.requiredUnits}`
              )
            }
          />
          {data.postSessionPending > 0 && (
            <HeroMetricRow
              label={t("cards.coachingReceive.postSessionPending")}
              value={data.postSessionPending}
            />
          )}
          {!progressError && (data.overdueUnits ?? 0) > 0 && (
            <HeroMetricRow
              label={t("cards.coachingReceive.overdue")}
              value={data.overdueUnits}
            />
          )}
          <HeroMetricRow
            label={t("cards.coachingReceive.goalsLabel")}
            value={engagementError ? t("cards.progressUnavailable") : goalPct == null ? "—" : `${goalPct}%`}
          />
          <HeroFooterLink to={journeyPath} className="mt-2">
            {t("cards.coachingReceive.openJourney")}
          </HeroFooterLink>
        </div>
      </NextSessionHero>
    </div>
  );
}
