import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Clock, Video } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { useTriadSession } from "@/hooks/triads/useTriadSession";
import { pendingMembers, type TriadGroupEntry } from "@/hooks/triads/useMyTriads";
import { TriadAlternativeProposal } from "./TriadAlternativeProposal";

/** "Next Triad session" card — navy, per the approved prototype's Triads workspace ("Next Triad session" is navy, "My Triad group" is white — the reverse of TriadGroupHero). The no-session empty state stays a plain light card, matching every other empty state in the app. */
export function TriadSessionCard({ entry, untilDate = null }: { entry: TriadGroupEntry; untilDate?: string | null }) {
  const { t } = useTranslation("triads");
  const { acceptSession, markCompleted, isPending } = useTriadSession();
  const { session, members } = entry;
  const [showAlternative, setShowAlternative] = useState(false);

  if (!session) {
    return (
      <div className="rounded-[22px] border border-[#e8e2d8] bg-card p-6 text-center text-sm text-muted-foreground sm:p-7">
        {t("session.noSessionYet")}
      </div>
    );
  }

  const responseBySlot = new Map(session.responses.map((r) => [r.slot, r.response]));

  const handleAccept = async () => {
    try {
      await acceptSession(session.id);
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

  const pendingOthers = pendingMembers(entry, session.responses).map((m) => m.full_name);

  return (
    <div className="rounded-[18px] bg-secondary p-6 text-secondary-foreground shadow-[0_18px_55px_-30px_rgba(6,47,62,0.6)] sm:p-7">
      <p className="text-[9.5px] font-bold uppercase tracking-[.22em] text-primary-glow">
        {session.status === "confirmed" ? t("session.upcomingLabel") : t("session.needsSchedulingLabel")}
        {" · "}
        {t("sessionLabel", { n: entry.unitNumber })}
      </p>

      {session.scheduledStartTime ? (
        <h3 className="font-display mt-2 text-[22px] font-normal leading-[1.15] tracking-[-0.02em] sm:text-[26px]">
          {format(new Date(session.scheduledStartTime), "EEEE, MMM d 'at' p")}
        </h3>
      ) : (
        <p className="mt-2 text-sm text-white/65">{t("session.noTimeYet")}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {members.map((m) => (
          <span
            key={m.id}
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1.5 text-[10.5px] font-semibold",
              responseBySlot.get(m.slot) === "accepted" ? "bg-primary text-secondary" : "bg-white/10 text-white"
            )}
          >
            {m.isSelf ? t("you") : m.full_name}
          </span>
        ))}
      </div>

      {(session.status === "proposed" || session.status === "confirmed") && (
        <>
          {session.status === "proposed" && pendingOthers.length > 0 && (
            <p className="mt-3 text-xs text-white/65">{t("session.waitingOnOthers", { names: pendingOthers.join(", ") })}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2.5">
            {session.status === "proposed" && session.myResponse !== "accepted" && session.scheduledStartTime && (
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
          {showAlternative && (
            <div className="mt-4 rounded-xl bg-white p-4 text-foreground">
              <TriadAlternativeProposal entry={entry} untilDate={untilDate} onDone={() => setShowAlternative(false)} />
            </div>
          )}
          {!showAlternative && session.pendingAlternatives.length > 0 && (
            <div className="mt-4 rounded-xl bg-white p-4 text-foreground">
              <TriadAlternativeProposal entry={entry} onDone={() => setShowAlternative(false)} listOnly />
            </div>
          )}
        </>
      )}

      {session.status === "confirmed" && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-white/10 pt-4">
          {session.meetingUrl && (
            <a
              href={session.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-[22px] py-3 text-[12.5px] font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              <Video className="h-3.5 w-3.5" /> {t("session.joinMeeting")}
            </a>
          )}
          {/* The server decides whether completion is allowed (confirmed, time started, member). */}
          {session.canComplete && (
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
