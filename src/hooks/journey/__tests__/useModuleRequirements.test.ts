import { describe, expect, it } from "vitest";
import { nextRequirementOf, type CanonicalRequirementRow } from "../useModuleRequirements";

const row = (over: Partial<CanonicalRequirementRow>): CanonicalRequirementRow => ({
  requirement_id: "r1",
  requirement_index: 1,
  due_on: "2026-10-01",
  is_completed: false,
  is_overdue: false,
  booked_on: null,
  ...over,
});

describe("nextRequirementOf (canonical calendar)", () => {
  it("skips requirements the calendar counts as completed, in requirement order", () => {
    const next = nextRequirementOf([
      row({ requirement_id: "r2", requirement_index: 2, due_on: "2026-11-01" }),
      row({ requirement_id: "r1", requirement_index: 1, is_completed: true }),
    ]);
    expect(next).toEqual({ ordinal: 2, dueOn: "2026-11-01", bookedOn: null, overdue: false });
  });

  it("takes overdue from the database, so a requirement due today is not overdue", () => {
    expect(nextRequirementOf([row({ due_on: "2026-09-23", is_overdue: false })])?.overdue).toBe(false);
    expect(nextRequirementOf([row({ due_on: "2026-09-22", is_overdue: true })])?.overdue).toBe(true);
  });

  it("a session held before the window is not completion: the requirement is still next", () => {
    // The calendar reports is_completed = false for it; nothing here looks at session dates.
    const next = nextRequirementOf([row({ is_completed: false, booked_on: "2026-09-30" })]);
    expect(next).toMatchObject({ ordinal: 1, bookedOn: "2026-09-30" });
  });

  it("returns null when every requirement is completed", () => {
    expect(nextRequirementOf([row({ is_completed: true })])).toBeNull();
  });
});
