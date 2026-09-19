import { describe, expect, it } from "vitest";
import { groupPool, repeatedPairsIn } from "../../supabase/functions/triad-auto-assign/grouping";

// Triad 2 auto-assignment for Cohort C: the four Triad 1 groups were
// {a1,a2,a3} {b1,b2,b3} {c1,c2,c3} {d1,d2,d3}.
const TRIAD_1 = [["a1", "a2", "a3"], ["b1", "b2", "b3"], ["c1", "c2", "c3"], ["d1", "d2", "d3"]];
const partnerOf = new Map<string, Set<string>>();
for (const g of TRIAD_1) for (const m of g) partnerOf.set(m, new Set(g.filter((x) => x !== m)));
const wasPartner = (a: string, b: string) => partnerOf.get(a)?.has(b) ?? false;

describe("Triad auto-assignment grouping (one requirement at a time)", () => {
  it("forms Triad 2 groups with no pair repeated from Triad 1 when that is possible", () => {
    const ids = TRIAD_1.flat();
    // Availability would favour re-forming the Triad 1 groups…
    const overlap = (a: string, b: string) => (wasPartner(a, b) ? 10 : 1);
    const result = groupPool(ids, overlap, wasPartner);
    expect(result.triads).toHaveLength(4);
    expect(result.repeatedPairs).toBe(0);
    for (const triad of result.triads) expect(repeatedPairsIn(triad, wasPartner)).toBe(0);
    expect(new Set(result.triads.flat())).toEqual(new Set(ids));
  });

  it("reports the repeated pairs it could not avoid", () => {
    // Only one Triad 1 group is left to place: every pair repeats.
    const result = groupPool(["a1", "a2", "a3"], () => 0, wasPartner);
    expect(result.triads).toEqual([["a1", "a2", "a3"]]);
    expect(result.repeatedPairs).toBe(3);
  });

  it("prefers availability overlap among equally fresh triplets, then leaves a dyad / leftover", () => {
    const overlap = (a: string, b: string) => (["a1", "b1", "c1"].includes(a) && ["a1", "b1", "c1"].includes(b) ? 5 : 0);
    const result = groupPool(["a1", "b1", "c1", "d1", "a2"], overlap, wasPartner);
    expect(result.triads[0].slice().sort()).toEqual(["a1", "b1", "c1"]);
    expect(result.dyad?.slice().sort()).toEqual(["a2", "d1"]);
    expect(result.leftover).toBeNull();
    expect(result.repeatedPairs).toBe(0);
  });
});
