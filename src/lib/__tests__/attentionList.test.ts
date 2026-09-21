import { describe, expect, it } from "vitest";
import { deriveAttentionList, overdueUnitCount } from "../nextUp";

const overdueModules = [
  { module: "training", overdue_units: 5, oldest_due_on: "2026-08-10" },
  { module: "coaching", overdue_units: 4, oldest_due_on: "2026-07-01" },
  { module: "mentoring", overdue_units: 2, oldest_due_on: "2026-08-01" },
];

describe("deriveAttentionList", () => {
  it("lists every module with overdue units — uncapped, oldest first — and sums to the canonical overdue_units", () => {
    const items = deriveAttentionList({ overdueModules, overdueActions: [], journey: [], nextSessionAt: null });
    expect(items.map((i) => (i.kind === "overdue_module" ? i.module : i.kind))).toEqual(["coaching", "mentoring", "training"]);
    expect(overdueUnitCount(items)).toBe(11);
  });

  it("does not count an overdue journey checkpoint on top of the module units", () => {
    const journey = [
      { checkpoint_number: 1, due_on: "2026-07-01", state: "overdue", label: null, required_units: 4, completed_units: 0, module_scope: ["coaching"] },
    ] as never;
    const items = deriveAttentionList({ overdueModules, overdueActions: [], journey, nextSessionAt: null });
    expect(overdueUnitCount(items)).toBe(11);
    expect(items).toHaveLength(3);
  });

  it("keeps overdue actions, the next session and the upcoming checkpoint as separate, non-unit items", () => {
    const items = deriveAttentionList({
      overdueModules: [],
      overdueActions: [{ id: "a", title: "Send recap", description: null, status: "open", due_date: "2026-08-01", goal_id: null, milestone_id: null, completed_at: null }],
      journey: [{ checkpoint_number: 2, due_on: "2026-10-01", state: "upcoming", label: null, required_units: 1, completed_units: 0, module_scope: [] }] as never,
      nextSessionAt: "2026-09-30T09:00:00Z",
    });
    expect(items.map((i) => i.kind)).toEqual(["overdue_action", "upcoming_session", "upcoming_requirement"]);
    expect(overdueUnitCount(items)).toBe(0);
  });
});
