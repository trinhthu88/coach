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

/**
 * One cohort requirement instance (admin_cohort_requirement_schedule): the
 * programme requires N units of a module, the cohort holds N requirement rows,
 * each with its own date. Training rows are the programme's selected weeks.
 */
export interface CohortRequirementDate {
  requirement_id: string;
  programme_id: string;
  programme_name: string | null;
  module: string;
  requirement_index: number;
  requirement_label: string;
  training_week_id: string | null;
  week_number: number | null;
  due_on: string;
  /** The date the row follows when no Admin date is set (module deadline / week pacing). */
  default_due_on: string | null;
  /** true = an Admin date the row keeps until reset. */
  is_overridden: boolean;
  has_activity: boolean;
}

/** An Admin edit: a date keeps that date; null returns the row to its default. */
export type RequirementDateEdit = string | null;

export interface RequirementModuleGroup {
  key: string;
  programme_id: string;
  programme_name: string | null;
  module: string;
  rows: CohortRequirementDate[];
}

/** Display order of requirement groups: Training weeks first, then the session modules. */
const REQUIREMENT_MODULE_ORDER = ["training", ...MODULE_ORDER];

export function groupRequirementDates(rows: CohortRequirementDate[]): RequirementModuleGroup[] {
  const groups = new Map<string, RequirementModuleGroup>();
  for (const row of rows) {
    const key = deadlineKey(row);
    const group = groups.get(key) ?? {
      key,
      programme_id: row.programme_id,
      programme_name: row.programme_name,
      module: row.module,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  const rank = (m: string) => {
    const idx = REQUIREMENT_MODULE_ORDER.indexOf(m);
    return idx === -1 ? REQUIREMENT_MODULE_ORDER.length : idx;
  };
  return [...groups.values()]
    .map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => a.requirement_index - b.requirement_index) }))
    .sort(
      (a, b) =>
        (a.programme_name ?? a.programme_id).localeCompare(b.programme_name ?? b.programme_id)
        || rank(a.module) - rank(b.module)
        || a.module.localeCompare(b.module),
    );
}

/**
 * The date a row shows while being edited: an Admin edit wins; a pending reset
 * shows the default it will return to; otherwise the saved date.
 */
export function displayedRequirementDate(row: CohortRequirementDate, edit: RequirementDateEdit | undefined): string {
  if (edit === undefined) return row.due_on;
  return edit ?? row.default_due_on ?? row.due_on;
}

/** Only real changes, as the admin_set_cohort_requirement_dates payload. */
export function toRequirementDatePayload(
  rows: CohortRequirementDate[],
  edits: Record<string, RequirementDateEdit>,
) {
  const byId = new Map(rows.map((r) => [r.requirement_id, r]));
  return Object.entries(edits)
    .filter(([id, edit]) => {
      const row = byId.get(id);
      if (!row) return false;
      // A reset matters only for a row that holds its own date; a date only
      // when it differs from what the row already shows.
      if (edit === null) return row.is_overridden;
      return edit !== row.due_on;
    })
    .map(([requirement_id, due_on]) => ({ requirement_id, due_on }));
}
