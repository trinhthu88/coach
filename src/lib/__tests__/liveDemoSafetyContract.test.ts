import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const endpoint = readFileSync("supabase/functions/seed-demo-data/index.ts", "utf8");
const migrationPath = "supabase/migrations/20260911180000_live_demo_organization.sql";

describe("live demo safety contract", () => {
  it("keeps reset server-controlled and admin-only", () => {
    expect(endpoint).toContain("assertRealAdmin");
    expect(endpoint).toContain("reset_live_demo_data");
    expect(endpoint).toContain("collision.app_metadata?.live_demo !== true");
    expect(endpoint).not.toContain("organization_id:");
    expect(endpoint).not.toContain("supabase/seed.sql");
  });

  it("pins reset to the registered demo organization and protects real data", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain("d3000000-0000-4000-8000-000000000001");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("Cross-organization reference blocks demo reset");
    expect(migration).toContain("AS RESTRICTIVE");
    expect(migration).toContain("Demo Sponsor is read-only");
    expect(migration).toContain("INSERT INTO public.coachee_coach_allowlist");
    expect(migration).toContain("INSERT INTO public.mentoring_allowlist");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.reset_live_demo_data");
    expect(migration).not.toContain("TRUNCATE");
  });

  it("exposes the reset only on the fixed demo organization card", () => {
    const page = readFileSync("src/pages/admin/AdminOrganizations.tsx", "utf8");
    expect(page).toContain('LIVE_DEMO_ORG_ID');
    expect(page).toContain('functions.invoke("seed-demo-data"');
    expect(page).toContain("Reset Demo Data");
  });
});
