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

  it("the Sessions list reads Coaching requirements through the viewer's role wrapper", () => {
    expect(coachingFulfilmentRpc("coach")).toBe("coach_coaching_requirement_fulfilment");
    expect(coachingFulfilmentRpc("coachee")).toBe("learner_coaching_requirement_fulfilment");
    expect(coachingFulfilmentRpc("admin")).toBeNull();
    expect(coachingFulfilmentRpc("sponsor")).toBeNull();
  });
});
