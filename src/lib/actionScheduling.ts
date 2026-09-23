import { addDays, endOfWeek, format, isAfter } from "date-fns";

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
    if (isActionOverdue(due, now)) overdue.push(item);
    else if (!isAfter(dueDate, wkEnd)) thisWeek.push(item);
    else upcoming.push(item);
  }
  return { overdue, thisWeek, upcoming };
}

/** Calendar day (yyyy-MM-dd) of a due date, whether stored as a date or a timestamp. */
function dueDay(due: string): string {
  return due.slice(0, 10);
}

/**
 * An open action is overdue once its due DAY has passed: an action due today
 * is not overdue yet, whatever the time of day or time zone.
 */
export function isActionOverdue(due: string | null | undefined, now: Date = new Date()): boolean {
  return !!due && dueDay(due) < format(now, "yyyy-MM-dd");
}

/** Days before the due date at which an open action turns "due soon". */
export const ACTION_DUE_SOON_DAYS = 7;

export type ActionDueStatus = "done" | "overdue" | "dueSoon" | "onTrack";

/**
 * The colour state of one follow-up action: green = on track, orange = due
 * within ACTION_DUE_SOON_DAYS, red = overdue. An action without a due date has
 * no state (null).
 */
export function actionDueStatus(
  due: string | null | undefined,
  done: boolean | null | undefined,
  now: Date = new Date(),
): ActionDueStatus | null {
  if (done) return "done";
  if (!due) return null;
  if (isActionOverdue(due, now)) return "overdue";
  return dueDay(due) <= format(addDays(now, ACTION_DUE_SOON_DAYS), "yyyy-MM-dd") ? "dueSoon" : "onTrack";
}
