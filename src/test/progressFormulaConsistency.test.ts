import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Spec Part 16: ONE progress formula, everywhere.
 *
 *   progress % = completed_required_activities / total_required_activities × 100
 *
 * It is computed once, in SQL (canonical_enrollment_progress.full_completion_pct),
 * and every client rounds/clamps it through ONE helper: canonicalCompletionPct().
 * This test fails if any of the five progress views derives a progress value
 * any other way — in particular from elapsed time or from a position/cursor.
 */

const SRC = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** The five views the spec names, and the files that render or feed their "% complete". */
const VIEWS: Record<string, { files: string[]; canonicalRead: RegExp }> = {
  "coachee dashboard": {
    files: ["components/programme/ProgrammeMetricCards.tsx", "components/ProgrammeProgressCard.tsx"],
    canonicalRead: /canonicalCompletionPct\((facts|progress)\.full_completion_pct\)/,
  },
  "admin learner list": {
    files: ["hooks/admin/useAdminCoacheesData.ts", "pages/admin/AdminCoachees.tsx"],
    canonicalRead: /canonicalCompletionPct\(/,
  },
  "admin profile sheet": {
    // Renders the admin list row's completion_pct (computed above), nothing else.
    files: ["pages/admin/coachees/CoacheeProfileSheet.tsx"],
    canonicalRead: /completion_pct/,
  },
  "coach view": {
    files: ["hooks/coach/useCoachClients.ts", "pages/coach/ClientRow.tsx", "pages/coach/ClientDetailDialog.tsx", "pages/CoachMyJourney.tsx"],
    canonicalRead: /canonicalCompletionPct\(/,
  },
  "sponsor portal": {
    files: ["pages/sponsor/SponsorDashboard.tsx", "pages/sponsor/SponsorCohorts.tsx", "pages/sponsor/_shared.tsx", "pages/sponsor/SponsorCohortDetail.tsx"],
    canonicalRead: /canonicalCompletionPct\(/,
  },
};

// A progress/completion value computed from time or position.
const TIME_OR_POSITION =
  /\b(elapsed\w*|days?(Since|Elapsed|Passed)|weeks?(Since|Elapsed|Passed)|differenceIn(Calendar)?(Days|Weeks|Months)|Date\.now\(\)|new Date\(|currentWeek|week_number|cursor|position|checkpointIndex|focusIndex|30\.4375)\b/;
const PROGRESS_NAME = /\b(\w*(progress|completion|complete)\w*(pct|percent)?|\w*pct)\s*[:=]/i;

describe("progress % consistency (spec Part 16)", () => {
  for (const [view, { files, canonicalRead }] of Object.entries(VIEWS)) {
    it(`${view} reads the canonical completion number`, () => {
      const joined = files.map(read).join("\n");
      expect(joined, view).toMatch(canonicalRead);
    });

    it(`${view} never computes progress from elapsed time or a position`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        stripComments(read(file))
          .split("\n")
          .forEach((line, i) => {
            if (PROGRESS_NAME.test(line) && TIME_OR_POSITION.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
          });
      }
      expect(offenders).toEqual([]);
    });
  }

  it("canonicalCompletionPct is the only client-side rounding of full_completion_pct", () => {
    // `full_completion_pct ?? 0` would render "no requirement yet" as 0%.
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.endsWith("integrations/supabase/types.ts") && !relative(SRC, f).startsWith("test/"))
      .filter((f) => /full_completion_pct\s*\?\?\s*0|Math\.round\([^)]*full_completion_pct/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the guard itself catches a time-elapsed or position-based progress value", () => {
    const bad = [
      "const progressPct = (elapsedDays / totalDays) * 100;",
      "const completion = Math.round((currentWeek / weeks.length) * 100);",
      "  pct: (focusIndex / checkpoints.length) * 100,",
    ];
    for (const line of bad) expect(PROGRESS_NAME.test(line) && TIME_OR_POSITION.test(line), line).toBe(true);
    expect(PROGRESS_NAME.test("const completionPct = canonicalCompletionPct(row.full_completion_pct);") &&
      TIME_OR_POSITION.test("const completionPct = canonicalCompletionPct(row.full_completion_pct);")).toBe(false);
  });
});

describe("coachee sidebar reads the same module list as progress (spec Part 10)", () => {
  const layout = read("components/AppLayout.tsx");
  const coacheeItems = layout.split("\n").filter((l) => /roles: \["coachee"\]/.test(l));

  it("gates each coachee module item on the module alone, never on a give/receive direction", () => {
    const moduleItems = coacheeItems.filter((l) => /module: "/.test(l));
    expect(moduleItems.map((l) => l.match(/module: "(\w+)"/)?.[1]).sort()).toEqual(
      ["coaching", "mentoring", "peer_coaching", "training", "triads"],
    );
    expect(moduleItems.filter((l) => /moduleDirection|anyModule/.test(l))).toEqual([]);
  });

  it("always shows My Journey, Sessions, Messages and Profile & Availability", () => {
    for (const key of ["nav.myJourney", "nav.sessions", "nav.messages", "nav.profileAndAvailability"]) {
      const line = coacheeItems.find((l) => l.includes(`"${key}"`));
      expect(line, key).toBeDefined();
      expect(line, key).not.toMatch(/module:/);
    }
  });

  it("the module list comes from get_enrollment_programme_modules (the programme modules progress measures)", () => {
    expect(read("hooks/useProgrammeModules.ts")).toMatch(/get_enrollment_programme_modules/);
  });
});

describe("admin profile is enrollment-first (P1-6)", () => {
  it("no admin learner surface shows a lifetime session count or a per-person session limit", () => {
    for (const file of ["pages/admin/AdminCoachees.tsx", "pages/admin/coachees/CoacheeProfileSheet.tsx", "pages/admin/coachees/coacheeDisplay.ts"]) {
      const text = stripComments(read(file));
      expect(text, file).not.toMatch(/\b(r|row|c)\.done\b|\b(r|row|c)\.session_limit\b|programmeCompletionPct/);
    }
  });

  it("the admin learner rows read canonical units for the current enrollment and surface load failures", () => {
    const hook = read("hooks/admin/useAdminCoacheesData.ts");
    expect(hook).toMatch(/fetchAdminCanonicalProgress\(/);
    expect(hook).not.toMatch(/fetchAdminCanonicalProgress\([^)]*\)\.catch\(\(\)\s*=>\s*\[\]\)/);
    expect(hook).toMatch(/progress_error/);
  });

  it("the user detail page is one section per enrollment, each from the canonical chain", () => {
    const detail = read("hooks/admin/useAdminUserDetail.ts");
    for (const rpc of ["admin_user_enrollments", "admin_enrollment_module_progress"]) expect(detail).toMatch(new RegExp(`rpc\\("${rpc}"`));
  });
});
