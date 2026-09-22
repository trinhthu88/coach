/**
 * Learner Sessions hub scoping. The hub lists operational sessions across
 * modules; for a learner the CURRENT view is exactly the sessions attributable
 * to the ACTIVE enrollment:
 *
 *   viewer_enrollment_id = active enrollment id
 *
 * where viewer_enrollment_id is the learner's OWN enrollment for the session
 * (for a shared peer session: their own peer_session_participants row --
 * never the session row's or the partner's enrollment). Everything else --
 * sessions of the learner's earlier enrollments, and legacy rows with no
 * attribution -- appears only when past programmes are requested. Nothing
 * here counts completion: programme progress is always the canonical engine's.
 */
export function scopeLearnerSessions<T extends { viewer_enrollment_id: string | null }>(
  rows: T[],
  activeEnrollmentId: string | null,
  includePast: boolean,
): { rows: T[]; hiddenPast: number } {
  const isCurrent = (r: T) => !!activeEnrollmentId && r.viewer_enrollment_id === activeEnrollmentId;
  const hiddenPast = rows.filter((r) => !isCurrent(r)).length;
  return includePast ? { rows, hiddenPast: 0 } : { rows: rows.filter(isCurrent), hiddenPast };
}
