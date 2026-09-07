import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { MessagesSquare, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";
import { useProgrammeModules } from "@/hooks/useProgrammeModules";
import { usePeerCoachingCardData } from "@/hooks/dashboard/usePeerCoachingCardData";
import { DashboardCardShell, CardFooterLink, CardEmptyHint, KindPill } from "./shared";

/** "Peer practice" card — the give+receive peer coaching pool, plus a
 * competency mini-snapshot for coaches (ICF self-ratings from peer sessions). */
export function PeerCoachingCard() {
  const { t } = useTranslation("dashboard");
  const { user, role } = useAuth();
  const { hasModule, loading: modulesLoading } = useProgrammeModules();
  const enabled = hasModule("peer_coaching");
  const { data, loading } = usePeerCoachingCardData(user?.id, role, enabled);

  if (!modulesLoading && !enabled) return null;

  const peerPath = role === "coach" ? "/coach/peer-coaching" : "/coachee/peer-practice";

  return (
    <DashboardCardShell
      icon={MessagesSquare}
      title={t("cards.peerCoaching.title")}
      loading={loading || modulesLoading}
      badge={
        data.pendingCount > 0 ? (
          <Badge className="bg-warning/15 text-warning hover:bg-warning/15">
            {t("cards.peerCoaching.pendingBadge", { count: data.pendingCount })}
          </Badge>
        ) : undefined
      }
    >
      {data.nextSession ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="mb-1 flex items-center gap-2">
            <KindPill
              tone={data.nextSession.direction === "give" ? "success" : "primary"}
              label={
                data.nextSession.direction === "give"
                  ? t("cards.peerCoaching.giving")
                  : t("cards.peerCoaching.receiving")
              }
            />
            <p className="truncate text-sm font-semibold">
              {data.nextSession.counterpart || t("cards.peerCoaching.defaultPeer")}
            </p>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {data.nextSession.topic} · {format(new Date(data.nextSession.start_time), "MMM d · p")}
          </p>
        </div>
      ) : (
        <CardEmptyHint text={t("cards.peerCoaching.noUpcoming")} />
      )}

      {data.competencySnapshot && data.competencySnapshot.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.competencySnapshot.slice(0, 4).map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]"
            >
              <span className="text-muted-foreground">{t(`practiceJourney.competencies.${c.label}`)}</span>
              <span className="font-bold">{c.score}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-3">
        <CardFooterLink to={peerPath}>
          {t("cards.peerCoaching.openPeerPractice")} <ArrowUpRight className="h-3 w-3" />
        </CardFooterLink>
      </div>
    </DashboardCardShell>
  );
}
