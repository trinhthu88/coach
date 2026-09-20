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
        // The out-of-band demo data generator (20260918189000) copies stored
        // snapshot columns (distribution_mode = EXCLUDED.distribution_mode);
        // it writes fixture data and interprets no policy.
        if (name.startsWith("demo_")) continue;
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
    // The Admin schedule health report reads the same required-units scope the
    // materialiser does, so a mismatch cannot be reported differently.
    expect(lastDefinition("cohort_requirement_schedule_issues")?.body).toMatch(/cohort_required_module_units/);
    expect(lastDefinition("sync_cohort_requirement_dates")?.body).toMatch(/cohort_required_module_units/);
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
    const CLEANUP = "20260918185900_triad_legacy_data_cleanup.sql";
    const CUTOVER = "20260918190000_triad_canonical_cutover.sql";
    const DEPLOYMENT_2 = join(process.cwd(), "supabase/deployment-2");
    const REQUIREMENT_GROUPS = "20260919120000_triad_requirement_groups.sql";
    const RETIRE_TRIAD = "20260919190000_triad_retire_legacy.sql";
    // completion_deadline is no longer listed: it is the name of the canonical
    // cohort-module deadline (cohort_module_deadlines), not a retired Triad
    // column. The Triad column itself is gone with triad_rounds.
    const RETIRED_TRIAD_FIELDS = /(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|programme_triad_rounds|\btriad_rounds\b|[a-z]\.(learned|will_use)_as_(coach|coachee|observer)/;
    // Retired cohort-scoped assignment: a group was once for the whole cohort.
    const COHORT_SCOPED_ASSIGNMENT = /triad_cohort_candidates_internal|admin_triad_create_group\(p_cohort_id|triad_create_group_internal\(\s*p_cohort_id|cohort_triad_operations/;

    it("deployment 1 never drops legacy data: the retirement lives outside supabase/migrations (deployment 2)", () => {
      expect(files).toContain(CLEANUP);
      expect(files).toContain(CUTOVER);
      expect(files.filter((f) => /retire_legacy/.test(f) && /triad/.test(f))).toEqual([]);
      for (const file of files.filter((f) => f >= CLEANUP)) {
        const sql = readFileSync(join(DIR, file), "utf8");
        expect(sql, file).not.toMatch(/DROP TABLE public\.(programme_)?triad_rounds|DROP COLUMN (member_[123]_id|enrollment_[123]_id|(coach|coachee|observer)_enrollment_id|participant_id|learned_as_|will_use_as_)/);
      }
      // The Triad retirement is held here, and nothing Triad-shaped escaped
      // into supabase/migrations. Other modules stage their own retirements in
      // this directory (Coaching added one), so this asserts the Triad file is
      // present rather than that it is the only file.
      expect(readdirSync(DEPLOYMENT_2)).toContain(RETIRE_TRIAD);
    });

    it("deployment 2 drops the legacy round tables and slot / role / response / answer columns, and keeps the group's requirement and cohort", () => {
      const sql = readFileSync(join(DEPLOYMENT_2, RETIRE_TRIAD), "utf8");
      // It sorts after the requirement-groups migration and requires its link.
      expect(RETIRE_TRIAD > REQUIREMENT_GROUPS).toBe(true);
      expect(sql).not.toMatch(/DROP COLUMN cohort_requirement_date_id/);
      expect(sql).toMatch(/column_name = 'cohort_requirement_date_id' AND is_nullable = 'NO'/);
      expect(sql).toMatch(/DROP TABLE public\.triad_rounds;/);
      expect(sql).toMatch(/DROP TABLE public\.programme_triad_rounds;/);
      for (const column of ["member_1_id", "enrollment_1_id", "coach_enrollment_id", "coachee_enrollment_id", "observer_enrollment_id",
        "member_1_response", "proposed_start_time", "participant_id", "learned_as_coach", "will_use_as_observer", "round_number", "triad_round_id", "programme_id"]) {
        expect(sql, column).toMatch(new RegExp(`'${column}'`));
      }
      expect(sql).toMatch(/string_agg\(format\('DROP COLUMN %I'/);
      expect(sql).not.toMatch(/DROP COLUMN cohort_id/);
    });

    it("deployment 2 archives every source object transactionally and rejects stale conflicts", () => {
      const sql = readFileSync(join(DEPLOYMENT_2, RETIRE_TRIAD), "utf8");
      expect(sql).toMatch(/\\set ON_ERROR_STOP on/);
      expect(sql).toMatch(/^BEGIN;$/m);
      expect(sql).toMatch(/^COMMIT;$/m);
      expect(sql).toMatch(/ON CONFLICT \(object_name, record_id\) DO UPDATE/);
      expect(sql).not.toMatch(/ON CONFLICT[\s\S]{0,100}DO NOTHING/);
      expect(sql).toMatch(/archive rows are missing or stale/);
      expect(sql).toMatch(/typed source projection/);
      expect(sql).toMatch(/unexpected dependencies remain/);
    });

    it("deployment 2 explicitly allow-lists only intrinsic defaults, the known legacy trigger, indexes, and constraints", () => {
      const sql = readFileSync(join(DEPLOYMENT_2, RETIRE_TRIAD), "utf8");
      expect(sql).toMatch(/_triad_retirement_defaults/);
      expect(sql).toMatch(/_triad_retirement_triggers/);
      expect(sql).toMatch(/trg_triad_rounds_updated/);
      expect(sql).toMatch(/c\.relkind IN \('i', 'I'\)/);
      expect(sql).toMatch(/d\.classid = 'pg_attrdef'::regclass/);
      expect(sql).toMatch(/d\.classid = 'pg_trigger'::regclass/);
      expect(sql).toMatch(/REHEARSAL_AFTER_ARCHIVE_BOUNDARY/);
      expect(sql).toMatch(/REHEARSAL_DESTRUCTIVE_BOUNDARY/);
    });

    it("deployment 2 post-verification treats the standalone artifact as intentionally unledgered", () => {
      const sql = readFileSync(join(process.cwd(), "scripts/triad-deployment-2-verification.sql"), "utf8");
      expect(sql).toMatch(/standalone artifact outside/);
      expect(sql).not.toMatch(/version\s*=\s*'20260919190000'/);
    });

    it("deployment 2 post-verification covers the complete runtime surface and archive reconstruction", () => {
      const verifier = readFileSync(join(process.cwd(), "scripts/triad-deployment-2-verification.sql"), "utf8");
      const sequence = readFileSync(join(process.cwd(), "scripts/triad-deployment-2-post-retirement-verification.sql"), "utf8");
      const rehearsal = readFileSync(join(process.cwd(), "scripts/triad-deployment-2-rehearsal.sh"), "utf8");
      expect(verifier).toMatch(/retired indexes remain/);
      expect(verifier).toMatch(/runtime dependencies refer to retired objects/);
      for (const surface of ["pg_proc", "pg_class", "pg_policy", "pg_trigger", "pg_attrdef", "pg_constraint", "pg_depend"]) {
        expect(verifier, surface).toMatch(new RegExp(surface.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
      expect(sequence).toMatch(/triad-deployment-2-verification\.sql/);
      expect(sequence).toMatch(/triad-deployment-2-archive-reconstruction\.sql/);
      expect(rehearsal).toMatch(/Scenario 1\/8/);
      expect(rehearsal).toMatch(/Scenario 8\/8/);
      expect(rehearsal).toMatch(/Deployment 2 isolated rehearsal passed: 8\/8 scenarios/);
      expect(readFileSync(join(process.cwd(), "scripts/validate-db.sh"), "utf8"))
        .toMatch(/triad-deployment-2-post-retirement-verification\.sql/);
    });

    it("no final function reads a retired Triad field or keeps the cohort-scoped assignment", () => {
      for (const file of files.filter((f) => f > CUTOVER)) {
        const sql = readFileSync(join(DIR, file), "utf8");
        expect(sql, file).not.toMatch(/CREATE TABLE[^;]*\b(programme_)?triad_rounds\b/i);
        for (const { name, body } of namedFunctionDefinitions(sql)) {
          expect(body, `${file} ${name}`).not.toMatch(RETIRED_TRIAD_FIELDS);
        }
      }
      for (const name of ["triad_create_group_internal", "admin_triad_create_group", "triad_clear_unconfirmed_auto_groups_internal",
        "admin_triad_change_member", "triad_reminder_targets_internal", "admin_cohort_triad_groups"]) {
        expect(lastDefinition(name)?.body, name).not.toMatch(COHORT_SCOPED_ASSIGNMENT);
      }
      const sql = readFileSync(join(DIR, REQUIREMENT_GROUPS), "utf8");
      expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.triad_cohort_candidates_internal\(uuid\)/);
    });

    it("EVERY REQUIRED TRIAD HAS ITS OWN GROUP: a group is for one cohort requirement; one active group per enrollment PER REQUIREMENT", () => {
      const sql = readFileSync(join(DIR, REQUIREMENT_GROUPS), "utf8");
      expect(sql).toMatch(/ADD COLUMN cohort_requirement_date_id uuid REFERENCES public\.cohort_requirement_dates\(id\) ON DELETE RESTRICT/);
      expect(sql).toMatch(/ALTER COLUMN cohort_requirement_date_id SET NOT NULL/);
      const member = lastDefinition("triad_validate_group_member")?.body ?? "";
      // Members belong to the requirement's cohort AND programme.
      expect(member).toMatch(/e\.cohort_id IS DISTINCT FROM req\.cohort_id OR e\.programme_id IS DISTINCT FROM req\.programme_id/);
      // Final once the group has a session.
      expect(member).toMatch(/triad_sessions s WHERE s\.triad_group_id = g\.id/);
      // One active group per enrollment and requirement — never per cohort.
      const activeCheck = member.match(/JOIN public\.triad_groups og[\s\S]*?\) THEN/)?.[0] ?? "";
      expect(activeCheck).toMatch(/og\.is_active/);
      expect(activeCheck).toMatch(/og\.cohort_requirement_date_id = g\.cohort_requirement_date_id/);
      expect(member).toMatch(/pg_advisory_xact_lock\(hashtextextended\('triad_member:'/);
      // The group's cohort is derived from its requirement and immutable.
      const guard = lastDefinition("triad_guard_group")?.body ?? "";
      expect(guard).toMatch(/NEW\.cohort_id := req\.cohort_id/);
      expect(guard).toMatch(/requirement \(and cohort\) cannot change/);
      expect(guard).toMatch(/og\.cohort_requirement_date_id = NEW\.cohort_requirement_date_id/);
      // Assignment is requirement-scoped.
      const create = lastDefinition("triad_create_group_internal")?.body ?? "";
      expect(create).toMatch(/INSERT INTO public\.triad_groups \(cohort_requirement_date_id/);
      const candidates = lastDefinition("triad_requirement_learners_internal")?.body ?? "";
      expect(candidates).toMatch(/g\.cohort_requirement_date_id = req\.id AND g\.is_active/);
      expect(candidates).toMatch(/prior_partner|og\.cohort_requirement_date_id <> req\.id/);
      // A requirement with groups cannot be removed; regenerating keeps identities.
      expect(sql).toMatch(/CREATE TRIGGER cohort_requirement_dates_keep_triad_groups/);
      expect(lastDefinition("admin_save_cohort_requirement_dates")?.body).toMatch(/ON CONFLICT \(cohort_id, programme_id, module, ordinal\) DO UPDATE/);
    });

    it("every final Triad-reading function derives participants from historical membership", () => {
      for (const name of ["learner_session_history", "record_goal_checkins", "canonical_triad_group_members", "validate_triad_session_cap",
        "notify_triad_session_booked", "triad_sync_session_attributions", "canonical_triad_requirement_fulfilment"]) {
        const last = lastDefinition(name);
        expect(last?.body, name).toMatch(/triad_group_members/);
        expect(last?.body, name).not.toMatch(RETIRED_TRIAD_FIELDS);
      }
      // Triad evidence has one writer: the generic cadence attributor refuses it.
      expect(lastDefinition("attribute_activity_to_cadence_milestone")?.body).toMatch(/p_module='triads' THEN\s+RAISE EXCEPTION/);
    });

    it("the reflection feed reads normalized answers and the goal source stays separate", () => {
      const feed = lastDefinition("learner_reflection_feed")?.body ?? "";
      expect(feed).toMatch(/triad_reflection_answers/);
      expect(feed).toMatch(/goal_checkins/);
      expect(feed).not.toMatch(RETIRED_TRIAD_FIELDS);
      expect(feed).not.toMatch(/round_number/);
    });

    it("Triad completion = requirements fulfilled by a completed session of THEIR group, capped, each against its own deadline", () => {
      const fulfilment = lastDefinition("canonical_triad_requirement_fulfilment")?.body ?? "";
      expect(fulfilment).toMatch(/WHERE g\.cohort_requirement_date_id = d\.id/);
      expect(fulfilment).toMatch(/min\(ev\.occurred_on\) FILTER \(WHERE ev\.status = 'completed'\)/);
      const activity = lastDefinition("sponsor_canonical_activity")?.body ?? "";
      // One activity row per requirement — never per session.
      expect(activity).toMatch(/FROM public\.canonical_triad_requirement_fulfilment\(p_enrollment_id\) f/);
      expect(activity).not.toMatch(/JOIN public\.triad_sessions s ON s\.id = a\.source_activity_id/);
      const progress = lastDefinition("canonical_module_progress")?.body ?? "";
      expect(progress).toMatch(/a\.requirement_due_on IS NULL OR a\.requirement_due_on <= p_as_of/);
      for (const name of ["canonical_enrollment_journey", "get_sponsor_programme_journey"]) {
        expect(lastDefinition(name)?.body, name).toMatch(/a\.requirement_due_on IS NULL OR a\.requirement_due_on <= sm\.due_on/);
      }
      const completion = lastDefinition("canonical_triad_completion")?.body ?? "";
      expect(completion).toMatch(/canonical_module_progress\(p_enrollment_id, p_as_of\)/);
      expect(completion).toMatch(/canonical_triad_requirement_fulfilment\(p_enrollment_id\)/);
      expect(completion).not.toMatch(/completed_units, 0\) >= d\.ordinal/);
      const sync = lastDefinition("triad_sync_session_attributions")?.body ?? "";
      expect(sync).toMatch(/occurred_on, milestone_id\)[\s\S]*NULL/);
      expect(sync).toMatch(/s\.scheduled_start_time::date/);
      // A group whose requirement is fulfilled schedules no more programme sessions.
      expect(lastDefinition("learner_triad_schedule_session")?.body).toMatch(/s\.status = 'completed'/);
    });

    it("existing groups are mapped to a requirement deterministically; ambiguity stops the deployment", () => {
      const sql = readFileSync(join(DIR, REQUIREMENT_GROUPS), "utf8");
      expect(sql).toMatch(/RAISE EXCEPTION 'Triad requirement groups: cannot map groups to one requirement: %'/);
      expect(sql).toMatch(/Triad progress changed for real enrollments/);
      expect(sql).toMatch(/several active groups for one requirement/);
    });

    it("the readiness report carries exactly the shipped reviewed decisions and the repository's migration versions", () => {
      const readiness = readFileSync(join(process.cwd(), "scripts/triad-cutover-readiness.sql"), "utf8");
      const decisions = readFileSync(join(DIR, "20260918185850_triad_reviewed_decisions.sql"), "utf8");
      const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
      const decided = [...new Set(decisions.match(/DECLARE g uuid := '([^']+)'/g)?.map((m) => m.match(uuid)![0]) ?? [])].sort();
      const blocks = readiness.match(/reviewed_decisions\(triad_group_id\) AS \(VALUES[\s\S]*?\)\n\)/g) ?? [];
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) expect([...new Set(block.match(uuid))].sort()).toEqual(decided);
      const repoBlock = readiness.match(/WITH repo\(version\) AS \(VALUES([\s\S]*?)\n\)/)?.[1] ?? "";
      expect(repoBlock.match(/\d{14}/g)).toEqual(files.map((f) => f.split("_")[0]));
    });

    it("the Triad reflection rate buckets weeks through the canonical training schedule, never its own week formula", () => {
      const rate = lastDefinition("triad_reflection_rate_internal")?.body ?? "";
      expect(rate).toMatch(/canonical_training_learning_items\(m\.enrollment_id/);
      expect(rate).not.toMatch(/week_number|cohort_week_overrides|start_date|interval\s*'7 days'|\*\s*7\b/i);
    });

    it("the legacy cleanup removes only DEMO/SEED conflicts and stops on REAL/UNKNOWN ones", () => {
      const sql = readFileSync(join(DIR, CLEANUP), "utf8");
      expect(sql).toMatch(/'REAL\/UNKNOWN' AND NOT x\.reviewed_delete/);
      expect(sql).toMatch(/RAISE EXCEPTION 'Triad cleanup: REAL\/UNKNOWN/);
      expect(sql).toMatch(/INSERT INTO public\.triad_cutover_archive/);
      expect(sql).toMatch(/duplicate_completed_session/);
    });
  });

  it("sponsor_min_leaders_for_distribution has one final zero-argument signature", () => {
    const sql = readFileSync(join(DIR, "20260918180000_retire_legacy_sponsor_sources.sql"), "utf8");
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.sponsor_min_leaders_for_distribution\(uuid\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.sponsor_min_leaders_for_distribution\(\)/);
  });
});

