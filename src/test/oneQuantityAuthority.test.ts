import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalModuleUnits,
  formatModuleUnits,
  type AdminCanonicalProgressRow,
} from "@/lib/adminCanonicalProgress";

/**
 * One quantity authority (20261005130000): how many sessions a learner has is
 * the canonical module row (required / completed / booked units), never a
 * module-config allowance, a programme session limit or a hard-coded default.
 * supabase/tests/one_quantity_authority_test.sql covers the server side.
 */
const SRC = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

const SURFACES = [
  "pages/BookSession.tsx",
  "pages/MentoringBookSession.tsx",
  "pages/CoachFindCoach.tsx",
  "pages/admin/AdminCoaches.tsx",
  "pages/AdminRegistrations.tsx",
  "hooks/admin/useAdminRegistrations.ts",
  "hooks/admin/types.ts",
  "pages/bookingEligibility.ts",
];

const ALLOWANCES = /receive_limit|monthly_limit|give_limit|DEFAULT_SESSION_LIMIT|coachee_session_limit|_session_limit\b|get_(peer|mentoring)_session_usage/;

describe("one quantity authority", () => {
  it.each(SURFACES)("%s shows no session allowance", (file) => {
    expect(read(file)).not.toMatch(ALLOWANCES);
  });

  it("the booking pages read the canonical module row", () => {
    expect(read("pages/BookSession.tsx")).toMatch(/useCanonicalCoachingProgress\(mode === "coaching" \? enrollmentId : null\)/);
    expect(read("pages/MentoringBookSession.tsx")).toMatch(/useLearnerModuleProgress\(enrollmentId\)/);
    expect(read("pages/CoachFindCoach.tsx")).toMatch(/useLearnerModuleProgress\(enrollmentId\)/);
    expect(read("pages/admin/AdminCoaches.tsx")).toMatch(/canonicalModuleUnits\(canonicalRow, "coaching"\)/);
    expect(read("hooks/admin/useAdminRegistrations.ts")).toMatch(/canonicalModuleUnits\(canonicalRow, "coaching"\)/);
  });

  it("a Coaching reschedule is not judged by the new-booking eligibility check", () => {
    expect(read("pages/BookSession.tsx")).toMatch(/\} else if \(!rescheduleId\) \{\s*const \{ data: canBook \} = await supabase\.rpc\("check_can_book_session"/);
  });
});

describe("canonicalModuleUnits", () => {
  const row = {
    progress_available: true,
    coaching_completed_units: 1,
    coaching_required_units: 3,
    peer_completed_units: 0,
    peer_required_units: 2,
  } as AdminCanonicalProgressRow;

  it("reads the module's units from the canonical row", () => {
    expect(canonicalModuleUnits(row, "coaching")).toEqual({ completed: 1, required: 3 });
    expect(canonicalModuleUnits(row, "peer")).toEqual({ completed: 0, required: 2 });
  });

  it("has no answer, rather than a default allowance, without canonical progress", () => {
    expect(canonicalModuleUnits(undefined, "coaching")).toBeNull();
    expect(canonicalModuleUnits({ ...row, progress_available: false }, "coaching")).toBeNull();
    expect(formatModuleUnits(null)).toBe("—");
    expect(formatModuleUnits({ completed: 1, required: 3 })).toBe("1 / 3");
  });
});
