import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Prompt 14 (leftovers), the parts outside SQL:
 * supabase/tests/leftovers_test.sql covers the database.
 */
const SRC = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.endsWith("integrations/supabase/types.ts") ? [path] : [];
  });
}

describe("the retired allowlists", () => {
  it("no app code reads or writes coach_as_coachee_allowlist or coachee_coach_allowlist", () => {
    const offenders = sourceFiles()
      .filter((f) => /from\(\s*["'`](coach_as_coachee_allowlist|coachee_coach_allowlist)["'`]\s*\)/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the Admin coach editor sends no allowlist", () => {
    expect(read("src/pages/admin/AdminCoaches.tsx")).not.toMatch(/p_selectable_coach_ids/);
  });

  it("Find a Coach lists the cohort Coach pool", () => {
    const page = read("src/pages/CoachFindCoach.tsx");
    expect(page).toMatch(/useCohortCoachPool\(enrollmentId\)/);
    expect(page).not.toMatch(/useCoachAsCoacheeAllowlist/);
  });
});

describe("Triad times", () => {
  it("a proposed Triad time is Vietnam wall-clock time (slotInstant), not the browser's zone", () => {
    const proposal = read("src/pages/triads/components/TriadAlternativeProposal.tsx");
    expect(proposal).toMatch(/slotInstant\(date, time\)/);
    expect(proposal).not.toMatch(/new Date\(`\$\{date\}T/);
  });
});
