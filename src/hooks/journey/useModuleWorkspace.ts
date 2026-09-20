import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useEnrollmentContext } from "@/hooks/useEnrollmentContext";
import { useLearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import { useEnrollmentSessions } from "@/hooks/journey/useEnrollmentSessions";
import { programmeModuleRows, type ProgrammeModuleKey } from "@/lib/programmeProfile";
import type { DevelopmentSessionType } from "./developmentSessionTypes";

const SESSION_TYPE_BY_MODULE: Record<Exclude<ProgrammeModuleKey, "training">, DevelopmentSessionType> = {
  coaching: "coaching",
  peer: "peer_coaching",
  mentoring: "mentoring",
  triads: "triad",
};

/**
 * Everything a "My development" module page needs, from canonical sources
 * only:
 *  - module ratio: the learner_canonical_progress row via programmeModuleRows
 *    (the same mapping Dashboard / Sponsor Leader Detail use);
 *  - sessions: learner_session_history filtered to this module's type.
 * It composes those hooks; it never counts sessions into progress.
 */
export function useModuleWorkspace(module: Exclude<ProgrammeModuleKey, "training">) {
  const { user } = useAuth();
  const { selectedEnrollment, loading: enrollmentLoading } = useEnrollmentContext(user?.id);
  const enrollmentId = selectedEnrollment?.id;
  const canonical = useLearnerCanonicalProgress(enrollmentId);
  const history = useEnrollmentSessions(enrollmentId, user?.id);

  const moduleRow = useMemo(
    () => (canonical.progress ? programmeModuleRows(canonical.progress).find((row) => row.key === module) ?? null : null),
    [canonical.progress, module]
  );
  const sessions = useMemo(
    () => history.sessions.filter((s) => s.type === SESSION_TYPE_BY_MODULE[module]),
    [history.sessions, module]
  );

  return {
    userId: user?.id,
    enrollmentId,
    enrollmentLoading,
    progress: canonical.progress,
    progressLoading: enrollmentLoading || canonical.loading,
    progressError: canonical.error,
    completed: moduleRow?.completed ?? null,
    required: moduleRow?.required ?? null,
    sessions,
    sessionsLoading: enrollmentLoading || history.loading,
    sessionsError: history.error,
  };
}
