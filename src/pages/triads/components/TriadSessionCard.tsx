import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Clock, Video } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useTriadSession } from "@/hooks/triads/useTriadSession";
import type { TriadRoundEntry } from "@/hooks/triads/useMyTriads";
import { TriadAlternativeProposal } from "./TriadAlternativeProposal";

const RESPONSE_BY_SLOT = ["member_1_response", "member_2_response", "member_3_response"] as const;
const ID_BY_SLOT = ["member_1_id", "member_2_id", "member_3_id"] as const;

/** "Next Triad session" card — navy, per the approved prototype's Triads workspace ("Next Triad session" is navy, "My Triad group" is white — the reverse of TriadGroupHero). The no-session empty state stays a plain light card, matching every other empty state in the app. */
export function TriadSessionCard({ entry }: { entry: TriadRoundEntry }) {
  const { t } = useTranslation("triads");
  const { user } = useAuth();
  const { acceptSession, markCompleted, isPending } = useTriadSession();
  const { session, group, members } = entry;
  const [showAlternative, setShowAlternative] = useState(false);

  if (!session) {
    return (
      <div className="rounded-[22px] border border-[#e8e2d8] bg-card p-6 text-center text-sm text-muted-foreground sm:p-7">
        {t("session.noSessionYet")}
      </div>
    );
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

  return (
    <div className="rounded-[18px] bg-secondary p-6 text-secondary-foreground shadow-[0_18px_55px_-30px_rgba(6,47,62,0.6)] sm:p-7">
      <p className="text-[9.5px] font-bold uppercase tracking-[.22em] text-primary-glow">
        {session.status === "confirmed" ? t("session.upcomingLabel") : t("session.needsSchedulingLabel")}
      </p>

      {session.proposed_start_time ? (
        <h3 className="font-display mt-2 text-[22px] font-normal leading-[1.15] tracking-[-0.02em] sm:text-[26px]">
          {format(new Date(session.proposed_start_time), "EEEE, MMM d 'at' p")}
        </h3>
      ) : (
        <p className="mt-2 text-sm text-white/65">{t("session.noTimeYet")}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {members.map((m) => {
          const r = responseFor(m.id);
          return (
            <span
              key={m.id}
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1.5 text-[10.5px] font-semibold",
                r === "accepted" ? "bg-primary text-secondary" : "bg-white/10 text-white"
              )}
            >
              {m.id === user?.id ? t("you") : m.full_name}
            </span>
          );
        })}
      </div>

      {session.status === "proposed" && (
        <>
          {pendingOthers.length > 0 && (
            <p className="mt-3 text-xs text-white/65">{t("session.waitingOnOthers", { names: pendingOthers.join(", ") })}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2.5">
            {myResponse !== "accepted" && session.proposed_start_time && (
              <button
                type="button"
                onClick={handleAccept}
                disabled={isPending}
                className="rounded-[13px] bg-primary px-5 py-2.5 text-[12.5px] font-semibold text-secondary shadow-[0_12px_28px_-12px_rgba(61,180,208,.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
              >
                {t("session.accept")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAlternative((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 bg-white/5 px-[18px] py-[11px] text-xs font-semibold text-white transition-colors hover:bg-white/10"
            >
              <Clock className="h-3.5 w-3.5" /> {t("session.proposeAlternative")}
            </button>
          </div>
          {/* Alternative slots are searched inside the round's completion window; a legacy group without a round has none. */}
          {showAlternative && entry.round && (
            <div className="mt-4 rounded-xl bg-white p-4 text-foreground">
              <TriadAlternativeProposal
                sessionId={session.id}
                group={group}
                members={members}
                deadline={entry.round.completion_deadline}
                onDone={() => setShowAlternative(false)}
              />
            </div>
          )}
        </>
      )}

      {session.status === "confirmed" && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-white/10 pt-4">
          {session.meeting_url && (
            <a
              href={session.meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-[22px] py-3 text-[12.5px] font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              <Video className="h-3.5 w-3.5" /> {t("session.joinMeeting")}
            </a>
          )}
          {canMarkCompleted && (
            <button
              type="button"
              onClick={handleMarkCompleted}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 bg-white/5 px-[18px] py-[11px] text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              {t("session.markCompleted")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
