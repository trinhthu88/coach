import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarClock, CheckCircle2, Clock, Video } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useTriadSession } from "@/hooks/triads/useTriadSession";
import { useGroupReflections } from "@/hooks/triads/useTriadReflection";
import type { TriadRoundEntry } from "@/hooks/triads/useMyTriads";
import { TriadAlternativeProposal } from "./TriadAlternativeProposal";

const RESPONSE_BY_SLOT = ["member_1_response", "member_2_response", "member_3_response"] as const;
const ID_BY_SLOT = ["member_1_id", "member_2_id", "member_3_id"] as const;

export function TriadSessionCard({ entry }: { entry: TriadRoundEntry }) {
  const { t } = useTranslation("triads");
  const { user } = useAuth();
  const { acceptSession, markCompleted, isPending } = useTriadSession();
  const { session, group, members, reflectionSubmitted } = entry;
  const [showAlternative, setShowAlternative] = useState(false);

  const { reflections } = useGroupReflections(session?.status === "completed" ? session.id : undefined);

  if (!session) {
    return <Card className="p-6 text-center text-sm text-muted-foreground">{t("session.noSessionYet")}</Card>;
  }

  const responseFor = (memberId: string): "pending" | "accepted" | "declined" => {
    for (let i = 0; i < 3; i++) {
      if (group[ID_BY_SLOT[i]] === memberId) return session[RESPONSE_BY_SLOT[i]] ?? "pending";
    }
    return "pending";
  };

  const handleAccept = async () => {
    try {
      await acceptSession({ sessionId: session.id, group });
      toast.success(t("session.acceptSuccess"));
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("session.acceptError") }));
    }
  };

  const handleMarkCompleted = async () => {
    try {
      await markCompleted(session.id);
      toast.success(t("session.markCompletedSuccess"));
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, t, { fallback: t("session.markCompletedError") }));
    }
  };

  const myResponse = user ? responseFor(user.id) : "pending";
  const pendingOthers = members.filter((m) => m.id !== user?.id && responseFor(m.id) === "pending").map((m) => m.full_name);
  const canMarkCompleted = session.proposed_start_time ? new Date(session.proposed_start_time).getTime() < Date.now() : true;
  const allReflected = reflections.length > 0;

  return (
    <Card className={cn("space-y-4 p-5", session.status === "confirmed" && "border-l-4 border-l-success")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-widest",
            session.status === "confirmed" && "bg-success/10 text-success",
            session.status === "proposed" && "bg-primary-soft text-primary",
            session.status === "completed" && "bg-muted text-muted-foreground",
          )}
        >
          {session.status === "confirmed" && <CheckCircle2 className="h-3 w-3" />}
          {t(`status.${session.status}`)}
        </span>
        {session.proposed_start_time && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-primary" />
            {format(new Date(session.proposed_start_time), "EEEE, MMM d 'at' p")}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {members.map((m) => {
          const r = responseFor(m.id);
          return (
            <span
              key={m.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold",
                r === "accepted" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
              )}
            >
              {r === "accepted" && <CheckCircle2 className="h-3 w-3" />}
              {m.id === user?.id ? t("you") : m.full_name}
            </span>
          );
        })}
      </div>

      {session.status === "proposed" && (
        <>
          {!session.proposed_start_time && <p className="text-xs text-muted-foreground">{t("session.noTimeYet")}</p>}
          {pendingOthers.length > 0 && (
            <p className="text-xs text-muted-foreground">{t("session.waitingOnOthers", { names: pendingOthers.join(", ") })}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {myResponse !== "accepted" && session.proposed_start_time && (
              <Button size="sm" onClick={handleAccept} disabled={isPending}>
                {t("session.accept")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setShowAlternative((v) => !v)}>
              <Clock className="mr-1.5 h-3.5 w-3.5" /> {t("session.proposeAlternative")}
            </Button>
          </div>
          {showAlternative && (
            <TriadAlternativeProposal
              sessionId={session.id}
              group={group}
              members={members}
              deadline={entry.round.completion_deadline}
              onDone={() => setShowAlternative(false)}
            />
          )}
        </>
      )}

      {session.status === "confirmed" && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3.5">
          {session.meeting_url && (
            <Button asChild size="sm">
              <a href={session.meeting_url} target="_blank" rel="noopener noreferrer">
                <Video className="mr-1.5 h-4 w-4" /> {t("session.joinMeeting")}
              </a>
            </Button>
          )}
          {canMarkCompleted && (
            <Button size="sm" variant="outline" onClick={handleMarkCompleted} disabled={isPending}>
              {t("session.markCompleted")}
            </Button>
          )}
        </div>
      )}

      {session.status === "completed" && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3.5">
          {reflectionSubmitted ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> {t("session.reflectionSubmitted")}
            </span>
          ) : (
            <Button asChild size="sm">
              <Link to={`/triads/${session.id}/reflect`}>{t("session.submitReflection")}</Link>
            </Button>
          )}
          {allReflected && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/triads/${session.id}/reflect`}>{t("session.viewReflections")}</Link>
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
