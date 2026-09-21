import { describe, expect, it } from "vitest";
import { aggregateSatisfaction } from "../satisfaction";

describe("aggregateSatisfaction", () => {
  it("weights every module's ratings into one 1–5 average and distribution", () => {
    const summary = aggregateSatisfaction([
      { rated_count: 2, rating_sum: 9, rating_counts: [0, 0, 0, 1, 1] }, // coaching: 4, 5
      { rated_count: 1, rating_sum: 3, rating_counts: [0, 0, 1, 0, 0] }, // mentoring: 3
      { rated_count: 1, rating_sum: 5, rating_counts: [0, 0, 0, 0, 1] }, // triads: 5
    ]);
    expect(summary.ratedCount).toBe(4);
    expect(summary.average).toBeCloseTo(17 / 4);
    expect(summary.distribution).toEqual([0, 0, 1, 1, 2]);
  });

  it("reports no average, not 0, when nothing is rated", () => {
    expect(aggregateSatisfaction([])).toEqual({ ratedCount: 0, average: null, distribution: [0, 0, 0, 0, 0] });
  });
});
