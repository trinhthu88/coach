import { endOfWeek, isAfter, isBefore } from "date-fns";

export interface DueDateBuckets<T> {
  overdue: T[];
  thisWeek: T[];
  upcoming: T[];
}

/**
 * Shared overdue / due-this-week / upcoming split for open (not-yet-done)
 * items with an optional due date. This is the one definition of "due this
 * week" for enrollment-scoped commitments — every surface that buckets
 * actions by due date (dashboard, journey) must use this instead of
 * re-deriving its own date-comparison rule.
 */
export function bucketByDueDate<T>(
  openItems: T[],
  getDueDate: (item: T) => string | null | undefined,
  now: Date = new Date()
): DueDateBuckets<T> {
  const wkEnd = endOfWeek(now, { weekStartsOn: 1 });
  const overdue: T[] = [];
  const thisWeek: T[] = [];
  const upcoming: T[] = [];
  for (const item of openItems) {
    const due = getDueDate(item);
    if (!due) {
      upcoming.push(item);
      continue;
    }
    const dueDate = new Date(due);
    if (isBefore(dueDate, now)) overdue.push(item);
    else if (!isAfter(dueDate, wkEnd)) thisWeek.push(item);
    else upcoming.push(item);
  }
  return { overdue, thisWeek, upcoming };
}
