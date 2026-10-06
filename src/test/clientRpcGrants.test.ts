import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { coachingFulfilmentRpc } from "@/hooks/sessions/useSessionsData";

/**
 * The app reads programme facts through role wrappers (learner_ / coach_ /
 * sponsor_ / admin_), never through a shared construction. Those are not
 * client-callable since 20261005120000_grants_and_profile_guard
 * (supabase/tests/grants_and_profile_guard_test.sql); a client call would fail
 * at run time with "permission denied".
 */
const SRC = join(process.cwd(), "src");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.endsWith("integrations/supabase/types.ts")
      ? [path]
      : [];
  });
}

const NOT_CLIENT_CALLABLE =
  /^(canonical_.+|.+_internal|next_.+_requirement|programme_required_units|assert_enrollment_scope|resolve_current_enrollment|dashboard_summary)$/;

describe("client RPC grants", () => {
  it("no app code calls a function that is not client-callable", () => {
    const offenders = sourceFiles().flatMap((file) =>
      Array.from(readFileSync(file, "utf8").matchAll(/\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/g))
        .map((m) => m[1])
        .filter((name) => NOT_CLIENT_CALLABLE.test(name))
        .map((name) => `${relative(SRC, file)}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  // Bookings, status changes and Admin edits go through SECURITY DEFINER
  // functions; the four session tables grant no INSERT, and
  // guard_session_protected_fields() refuses a status written at the table.
  // Notes, meeting links and the mentoring prep file are still plain UPDATEs.
  it("no app code inserts, deletes or changes the status of a session row directly", () => {
    const offenders = sourceFiles().flatMap((file) =>
      Array.from(
        readFileSync(file, "utf8").matchAll(
          /\.from\(\s*["'`](sessions|mentoring_sessions|peer_sessions|coachee_peer_sessions)["'`]\s*\)([^;]*)/g,
        ),
      )
        .filter(([, , chain]) => /\.(insert|upsert|delete)\(/.test(chain) || /\.update\(\s*\{[^}]*\bstatus\b/.test(chain))
        .map(([, table]) => `${relative(SRC, file)}: ${table}`),
    );
    expect(offenders).toEqual([]);
  });

  // The assessment pipeline (20261006210000) grants the app nothing on its six
  // tables: every read is a role function and every change a step function.
  it("no app code reads or writes the assessment tables directly", () => {
    const offenders = sourceFiles().flatMap((file) =>
      Array.from(
        readFileSync(file, "utf8").matchAll(
          /\.from\(\s*["'`](cohort_assessors|assessment_submissions|assessment_files|assessment_assignments|assessment_reviews|assessment_validations)["'`]/g,
        ),
      ).map(([, table]) => `${relative(SRC, file)}: ${table}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the Sessions list reads Coaching requirements through the viewer's role wrapper", () => {
    expect(coachingFulfilmentRpc("coach")).toBe("coach_coaching_requirement_fulfilment");
    expect(coachingFulfilmentRpc("coachee")).toBe("learner_coaching_requirement_fulfilment");
    expect(coachingFulfilmentRpc("admin")).toBeNull();
    expect(coachingFulfilmentRpc("sponsor")).toBeNull();
  });
});
