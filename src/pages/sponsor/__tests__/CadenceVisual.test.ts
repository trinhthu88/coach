import { describe, it, expect } from "vitest";
import { itemState } from "../CadenceVisual";
import type { SponsorLeaderCadenceItem } from "@/hooks/sponsor/useSponsorLeaderDetail";

const item = (overrides: Partial<SponsorLeaderCadenceItem>): SponsorLeaderCadenceItem => ({
  module: "quiz",
  sequence: 1,
  due_on: "2026-09-10",
  window_end_on: null,
  completed: false,
  ...overrides,
});

const today = "2026-09-13";

// Programme Journey item-state rules — spec section 7.
describe("itemState", () => {
  it("is completed when the required item was successfully completed, even if its due date already passed", () => {
    expect(itemState(item({ due_on: "2026-09-01", completed: true }), today)).toBe("completed");
  });

  it("is overdue when the deadline has passed and it remains incomplete", () => {
    expect(itemState(item({ due_on: "2026-09-10", completed: false }), today)).toBe("overdue");
  });

  it("is upcoming when the due date is still in the future — never a percentage, never 0%", () => {
    expect(itemState(item({ due_on: "2026-09-20", completed: false }), today)).toBe("upcoming");
  });

  it("is current when today falls inside the item's due window and it is not yet complete", () => {
    expect(itemState(item({ due_on: today, window_end_on: null, completed: false }), today)).toBe("current");
  });

  it("stays current through an explicit grace window before flipping to overdue", () => {
    expect(itemState(item({ due_on: "2026-09-11", window_end_on: "2026-09-14", completed: false }), today)).toBe("current");
    expect(itemState(item({ due_on: "2026-09-11", window_end_on: "2026-09-12", completed: false }), today)).toBe("overdue");
  });
});
