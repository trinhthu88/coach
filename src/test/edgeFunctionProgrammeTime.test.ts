import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatProgrammeDateTime,
  formatSessionWhen,
  programmeInstant,
} from "../../supabase/functions/_shared/programmeTime";
import { bucketToRange } from "../../supabase/functions/triad-auto-assign/slots";

const FUNCTIONS = join(__dirname, "../../supabase/functions");

function functionSources(dir = FUNCTIONS): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return functionSources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Edge Functions build and print times in Asia/Ho_Chi_Minh (decision 2; audit H1, H2). */
describe("Edge Function times are Vietnamese", () => {
  it("a Vietnamese wall-clock time is the instant 7 hours earlier in UTC", () => {
    expect(programmeInstant("2026-10-15", 9)).toBe("2026-10-15T02:00:00.000Z");
    expect(programmeInstant("2026-10-15", 6, 30)).toBe("2026-10-14T23:30:00.000Z");
  });

  it("Triad auto-assign proposes the hour the learners are free in Vietnam (H1)", () => {
    // Free 09:00-10:00 Vietnam time = 02:00-03:00 UTC, never 09:00 UTC (16:00 Vietnam).
    expect(bucketToRange("2026-10-15|09")).toEqual({
      start: "2026-10-15T02:00:00.000Z",
      end: "2026-10-15T03:00:00.000Z",
    });
  });

  it("a session email prints Vietnamese time: 06:30 on 15 Oct is not 14 Oct (H2)", () => {
    const when = formatSessionWhen("2026-10-14T23:30:00Z", 60);
    expect(when).toContain("Oct 15, 2026");
    expect(when).toContain("6:30");
    expect(when).not.toContain("Oct 14");
    expect(when).not.toContain("UTC");
    expect(when).toMatch(/· 60 min$/);
  });

  it("the Triad notification prints the proposed time in Vietnam (H1)", () => {
    const text = formatProgrammeDateTime("2026-10-15T02:00:00.000Z");
    expect(text).toContain("Oct 15, 2026");
    expect(text).toContain("9:00");
  });

  it("no Edge Function formats or builds a time in UTC", () => {
    const offenders = functionSources().filter((path) => {
      const src = readFileSync(path, "utf8");
      return (
        /timeZone:\s*["']UTC["']/.test(src) ||
        /timezone:\s*["']UTC["']/.test(src) ||
        // A wall-clock time glued to "Z" reads Vietnamese availability as UTC.
        /T\$\{[^}]+\}:00:00Z/.test(src) ||
        // toLocaleString() without a zone prints the server's (UTC) time.
        /\.toLocale(?:Date|Time)?String\(\)/.test(src)
      );
    });
    expect(offenders.map((p) => p.slice(FUNCTIONS.length + 1))).toEqual([]);
  });
});
