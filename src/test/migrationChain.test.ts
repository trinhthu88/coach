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

/** Every `CREATE [OR REPLACE] FUNCTION public.<name>(` in a file, with its name. */
function namedFunctionDefinitions(sql: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z_0-9]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const after = sql.slice(m.index);
    const tag = /AS\s+(\$[a-z_]*\$)/i.exec(after);
    if (!tag) continue;
    const start = tag.index + tag[0].length;
    out.push({ name: m[1], body: after.slice(start, after.indexOf(tag[1], start)) });
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
      // No function defined after materialization may interpret the policy —
      // except the proposal layer itself, where policy changes belong.
      for (const { name, body } of namedFunctionDefinitions(sql)) {
        if (name === "cohort_requirement_proposal_internal") continue;
        expect(body, `${file} ${name}`).not.toMatch(/distribution_mode\s*=|\*\s*units\.sequence_no\s*\//);
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

  it("the retired engines are dropped and no later migration re-creates them", () => {
    const RETIRED = [
      "sponsor_enrollment_summaries", "sponsor_cohort_summaries", "sponsor_organisation_summary",
      "sponsor_cohort_summaries_legacy", "sponsor_organisation_summary_legacy", "sponsor_metric_rows",
      "sponsor_metric_rows_legacy", "sponsor_satisfaction_summary", "sponsor_satisfaction_events",
      "sponsor_normalize_satisfaction", "sponsor_leader_engagement_summary", "sponsor_leader_cadence_items",
      "sponsor_cohort_cadence_items", "sponsor_enrollment_next_session", "sponsor_canonical_leader_next_booking",
      "sponsor_leader_programme_history", "sponsor_canonical_leader_experience_base",
      "sponsor_canonical_leader_experience_legacy", "learner_canonical_experience_legacy",
      "get_admin_enrollment_progress", "compute_leader_progress", "refresh_all_progress_pct",
    ];
    const RETIRE = "20260918180000_retire_legacy_sponsor_sources.sql";
    const retireSql = readFileSync(join(DIR, RETIRE), "utf8");
    for (const name of RETIRED) {
      expect(retireSql, name).toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.${name}\\(`));
      for (const file of files.filter((f) => f > RETIRE)) {
        expect(functionDefinitions(readFileSync(join(DIR, file), "utf8"), name), `${file} re-creates ${name}`).toEqual([]);
      }
    }
  });

  it("Learner and Sponsor experience end on the one shared experience construction", () => {
    expect(lastDefinition("canonical_enrollment_experience")?.body).toMatch(/canonical_enrollment_experience_base/);
    expect(lastDefinition("canonical_enrollment_experience_base")?.body).toMatch(/canonical_enrollment_progress/);
    expect(lastDefinition("canonical_enrollment_experience_base")?.body).not.toMatch(/'weekly_participation', '\[\]'::jsonb/);
    for (const name of ["learner_canonical_experience", "sponsor_canonical_leader_experience"]) {
      expect(lastDefinition(name)?.body, name).toMatch(/canonical_enrollment_experience\(/);
    }
  });

  describe("Triad canonical cutover", () => {
    const CUTOVER = "20260918190000_triad_canonical_cutover.sql";
    const RETIRE_TRIAD = "20260918191000_triad_retire_legacy.sql";
    const RETIRED_TRIAD_FIELDS = /(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|completion_deadline|programme_triad_rounds|\btriad_rounds\b|[a-z]\.(learned|will_use)_as_(coach|coachee|observer)/;

    it("the legacy round tables and slot / role / answer columns are dropped after the cutover", () => {
      const sql = readFileSync(join(DIR, RETIRE_TRIAD), "utf8");
      expect(files).toContain(CUTOVER);
      expect(sql).toMatch(/DROP TABLE public\.triad_rounds;/);
      expect(sql).toMatch(/DROP TABLE public\.programme_triad_rounds;/);
      for (const column of ["member_1_id", "enrollment_1_id", "coach_enrollment_id", "coachee_enrollment_id", "observer_enrollment_id",
        "member_1_response", "proposed_start_time", "participant_id", "learned_as_coach", "will_use_as_observer"]) {
        expect(sql, column).toMatch(new RegExp(`DROP COLUMN ${column}`));
      }
    });

    it("no migration after the retirement re-creates a round table or reads a retired Triad field", () => {
      for (const file of files.filter((f) => f > RETIRE_TRIAD)) {
        const sql = readFileSync(join(DIR, file), "utf8");
        expect(sql, file).not.toMatch(/CREATE TABLE[^;]*\b(programme_)?triad_rounds\b/i);
        for (const { name, body } of namedFunctionDefinitions(sql)) {
          expect(body, `${file} ${name}`).not.toMatch(RETIRED_TRIAD_FIELDS);
        }
      }
    });

    it("every final Triad-reading function derives participants from membership", () => {
      for (const name of ["learner_session_history", "attribute_activity_to_cadence_milestone", "record_goal_checkins",
        "canonical_triad_group_members", "validate_triad_session_cap", "notify_triad_session_booked", "triad_sync_session_attributions"]) {
        const last = lastDefinition(name);
        expect(last?.body, name).toMatch(/triad_group_members/);
        expect(last?.body, name).not.toMatch(RETIRED_TRIAD_FIELDS);
      }
    });

    it("the reflection feed reads normalized answers and the goal source stays separate", () => {
      const feed = lastDefinition("learner_reflection_feed")?.body ?? "";
      expect(feed).toMatch(/triad_reflection_answers/);
      expect(feed).toMatch(/goal_checkins/);
      expect(feed).not.toMatch(RETIRED_TRIAD_FIELDS);
    });

    it("the only Triad due date is the cohort requirement date", () => {
      for (const name of ["triad_requirement_units_internal", "triad_unit_enrollment_status_internal", "learner_triad_overview"]) {
        const body = lastDefinition(name)?.body ?? "";
        expect(body, name).toMatch(/cohort_requirement_dates/);
        expect(body, name).not.toMatch(/completion_deadline|triad_rounds/);
      }
      // Unit overdue / completed come from canonical module progress, not a local rule.
      expect(lastDefinition("triad_unit_enrollment_status_internal")?.body).toMatch(/canonical_module_progress/);
    });

    it("group creation is requirement-scoped and cohort-first", () => {
      const create = lastDefinition("triad_create_group_internal")?.body ?? "";
      expect(create).toMatch(/cohort_requirement_date_id/);
      expect(create).toMatch(/cohort_id IS DISTINCT FROM unit\.cohort_id/);
    });
  });

  it("sponsor_min_leaders_for_distribution has one final zero-argument signature", () => {
    const sql = readFileSync(join(DIR, "20260918180000_retire_legacy_sponsor_sources.sql"), "utf8");
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.sponsor_min_leaders_for_distribution\(uuid\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.sponsor_min_leaders_for_distribution\(\)/);
  });
});

