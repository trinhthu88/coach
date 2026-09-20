/**
 * Admin cohort requirement schedule — presentation helpers only.
 *
 * The dates themselves are produced by the database: proposals by
 * cohort_requirement_schedule_proposal (the programme's default scheduling
 * policy), saved dates in cohort_requirement_dates. Nothing here generates a
 * date; it groups, compares and serialises what the backend returned.
 */
export interface CohortRequirementItem {
  programme_id: string;
  module: string;
  ordinal: number;
  due_on: string;
  units: number;
  generation_method: string;
  /** Saved rows only: the policy date recorded when the row was materialized. */
  generated_due_on?: string | null;
  is_overridden?: boolean;
}

export interface CohortRequirementGroup {
  key: string;
  programme_id: string;
  module: string;
  items: CohortRequirementItem[];
  requiredUnits: number;
}

export interface CohortScheduleChange {
  key: string;
  programme_id: string;
  module: string;
  ordinal: number;
  from: string | null;
  to: string | null;
}

/** Display order of scheduled modules (Training / Learning is scheduled by its weeks, not here). */
const MODULE_ORDER = ["coaching", "peer_coaching", "mentoring", "triads"];

export const itemKey = (item: Pick<CohortRequirementItem, "programme_id" | "module" | "ordinal">) =>
  `${item.programme_id}:${item.module}:${item.ordinal}`;

function moduleRank(module: string) {
  const idx = MODULE_ORDER.indexOf(module);
  return idx === -1 ? MODULE_ORDER.length : idx;
}

export function groupRequirementItems(items: CohortRequirementItem[]): CohortRequirementGroup[] {
  const groups = new Map<string, CohortRequirementGroup>();
  for (const item of items) {
    const key = `${item.programme_id}:${item.module}`;
    const group = groups.get(key) ?? { key, programme_id: item.programme_id, module: item.module, items: [], requiredUnits: 0 };
    group.items.push(item);
    group.requiredUnits += item.units;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => a.ordinal - b.ordinal) }))
    .sort((a, b) => a.programme_id.localeCompare(b.programme_id) || moduleRank(a.module) - moduleRank(b.module) || a.module.localeCompare(b.module));
}

/** Per-unit differences between two schedules (e.g. saved → regenerated). */
export function diffRequirementSchedules(from: CohortRequirementItem[], to: CohortRequirementItem[]): CohortScheduleChange[] {
  const before = new Map(from.map((i) => [itemKey(i), i]));
  const after = new Map(to.map((i) => [itemKey(i), i]));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  return keys
    .map((key) => {
      const a = before.get(key);
      const b = after.get(key);
      const ref = (b ?? a) as CohortRequirementItem;
      return { key, programme_id: ref.programme_id, module: ref.module, ordinal: ref.ordinal, from: a?.due_on ?? null, to: b?.due_on ?? null };
    })
    .filter((c) => c.from !== c.to)
    .sort((a, b) => moduleRank(a.module) - moduleRank(b.module) || a.ordinal - b.ordinal);
}

/** Only the units whose date differs from the baseline — an Admin edit touches exactly those. */
export function changedRequirementItems(baseline: CohortRequirementItem[], current: CohortRequirementItem[]) {
  const base = new Map(baseline.map((i) => [itemKey(i), i.due_on]));
  return current.filter((i) => base.get(itemKey(i)) !== i.due_on);
}

export function toSavePayload(items: CohortRequirementItem[]) {
  return items.map(({ programme_id, module, ordinal, due_on }) => ({ programme_id, module, ordinal, due_on }));
}
