/**
 * Admin cohort requirement deadlines — presentation helpers only.
 *
 * The cohort answers ONE question per module: by when must it be complete.
 * The N canonical requirement rows are the database's business
 * (sync_cohort_requirement_dates), never something an Admin types in one by
 * one. Nothing here computes a date; it orders, compares and serialises what
 * the backend returned.
 */
export interface CohortModuleDeadline {
  programme_id: string;
  programme_name?: string | null;
  module: string;
  required_units: number;
  scheduled_units: number;
  completion_deadline: string | null;
  /** 'cohort_end' (the system default), 'legacy_schedule', or 'admin'. */
  source?: string | null;
}

export interface CohortDeadlineChange {
  key: string;
  programme_id: string;
  module: string;
  from: string | null;
  to: string | null;
}

/** Display order of scheduled modules (Training / Learning is scheduled by its weeks, not here). */
const MODULE_ORDER = ["coaching", "peer_coaching", "mentoring", "triads"];

export const deadlineKey = (item: Pick<CohortModuleDeadline, "programme_id" | "module">) =>
  `${item.programme_id}:${item.module}`;

function moduleRank(module: string) {
  const idx = MODULE_ORDER.indexOf(module);
  return idx === -1 ? MODULE_ORDER.length : idx;
}

export function sortModuleDeadlines(items: CohortModuleDeadline[]): CohortModuleDeadline[] {
  return [...items].sort(
    (a, b) =>
      (a.programme_name ?? a.programme_id).localeCompare(b.programme_name ?? b.programme_id)
      || moduleRank(a.module) - moduleRank(b.module)
      || a.module.localeCompare(b.module),
  );
}

/** Per-module differences between two sets of deadlines (e.g. saved → edited). */
export function diffModuleDeadlines(
  from: CohortModuleDeadline[],
  to: CohortModuleDeadline[],
): CohortDeadlineChange[] {
  const before = new Map(from.map((i) => [deadlineKey(i), i]));
  const after = new Map(to.map((i) => [deadlineKey(i), i]));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  return keys
    .map((key) => {
      const a = before.get(key);
      const b = after.get(key);
      const ref = (b ?? a) as CohortModuleDeadline;
      return {
        key,
        programme_id: ref.programme_id,
        module: ref.module,
        from: a?.completion_deadline ?? null,
        to: b?.completion_deadline ?? null,
      };
    })
    .filter((c) => c.from !== c.to)
    .sort((a, b) => moduleRank(a.module) - moduleRank(b.module) || a.module.localeCompare(b.module));
}

/** Only the modules whose deadline differs from the baseline. */
export function changedModuleDeadlines(
  baseline: CohortModuleDeadline[],
  current: CohortModuleDeadline[],
) {
  const base = new Map(baseline.map((i) => [deadlineKey(i), i.completion_deadline]));
  return current.filter(
    (i) => i.completion_deadline && base.get(deadlineKey(i)) !== i.completion_deadline,
  );
}

export function toDeadlinePayload(items: CohortModuleDeadline[]) {
  return items.map(({ programme_id, module, completion_deadline }) => ({
    programme_id,
    module,
    completion_deadline,
  }));
}
