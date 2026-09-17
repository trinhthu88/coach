import { describe, expect, it } from "vitest";
import { goalProgressPct } from "../useJourneyDerived";

/**
 * goalProgressPct must stay byte-for-byte equivalent to the Sponsor
 * canonical SQL formula used for goal_progress_pct in
 * sponsor_leader_engagement_summary / sponsor_organisation_summary:
 *   least(100, greatest(0, (current - start) * 100 / (target - start)))
 * with NULL (not 0) when unrated or when target <= start. This is the one
 * definition of "goal progress" for every Clariva role — see Part 16 of the
 * learner dashboard source-of-truth mandate.
 */
function sponsorSqlFormula(start: number | null, current: number | null, target: number | null): number | null {
  if (start == null || current == null || target == null || target <= start) return null;
  return Math.min(100, Math.max(0, ((current - start) * 100) / (target - start)));
}

describe("goalProgressPct (learner) matches the Sponsor canonical formula", () => {
  const cases: [number | null, number | null, number | null][] = [
    [39, 56, 85],
    [0, 0, 100],
    [10, 10, 10],
    [50, 90, 100],
    [20, 5, 80], // regression below start
    [20, 200, 80], // overshoot past target
    [null, 50, 100],
    [10, null, 100],
    [10, 50, null],
    [50, 60, 50], // target <= start
  ];

  it.each(cases)("start=%s current=%s target=%s", (start, current, target) => {
    const learnerValue = goalProgressPct(start, current, target);
    const sponsorValue = sponsorSqlFormula(start, current, target);
    if (sponsorValue == null) {
      expect(learnerValue).toBeNull();
    } else {
      expect(learnerValue).toBe(Math.round(sponsorValue));
    }
  });

  it("never coerces an unrated goal to 0% — returns null instead", () => {
    expect(goalProgressPct(null, null, null)).toBeNull();
  });
});
