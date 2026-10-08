import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Audit H4: one current-enrollment rule, enrollment_is_ongoing, decided on the
 * server -- learner_current_enrollment() for the learner,
 * admin_current_enrollments() for Admin. No client picks "current" from status.
 */
describe("current enrollment comes from the server", () => {
  it("the learner resolver asks learner_current_enrollment", () => {
    expect(read("src/lib/enrollments.ts")).toMatch(/rpc\("learner_current_enrollment"\)/);
    expect(read("src/lib/enrollments.ts")).not.toMatch(/getOngoingEnrollment/);
    expect(read("src/hooks/useEnrollmentContext.ts")).toMatch(/getCurrentEnrollmentId\(/);
  });

  it("Admin reads admin_current_enrollments; the status-only resolver is gone", () => {
    expect(existsSync(join(ROOT, "src/lib/enrollmentResolver.ts"))).toBe(false);
    for (const file of [
      "src/hooks/admin/useAdminCoacheesData.ts",
      "src/hooks/admin/useAdminRegistrations.ts",
      "src/pages/admin/AdminCoaches.tsx",
    ]) {
      const text = read(file);
      expect(text, file).toMatch(/fetchAdminCurrentEnrollments\(/);
      expect(text, file).not.toMatch(/resolveCurrentEnrollment/);
    }
  });
});
