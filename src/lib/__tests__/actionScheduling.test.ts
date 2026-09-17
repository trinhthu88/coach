import { describe, expect, it } from "vitest";
import { bucketByDueDate } from "../actionScheduling";

interface Item {
  id: string;
  due: string | null;
}

describe("bucketByDueDate", () => {
  const now = new Date("2026-06-10T12:00:00Z"); // a Wednesday

  it("buckets a past due date as overdue", () => {
    const items: Item[] = [{ id: "a", due: "2026-06-01" }];
    const { overdue, thisWeek, upcoming } = bucketByDueDate(items, (i) => i.due, now);
    expect(overdue.map((i) => i.id)).toEqual(["a"]);
    expect(thisWeek).toEqual([]);
    expect(upcoming).toEqual([]);
  });

  it("buckets a date within the current ISO week (Mon-Sun) as this week", () => {
    const items: Item[] = [{ id: "b", due: "2026-06-14" }]; // Sunday of the same week
    const { thisWeek } = bucketByDueDate(items, (i) => i.due, now);
    expect(thisWeek.map((i) => i.id)).toEqual(["b"]);
  });

  it("buckets a date after the current week as upcoming", () => {
    const items: Item[] = [{ id: "c", due: "2026-06-21" }];
    const { upcoming } = bucketByDueDate(items, (i) => i.due, now);
    expect(upcoming.map((i) => i.id)).toEqual(["c"]);
  });

  it("treats a null due date as upcoming, never overdue", () => {
    const items: Item[] = [{ id: "d", due: null }];
    const { overdue, thisWeek, upcoming } = bucketByDueDate(items, (i) => i.due, now);
    expect(overdue).toEqual([]);
    expect(thisWeek).toEqual([]);
    expect(upcoming.map((i) => i.id)).toEqual(["d"]);
  });
});
