import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration-chain guard: replaying supabase/migrations in order must end with
 * the canonical definitions (stored cohort dates own the schedule; one shared
 * journey, progress and schedule-state construction). This inspects the files
 * themselves, so a later migration cannot silently restore an old engine —
 * whatever order pending migrations are applied in.
 */
const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const SCHEDULE_MIGRATION = "20260918160000_cohort_requirement_schedule.sql";

/** Every `CREATE [OR REPLACE] FUNCTION public.<name>(` body in a file (dollar-quoted). */
function functionDefinitions(sql: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const after = sql.slice(m.index);
    const tag = /AS\s+(\$[a-z_]*\$)/i.exec(after);
    if (!tag) continue;
    const start = tag.index + tag[0].length;
    const end = after.indexOf(tag[1], start);
    out.push(after.slice(start, end));
  }
  return out;
}

function lastDefinition(name: string): { file: string; body: string } | null {
  let last: { file: string; body: string } | null = null;
  for (const file of files) {
    const defs = functionDefinitions(readFileSync(join(DIR, file), "utf8"), name);
    if (defs.length) last = { file, body: defs[defs.length - 1] };
  }
  return last;
}

describe("migration chain — canonical final state", () => {
  it("the superseded 20260918090000 migration defines no function (no-op in any order)", () => {
    const sql = readFileSync(join(DIR, "20260918090000_sponsor_canonical_calendar_followup.sql"), "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(sql).not.toMatch(/\b(GRANT|REVOKE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i);
  });

  it("the final sponsor_canonical_module_schedule reads stored cohort dates and interprets no policy", () => {
    const last = lastDefinition("sponsor_canonical_module_schedule");
    expect(last?.file).toBe(SCHEDULE_MIGRATION);
    expect(last?.body).toMatch(/cohort_requirement_dates/);
    expect(last?.body).not.toMatch(/evenly_distributed|monthly_frequency|distribution_mode|generate_series/);
  });

  it("no migration after the schedule migration contains the scheduling formula or redefines the schedule", () => {
    const later = files.filter((f) => f > SCHEDULE_MIGRATION);
    for (const file of later) {
      const sql = readFileSync(join(DIR, file), "utf8");
      // No function defined after materialization may interpret the policy.
      for (const body of functionDefinitions(sql, "[a-z_]+")) {
        expect(body, file).not.toMatch(/distribution_mode\s*=|\*\s*units\.sequence_no\s*\//);
      }
      for (const body of functionDefinitions(sql, "sponsor_canonical_module_schedule")) {
        expect(body, file).toMatch(/cohort_requirement_dates/);
      }
    }
  });

  it("the policy formula lives only in the proposal layer after materialization", () => {
    const sql = readFileSync(join(DIR, SCHEDULE_MIGRATION), "utf8");
    const withFormula = ["cohort_requirement_proposal_internal", "sponsor_canonical_module_schedule", "canonical_enrollment_journey"].filter((name) =>
      functionDefinitions(sql, name).some((body) => /evenly_distributed/.test(body))
    );
    expect(withFormula).toEqual(["cohort_requirement_proposal_internal"]);
  });

  it("Learner and Sponsor journeys end on the one shared journey construction", () => {
    expect(lastDefinition("canonical_enrollment_journey")?.body).toMatch(/sponsor_canonical_module_schedule/);
    expect(lastDefinition("learner_canonical_journey")?.body).toMatch(/canonical_enrollment_journey/);
    expect(lastDefinition("sponsor_canonical_leader_journey")?.body).toMatch(/canonical_enrollment_journey/);
    expect(lastDefinition("admin_canonical_enrollment_journey")?.body).toMatch(/canonical_enrollment_journey/);
  });

  it("Learner, Sponsor and Admin progress end on the one shared completion construction", () => {
    expect(lastDefinition("canonical_enrollment_progress")?.body).toMatch(/canonical_module_progress/);
    for (const name of ["learner_canonical_progress", "sponsor_canonical_enrollment_progress", "admin_canonical_enrollment_progress"]) {
      const body = lastDefinition(name)?.body ?? "";
      expect(body, name).toMatch(/canonical_enrollment_progress/);
      expect(body, name).not.toMatch(/canonical_module_progress|enrollment_module_snapshots|get_enrollment_progress/);
    }
    const admin = lastDefinition("get_admin_enrollment_progress")?.body ?? "";
    expect(admin).toMatch(/admin_canonical_enrollment_progress/);
    expect(admin).not.toMatch(/enrollment_module_snapshots|get_enrollment_progress|weight/);
  });

  it("schedule state has one construction behind every role", () => {
    for (const name of ["learner_canonical_schedule_state", "sponsor_canonical_leader_schedule_state", "admin_canonical_schedule_state"]) {
      expect(lastDefinition(name)?.body, name).toMatch(/canonical_enrollment_schedule_state/);
    }
    expect(lastDefinition("cohort_requirement_schedule_issues")?.body).toMatch(/cohort_programme_schedule_state/);
  });
});
