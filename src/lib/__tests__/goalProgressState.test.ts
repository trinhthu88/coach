import { describe, expect, it } from "vitest";
import { canonicalCompletionPct, goalProgressState } from "../programmeProfile";

describe("goalProgressState", () => {
  it("separates 'no goal set' and 'not rated' from an unknown value", () => {
    expect(goalProgressState({ goal_count: null, goal_progress_pct: null })).toEqual({ kind: "unknown" });
    expect(goalProgressState({ goal_count: 0, goal_progress_pct: null })).toEqual({ kind: "no_goal" });
    expect(goalProgressState({ goal_count: 2, goal_progress_pct: null })).toEqual({ kind: "not_rated" });
    expect(goalProgressState({ goal_count: 1, goal_progress_pct: 0 })).toEqual({ kind: "value", pct: 0 });
  });
});

describe("canonicalCompletionPct", () => {
  it("is the one rounding of canonical full_completion_pct every surface shows", () => {
    expect(canonicalCompletionPct(null)).toBeNull();
    expect(canonicalCompletionPct(41.6)).toBe(42);
    expect(canonicalCompletionPct(120)).toBe(100);
    expect(canonicalCompletionPct(-3)).toBe(0);
  });
});
