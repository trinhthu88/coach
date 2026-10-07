import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Prompt 13 (decisions 9 and 9e), the parts outside SQL:
 * supabase/tests/missing_decisions_test.sql covers the database.
 */
const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("decision 9: programme units, not a session allowance", () => {
  it("the Sponsor dashboard has no '90% of sessions, consider renewal' alert, and Settings no setting for it", () => {
    expect(read("src/pages/sponsor/SponsorDashboard.tsx")).not.toMatch(/sessionThreshold|session-threshold|0\.9\b/);
    expect(read("src/pages/sponsor/SponsorSettings.tsx")).not.toMatch(/session_milestones|sessionMilestones/);
  });

  it("the retired locale keys are gone from every language", () => {
    for (const lang of readdirSync(join(root, "src/locales"))) {
      const sponsor = JSON.parse(read(`src/locales/${lang}/sponsor.json`));
      expect(Object.keys(sponsor.dashboard?.alerts ?? {}), lang).not.toEqual(
        expect.arrayContaining(["sessionThreshold"]),
      );
      expect(Object.keys(sponsor.dashboard?.alerts ?? {}), lang).not.toContain("atRiskInactive");
      expect(Object.keys(sponsor.settings?.notifications ?? {}), lang).not.toContain("sessionMilestones");
    }
  });

  it("the Sponsor PDF reports programme units completed, X / Y", () => {
    const pdf = read("supabase/functions/generate-report-pdf/index.ts");
    expect(pdf).toMatch(/Programme units completed: \$\{kpis\.units_completed\} \/ \$\{kpis\.units_required\}/);
    expect(pdf).toMatch(/units_completed: cohort\.completed_units/);
    expect(pdf).not.toMatch(/Coaching sessions used|sessions_entitled/);
  });
});

describe("decision 9e: one reporting population", () => {
  it("the weekly admin email counts the server's reporting population, never programme_enrollments directly", () => {
    const email = read("supabase/functions/send-weekly-admin-summary/index.ts");
    expect(email).toMatch(/rpc\("reporting_enrollments"\)/);
    expect(email).not.toMatch(/from\("programme_enrollments"\)/);
  });

  it("the Admin completion rate sends no enrollment ids", () => {
    expect(read("src/lib/adminCanonicalProgress.ts")).toMatch(/rpc\("admin_canonical_completion_rate"\)/);
    for (const page of ["src/pages/admin/AdminDashboard.tsx", "src/pages/admin/AdminAnalytics.tsx"]) {
      expect(read(page), page).toMatch(/fetchAdminCompletionRate\(\)/);
    }
  });
});
