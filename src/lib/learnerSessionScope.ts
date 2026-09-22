/**
 * Learner Sessions hub scoping. The hub lists operational sessions across
 * modules; for a learner it shows the ACTIVE enrollment's sessions. Rows
 * attributed to one of the learner's own earlier (historical) enrollments are
 * left out unless the learner asks to include past programmes. A row
 * attributed to someone else's enrollment (e.g. a peer session the learner
 * provided) is not the learner's history and is kept. Nothing here counts
 * completion: programme progress is always the canonical engine's.
 */
export function scopeLearnerSessions<T extends { enrollment_id: string | null }>(
  rows: T[],
  activeEnrollmentId: string | null,
  ownEnrollmentIds: string[],
  includePast: boolean,
): { rows: T[]; hiddenPast: number } {
  const past = new Set(ownEnrollmentIds.filter((id) => id !== activeEnrollmentId));
  const isPast = (r: T) => !!r.enrollment_id && past.has(r.enrollment_id);
  const hiddenPast = rows.filter(isPast).length;
  return includePast ? { rows, hiddenPast: 0 } : { rows: rows.filter((r) => !isPast(r)), hiddenPast };
}
