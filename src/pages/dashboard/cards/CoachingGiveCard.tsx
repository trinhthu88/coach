import { useTranslation } from "react-i18next";
import { Users, Clock, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useCoachDashboardData } from "@/hooks/dashboard/useCoachDashboardData";
import { NextSessionHero, HeroMetricRow, HeroFooterLink, HeroSkeleton } from "./NextSessionHero";

/** "My clients" hero — active client count, next session, pending approvals,
 * sessions delivered. Data comes from the same hook CoachDashboardView used. */
export function CoachingGiveCard() {
  const { t } = useTranslation("dashboard");
  const { user } = useAuth();
  const { hasDirection, loading: modulesLoading } = useProgrammeModules();
  const enabled = hasDirection("coaching", "give");
  const { sessions, profilesById, loading } = useCoachDashboardData(user?.id ?? "");

  if (!modulesLoading && !enabled) return null;
  if (modulesLoading || loading) return <HeroSkeleton />;

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
    <div data-onboarding="dashboard-next-session">
      <NextSessionHero
        icon={Users}
        eyebrowLabel={t("cards.coachingGive.title")}
        badge={
          pending.length > 0 ? (
            <span className="rounded-full bg-warning/20 px-2.5 py-1 text-[10px] font-bold text-warning">
              {t("cards.coachingGive.pendingBadge", { count: pending.length })}
            </span>
          ) : undefined
        }
        nextSession={
          nextSession
            ? {
                topic: nextSession.topic,
                startTime: nextSession.start_time,
                counterpartName: profilesById[nextSession.coachee_id]?.full_name || t("cards.coachingGive.defaultClient"),
              }
            : null
        }
        ctaLabel={t("coachee.nextSession.joinAndPrepare")}
        ctaHref={nextSession ? `/sessions/${nextSession.id}` : "/coach/clients"}
        emptyTitle={t("coach.nextSession.noneTitle")}
        emptyBody={t("cards.coachingGive.noUpcoming")}
      >
        <div data-onboarding="dashboard-booking-requests">
          <HeroMetricRow label={t("cards.coachingGive.activeClients")} value={activeClients} />
          <HeroMetricRow label={t("cards.coachingGive.sessionsDelivered")} value={completed.length} />
          <HeroMetricRow
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
          <div className="mt-2 flex flex-wrap gap-4">
            <HeroFooterLink to="/coach/clients">{t("cards.coachingGive.viewClients")}</HeroFooterLink>
            <HeroFooterLink to="/sessions">{t("cards.coachingGive.viewSessions")}</HeroFooterLink>
          </div>
        </div>
      </NextSessionHero>
    </div>
  );
}
