// Pure grouping logic for Triad auto-assignment (no Deno / network APIs, so
// it is unit-tested from src/test).
//
// One requirement ("Triad N") at a time. Among the candidates of one
// language pool, repeatedly take the triplet that
//   1. repeats the fewest prior co-member pairs (learners grouped together
//      for another Triad of the same cohort), then
//   2. places the most constrained learners first (those with the most prior
//      partners still waiting — left to the end they could only be grouped
//      with each other), then
//   3. shares the most free availability hours,
// then handle the 0/1/2 remainder. The number of repeated pairs that could
// not be avoided is reported back to Admin.

export type PairScore = (a: string, b: string) => number;
export type PriorPartners = (a: string, b: string) => boolean;

export interface GroupingResult {
  triads: string[][];
  dyad: string[] | null;
  leftover: string | null;
  repeatedPairs: number;
}

function pairsOf(ids: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  return out;
}

export function repeatedPairsIn(ids: string[], wasPartner: PriorPartners): number {
  return pairsOf(ids).filter(([a, b]) => wasPartner(a, b)).length;
}

export function groupPool(ids: string[], overlapOf: PairScore, wasPartner: PriorPartners): GroupingResult {
  const remaining = new Set(ids);
  const triads: string[][] = [];
  let repeatedPairs = 0;

  while (remaining.size >= 3) {
    let best: string[] | null = null;
    let bestRepeats = Number.POSITIVE_INFINITY;
    let bestConstraint = -1;
    let bestOverlap = -1;
    const arr = [...remaining];
    const constraint = new Map(arr.map((a) => [a, arr.filter((b) => b !== a && wasPartner(a, b)).length]));
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        for (let k = j + 1; k < arr.length; k++) {
          const triplet = [arr[i], arr[j], arr[k]];
          const repeats = repeatedPairsIn(triplet, wasPartner);
          const constrained = triplet.reduce((sum, id) => sum + (constraint.get(id) ?? 0), 0);
          const overlap = overlapOf(arr[i], arr[j]) + overlapOf(arr[i], arr[k]) + overlapOf(arr[j], arr[k]);
          const better =
            repeats < bestRepeats ||
            (repeats === bestRepeats && (constrained > bestConstraint || (constrained === bestConstraint && overlap > bestOverlap)));
          if (better) {
            best = triplet;
            bestRepeats = repeats;
            bestConstraint = constrained;
            bestOverlap = overlap;
          }
        }
      }
    }
    if (!best) break;
    triads.push(best);
    repeatedPairs += bestRepeats;
    for (const id of best) remaining.delete(id);
  }

  const rest = [...remaining];
  const dyad = rest.length === 2 ? rest : null;
  if (dyad) repeatedPairs += repeatedPairsIn(dyad, wasPartner);
  return { triads, dyad, leftover: rest.length === 1 ? rest[0] : null, repeatedPairs };
}
