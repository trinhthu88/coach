export type EnrollmentCandidate = {
  id: string;
  status: string | null | undefined;
  start_date: string | null | undefined;
};

const CURRENT_STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  at_risk: 1,
  // At-risk and paused are both ongoing; once no active row exists, the
  // latest dated ongoing enrollment is the deterministic choice.
  paused: 1,
};

export function resolveCurrentEnrollment(rows: EnrollmentCandidate[]): string | null {
  return (
    rows
      .filter((row) => row.id && row.status && CURRENT_STATUS_PRIORITY[row.status] !== undefined)
      .sort((a, b) => {
        const priority = CURRENT_STATUS_PRIORITY[a.status!] - CURRENT_STATUS_PRIORITY[b.status!];
        if (priority !== 0) return priority;
        const date = (b.start_date || "").localeCompare(a.start_date || "");
        return date !== 0 ? date : a.id.localeCompare(b.id);
      })[0]?.id ?? null
  );
}