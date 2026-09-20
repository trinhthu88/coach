import { useTranslation } from "react-i18next";
import { useModuleWorkspace } from "@/hooks/journey/useModuleWorkspace";
import { orderSessionsForDisplay } from "@/lib/moduleSessions";
import { ModuleSessionList } from "@/components/programme/module/ModulePage";

/**
 * Peer coaching HISTORY (Coachee prototype → Peer coaching → "Peer sessions"):
 * every peer-practice record in the enrollment — received and given — from
 * canonical learner_session_history (coachee_peer_sessions), with its real
 * status and whether it counts as programme evidence. Always rendered with
 * its own empty state: partner availability (the Practice pool card) is a
 * different fact and must never read as "you have no peer sessions".
 */
export function MyPeerPracticeSection() {
  const { t } = useTranslation("dashboard");
  const { t: tProfile } = useTranslation("profile");
  const ws = useModuleWorkspace("peer");
  if (!ws.enrollmentId && !ws.enrollmentLoading) return null;

  const evidence = ws.sessions.filter((s) => s.isProgrammeEvidence).length;

  return (
    <section data-testid="peer-history" className="flex flex-col gap-2.5">
      {!ws.sessionsLoading && !ws.sessionsError && (
        <p data-testid="peer-history-summary" className="text-[11px] text-[#7d7468]">
          {tProfile("myPeerPractice.historySummary", {
            count: ws.sessions.length,
            evidence,
            completed: ws.completed ?? "—",
            required: ws.required ?? "—",
          })}
        </p>
      )}
      <ModuleSessionList
        label={t("learnerModules.peer.sessionsLabel")}
        sessions={orderSessionsForDisplay(ws.sessions)}
        loading={ws.sessionsLoading}
        error={ws.sessionsError}
        empty={tProfile("myPeerPractice.noHistory")}
        errorText={tProfile("myPeerPractice.historyError")}
      />
    </section>
  );
}
