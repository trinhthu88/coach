import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Booking goal gate (spec Part 7): one server rule, every booking path calls it.
 * Replaying supabase/migrations in order, the LATEST definition of each booking
 * function must still call assert_enrollment_goal_gate — so a later migration
 * that redefines a booking function cannot silently drop the gate.
 */
const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

function functionDefinitions(sql: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const after = sql.slice(m.index);
    const tag = /AS\s+(\$[a-z_]*\$)/i.exec(after);
    if (!tag) continue;
    const start = tag.index + tag[0].length;
    out.push(after.slice(start, after.indexOf(tag[1], start)));
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

const stripComments = (body: string) => body.replace(/--.*$/gm, "");

describe("booking goal gate — every booking path enforces the one rule", () => {
  it.each([
    // Coaching (learner book_coaching_session delegates here)
    "book_coaching_session_internal",
    // Mentoring (learner and Admin-on-behalf delegate here)
    "book_mentoring_session_internal",
    // Peer, learner-to-learner
    "book_coachee_peer_session",
    // Peer, coach-as-learner
    "book_peer_session",
    // Triads
    "learner_triad_schedule_session",
    "learner_triad_propose_alternative",
    // Row-level backstop for direct learner inserts
    "enforce_booking_goal_gate",
  ])("the latest %s calls assert_enrollment_goal_gate", (name) => {
    const last = lastDefinition(name);
    expect(last, `${name} must be defined`).not.toBeNull();
    expect(stripComments(last!.body)).toMatch(/public\.assert_enrollment_goal_gate\s*\(/);
  });

  it("the public Coaching and Mentoring entry points still delegate to the gated internal insert", () => {
    expect(stripComments(lastDefinition("book_coaching_session")!.body)).toMatch(/book_coaching_session_internal\s*\(/);
    expect(stripComments(lastDefinition("book_mentoring_session")!.body)).toMatch(/book_mentoring_session_internal\s*\(/);
  });

  it("the assertion reads the single rule and raises the stable machine-readable error", () => {
    const assert = stripComments(lastDefinition("assert_enrollment_goal_gate")!.body);
    // The assertion and the state both read THE rule, check_booking_eligibility().
    expect(assert).toMatch(/check_booking_eligibility\s*\(/);
    expect(assert).toMatch(/'goal_required_before_booking'/);
    expect(assert).toMatch(/ERRCODE\s*=\s*'P0001'/);
    // The client-readable gate reads the same rule — never a second computation.
    expect(stripComments(lastDefinition("enrollment_goal_gate")!.body)).toMatch(/enrollment_goal_gate_state\s*\(/);
  });

  it("booking is blocked whenever there is no active goal (no grace period); the goal-setting deadline is an alert only", () => {
    const state = stripComments(lastDefinition("enrollment_goal_gate_state")!.body);
    expect(state).toMatch(/v_eligible\s*:=\s*public\.check_booking_eligibility\(/);
    expect(state).toMatch(/'blocked',\s*NOT v_eligible/);
    expect(state).not.toMatch(/grace/i);
    // The deadline is the cohort's goal-setting period (default start + 7),
    // resolved in one place (20260928110000) and never part of 'blocked'.
    expect(state).toMatch(/enrollment_goal_setting_period\(p_enrollment_id\)/);
    expect(state).toMatch(/'goal_setup_deadline',\s*v_due/);
    expect(stripComments(lastDefinition("enrollment_goal_setting_period")!.body)).toMatch(/coalesce\(c\.goal_setting_due_on,\s*coalesce\(c\.start_date,\s*e\.start_date\)\s*\+\s*7\)/);
    // The one rule: at least one active goal on the enrollment.
    const rule = stripComments(lastDefinition("check_booking_eligibility")!.body);
    expect(rule).toMatch(/g\.enrollment_id\s*=\s*p_enrollment_id/);
    expect(rule).toMatch(/g\.status\s*=\s*'active'/);
    expect(stripComments(lastDefinition("assert_enrollment_goal_gate")!.body)).toMatch(/Create at least one goal first/);
    expect(stripComments(lastDefinition("enrollment_goal_gate_start_date")!.body)).toMatch(
      /COALESCE\(\s*c\.start_date\s*,\s*e\.start_date\s*\)/,
    );
  });

  it("the Mentoring pre-check reports the gate", () => {
    expect(stripComments(lastDefinition("check_can_book_mentoring_session_reason_for_enrollment")!.body)).toMatch(
      /'goal_required_before_booking'/,
    );
  });

  it("rescheduling a Coaching session is not a new booking and is exempt", () => {
    const internal = stripComments(lastDefinition("book_coaching_session_internal")!.body);
    expect(internal).toMatch(/NOT public\.coaching_reschedule_in_progress\([^)]*\) THEN\s*PERFORM public\.assert_enrollment_goal_gate/);
    expect(stripComments(lastDefinition("enforce_booking_goal_gate")!.body)).toMatch(/coaching_reschedule_in_progress\(/);
    expect(stripComments(lastDefinition("coaching_reschedule_in_progress")!.body)).toMatch(
      /status\s*=\s*'rescheduled'[\s\S]*cancelled_at\s*=\s*now\(\)/,
    );
    expect(stripComments(lastDefinition("reschedule_coaching_session")!.body)).toMatch(/book_coaching_session_internal\s*\(/);
  });
});
