import { useTranslation } from "react-i18next";
import { Users, Clock, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useQuery } from "@tanstack/react-query";
import { fetchCoachNextSessions, pickModule } from "@/lib/nextSessions";
import { NextSessionHero, HeroMetricRow, HeroFooterLink, HeroSkeleton } from "./NextSessionHero";

/** "My clients" hero — active client count, next session, pending approvals,
 * sessions delivered: the Coach's Coaching row of coach_next_session_by_module
 * (20261007001100), rendered. */
export function CoachingGiveCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { hasDirection, loading: modulesLoading } = useProgrammeModules();
  const enabled = hasDirection("coaching", "give");
  const { data: rows, isLoading: loading } = useQuery({
    queryKey: ["coach-next-sessions", user?.id],
    queryFn: fetchCoachNextSessions,
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  if (!modulesLoading && !enabled) return null;
  if (modulesLoading || loading) return <HeroSkeleton />;

  const coaching = pickModule(rows ?? [], "coaching");
  const nextSession = coaching?.source_id && coaching.start_time ? coaching : null;
  const pendingCount = coaching?.pending_count ?? 0;

  return (
    <div data-onboarding="dashboard-next-session">
      <NextSessionHero
        icon={Users}
        eyebrowLabel={t("cards.coachingGive.title")}
        badge={
          pendingCount > 0 ? (
            <span className="rounded-full bg-warning/20 px-2.5 py-1 text-[10px] font-bold text-warning">
              {t("cards.coachingGive.pendingBadge", { count: pendingCount })}
            </span>
          ) : undefined
        }
        nextSession={
          nextSession
            ? {
                topic: nextSession.title ?? "",
                startTime: nextSession.start_time as string,
                counterpartName: nextSession.learner_name || t("cards.coachingGive.defaultClient"),
              }
            : null
        }
        ctaLabel={t("coachee.nextSession.joinAndPrepare")}
        ctaHref={nextSession ? `/sessions/${nextSession.source_id}` : "/coach/clients"}
        emptyTitle={t("coach.nextSession.noneTitle")}
        emptyBody={t("cards.coachingGive.noUpcoming")}
      >
        <div data-onboarding="dashboard-booking-requests">
          <HeroMetricRow label={t("cards.coachingGive.activeClients")} value={coaching?.learner_count ?? 0} />
          <HeroMetricRow label={t("cards.coachingGive.sessionsDelivered")} value={coaching?.delivered_count ?? 0} />
          <HeroMetricRow
            label={t("cards.coachingGive.pendingApprovals")}
            value={
              pendingCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-warning">
                  <Clock className="h-3.5 w-3.5" /> {pendingCount}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 0
                </span>
              )
            }
          />
          <div className="mt-2 flex flex-wrap gap-4">
            <HeroFooterLink to="/coach/clients">{t("cards.coachingGive.viewClients")}</HeroFooterLink>
            <HeroFooterLink to="/sessions">{t("cards.coachingGive.viewSessions")}</HeroFooterLink>
          </div>
        </div>
      </NextSessionHero>
    </div>
  );
}
