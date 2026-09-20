import { useTranslation } from "react-i18next";
import { useModuleWorkspace } from "@/hooks/journey/useModuleWorkspace";
import { partitionSessionsByStage } from "@/lib/moduleSessions";
import { ModuleSessionList } from "@/components/programme/module/ModulePage";

/**
 * The learner's Peer sessions, split by the stage they are actually in:
 * waiting on the partner, booked and still ahead, and everything that has
 * happened.
 *
 * All three lists come from ONE canonical array -- learner_session_history via
 * useModuleWorkspace -- partitioned by the session's own lifecycle status, so
 * a session appears in exactly one of them and none of them can disagree with
 * the session detail they link to. Since the phase 4 cutover that history is
 * built from peer_session_participants, so it covers BOTH halves of a real
 * meeting (received and given) and both Peer relationship tables, scoped to
 * this enrollment rather than to the learner's whole account.
 *
 * The lists are always rendered, each with its own empty state: partner
 * availability (the Practice pool card) is a different fact and must never
 * read as "you have no peer sessions".
 */
export function MyPeerPracticeSection() {
  const { t } = useTranslation("dashboard");
  const { t: tProfile } = useTranslation("profile");
  const ws = useModuleWorkspace("peer");
  if (!ws.enrollmentId && !ws.enrollmentLoading) return null;

  const evidence = ws.sessions.filter((s) => s.isProgrammeEvidence).length;
  const { pending, upcoming, past } = partitionSessionsByStage(ws.sessions);

  const listProps = {
    loading: ws.sessionsLoading,
    error: ws.sessionsError,
    errorText: tProfile("myPeerPractice.historyError"),
  };

  return (
    <section data-testid="peer-history" className="flex flex-col gap-4">
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
        {...listProps}
        testId="peer-pending"
        label={tProfile("myPeerPractice.pending")}
        sessions={pending}
        empty={tProfile("myPeerPractice.noPending")}
      />
      <ModuleSessionList
        {...listProps}
        testId="peer-upcoming"
        label={tProfile("myPeerPractice.upcoming")}
        sessions={upcoming}
        empty={tProfile("myPeerPractice.noUpcoming")}
      />
      <ModuleSessionList
        {...listProps}
        testId="peer-past"
        label={t("learnerModules.peer.sessionsLabel")}
        sessions={past}
        empty={tProfile("myPeerPractice.noHistory")}
      />
    </section>
  );
}
