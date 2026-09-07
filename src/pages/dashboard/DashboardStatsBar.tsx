import { useTranslation } from "react-i18next";
import { CheckCircle2, Users, TrendingUp, MessagesSquare, CalendarCheck } from "lucide-react";
import { StatCard } from "@/components/ui/page-header";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { useCoachDashboardData } from "@/hooks/dashboard/useCoachDashboardData";
import { useCoachingReceiveCardData } from "@/hooks/dashboard/useCoachingReceiveCardData";
import { useMentoringGiveCardData, useMentoringReceiveCardData } from "@/hooks/dashboard/useMentoringCardData";
import { usePeerCoachingCardData } from "@/hooks/dashboard/usePeerCoachingCardData";
import { useTriadsCardData } from "@/hooks/dashboard/useTriadsCardData";

/**
 * Picks which metrics to show based on the enabled modules — every hook here
 * shares a react-query cache key with its dashboard card, so this bar adds no
 * extra network round-trips beyond what the cards already fetch.
 */
export function DashboardStatsBar() {
  const { t } = useTranslation("dashboard");
  const { user, role } = useAuth();
  const { hasDirection, hasModule, loading: modulesLoading } = useProgrammeModules();

  const give = hasDirection("coaching", "give");
  const receive = hasDirection("coaching", "receive");
  const peer = hasModule("peer_coaching");
  const mentorGive = hasDirection("mentoring", "give");
  const mentorReceive = hasDirection("mentoring", "receive");
  const triads = hasModule("triads");

  const coachData = useCoachDashboardData(give ? user?.id ?? "" : "");
  const receiveData = useCoachingReceiveCardData(user?.id, role, receive);
  const mentorGiveData = useMentoringGiveCardData(user?.id, mentorGive);
  const mentorReceiveData = useMentoringReceiveCardData(user?.id, mentorReceive);
  const peerData = usePeerCoachingCardData(user?.id, role, peer);
  const triadsData = useTriadsCardData(user?.id, triads);

  if (modulesLoading) return null;

  const now = new Date();
  const coachUpcoming = give
    ? coachData.sessions.filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now).length +
      coachData.peerSessions.filter((s) => s.status === "confirmed" && new Date(s.start_time) >= now).length
    : 0;

  const totalUpcoming =
    coachUpcoming +
    (receive ? receiveData.data.upcomingCount : 0) +
    (mentorGive ? mentorGiveData.data.upcomingCount : 0) +
    (mentorReceive ? mentorReceiveData.data.upcomingCount : 0) +
    (peer ? peerData.data.upcomingCount : 0) +
    (triads ? triadsData.data.upcomingCount : 0);

  const tiles: { key: string; label: string; value: string; hint: string; icon: React.ElementType }[] = [];

  if (give) {
    const completed = coachData.sessions.filter((s) => s.status === "completed").length;
    const activeClients = new Set(
      coachData.sessions
        .filter((s) => ["confirmed", "completed"].includes(s.status))
        .map((s) => s.coachee_id)
    ).size;
    tiles.push({
      key: "sessionsDelivered",
      label: t("stats.sessionsDelivered"),
      value: String(completed),
      hint: t("stats.sessionsDeliveredHint"),
      icon: CheckCircle2,
    });
    tiles.push({
      key: "activeClients",
      label: t("stats.activeClients"),
      value: String(activeClients),
      hint: t("stats.activeClientsHint"),
      icon: Users,
    });
  }

  if (receive) {
    tiles.push({
      key: "sessionsAttended",
      label: t("stats.sessionsAttended"),
      value: String(receiveData.data.sessionsUsed),
      hint: t("stats.sessionsAttendedHint"),
      icon: CheckCircle2,
    });
    tiles.push({
      key: "goalProgress",
      label: t("stats.goalProgress"),
      value: `${receiveData.data.goalProgressPct}%`,
      hint: t("stats.goalProgressHint"),
      icon: TrendingUp,
    });
  }

  if (peer) {
    tiles.push({
      key: "peerSessionsCompleted",
      label: t("stats.peerSessionsCompleted"),
      value: String(peerData.data.completedCount),
      hint: t("stats.peerSessionsCompletedHint"),
      icon: MessagesSquare,
    });
  }

  tiles.push({
    key: "upcoming",
    label: t("stats.upcoming"),
    value: String(totalUpcoming),
    hint: t("stats.upcomingHint"),
    icon: CalendarCheck,
  });

  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <StatCard key={tile.key} label={tile.label} value={tile.value} hint={tile.hint} icon={tile.icon} />
      ))}
    </section>
  );
}
