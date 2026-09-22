import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useActiveEnrollment } from "@/hooks/useActiveEnrollment";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { useEnrollmentSessions } from "@/hooks/journey/useEnrollmentSessions";
import { useModuleRequirements } from "@/hooks/journey/useModuleRequirements";
import { useLearnerSessionDeliverables } from "@/hooks/sessions/usePostSessionDeliverables";
import { programmeModuleRows, type ProgrammeModuleKey } from "@/lib/programmeProfile";
import { derivePendingDeliverables } from "@/lib/pendingReflections";
import { deliverableKey, outstandingItems, type DeliverableKey, type DeliverableModule } from "@/lib/postSessionDeliverables";
import type { DevelopmentSessionType } from "./developmentSessionTypes";

type WorkspaceModule = Exclude<ProgrammeModuleKey, "training">;

const SESSION_TYPE_BY_MODULE: Record<WorkspaceModule, DevelopmentSessionType> = {
  coaching: "coaching",
  peer: "peer_coaching",
  mentoring: "mentoring",
  triads: "triad",
};

const PROGRAMME_MODULE: Record<WorkspaceModule, DeliverableModule> = {
  coaching: "coaching",
  peer: "peer_coaching",
  mentoring: "mentoring",
  triads: "triads",
};

/**
 * Everything a "My development" module page needs, from canonical sources
 * only — one structure for Coaching, Peer, Mentoring and Triads:
 *  - module ratio: the learner_canonical_progress row via programmeModuleRows
 *    (the same mapping Dashboard / Sponsor Leader Detail use);
 *  - due / overdue and the next requirement with its deadline:
 *    learner_module_progress + learner_module_requirements;
 *  - sessions: learner_session_history filtered to this module's type;
 *  - post-session evidence: learner_session_deliverables filtered to this
 *    module (the one definition of "outstanding").
 * It composes those hooks; it never counts sessions into progress.
 */
export function useModuleWorkspace(module: WorkspaceModule) {
  const { user } = useAuth();
  // The ONE learner enrollment context every learner page reads.
  const active = useActiveEnrollment();
  const enrollmentId = active.enrollmentId ?? undefined;
  const enrollmentLoading = active.loading;
  const canonical = useLearnerCanonicalProgress(enrollmentId);
  const history = useEnrollmentSessions(enrollmentId, user?.id);
  const requirements = useModuleRequirements(enrollmentId, PROGRAMME_MODULE[module]);
  const evidence = useLearnerSessionDeliverables(enrollmentId);

  const moduleRow = useMemo(
    () => (canonical.progress ? programmeModuleRows(canonical.progress).find((row) => row.key === module) ?? null : null),
    [canonical.progress, module]
  );
  const sessions = useMemo(
    () => history.sessions.filter((s) => s.type === SESSION_TYPE_BY_MODULE[module]),
    [history.sessions, module]
  );
  const deliverables = useMemo(
    () => evidence.deliverables.filter((d) => d.module === PROGRAMME_MODULE[module]),
    [evidence.deliverables, module]
  );
  const pendingDeliverables = useMemo(() => derivePendingDeliverables(deliverables), [deliverables]);
  const outstandingBySession = useMemo(() => {
    const map = new Map<string, DeliverableKey[]>();
    for (const d of deliverables) {
      const missing = outstandingItems(d);
      if (missing.length > 0) map.set(deliverableKey(d.sourceTable, d.sessionId), missing);
    }
    return map;
  }, [deliverables]);

  return {
    userId: user?.id,
    enrollmentId,
    enrollmentLoading,
    /** Enrollment resolution failure (surfaced, never shown as an empty module). */
    enrollmentError: active.error,
    progress: canonical.progress,
    progressLoading: enrollmentLoading || canonical.loading,
    progressError: canonical.error,
    completed: moduleRow?.completed ?? null,
    required: moduleRow?.required ?? null,
    requirementState: requirements.state,
    requirementsLoading: enrollmentLoading || requirements.loading,
    requirementsError: requirements.error,
    sessions,
    sessionsLoading: enrollmentLoading || history.loading,
    sessionsError: history.error,
    deliverables,
    pendingDeliverables,
    /** Missing items per past session, keyed by deliverableKey(sourceTable, sessionId). */
    outstandingBySession,
    deliverablesLoading: enrollmentLoading || evidence.loading,
    deliverablesError: evidence.error,
  };
}
