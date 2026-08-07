import { useCallback } from "react";
import { useSessionCore } from "./useSessionCore";
import { useSessionPrivateNotes } from "./useSessionPrivateNotes";
import { useSessionAttachments } from "./useSessionAttachments";
import { useSessionPeerFeedback } from "./useSessionPeerFeedback";

export * from "./types";
export { useSessionCore } from "./useSessionCore";
export { useSessionPrivateNotes } from "./useSessionPrivateNotes";
export { useSessionAttachments } from "./useSessionAttachments";
export { useSessionPeerFeedback } from "./useSessionPeerFeedback";

interface UseSessionDetailOptions {
  sessionId: string | undefined;
  isPeer: boolean;
  userId: string | undefined;
}

/**
 * Aggregates all the session-detail sub-hooks (core session data, coach
 * private notes, attachments, peer competency feedback) into a single
 * convenience hook for the SessionDetail page.
 */
export function useSessionDetail({ sessionId, isPeer, userId }: UseSessionDetailOptions) {
  const core = useSessionCore({ sessionId, isPeer });
  const privateNotes = useSessionPrivateNotes({
    sessionId,
    isPeer,
    coachId: core.session?.coach_id,
  });
  const attachments = useSessionAttachments({ sessionId, isPeer, userId });
  const peerFeedback = useSessionPeerFeedback({
    sessionId,
    isPeer,
    peerCoachId: core.session?.coach_id,
    peerCoacheeId: core.session?.coachee_id,
  });

  const reloadAll = useCallback(async () => {
    await Promise.all([core.reload(), privateNotes.reload(), attachments.reload(), peerFeedback.reload()]);
  }, [core, privateNotes, attachments, peerFeedback]);

  return { core, privateNotes, attachments, peerFeedback, reloadAll };
}
