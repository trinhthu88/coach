import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * scripts/ledger/full-ledger-audit.sql is the read-only gate that decides
 * whether a migration may be applied to production or must instead have its
 * ledger row reconciled. These checks keep it honest: the embedded repo
 * manifest must match supabase/migrations/ exactly, and the script must not
 * be able to write anything.
 */
const root = process.cwd();
const audit = readFileSync(join(root, "scripts/ledger/full-ledger-audit.sql"), "utf8");

const repoMigrations = readdirSync(join(root, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => {
    const stem = f.slice(0, -4);
    const split = stem.indexOf("_");
    return { version: stem.slice(0, split), name: stem.slice(split + 1) };
  });

const manifest = audit.match(
  /-- BEGIN REPO MANIFEST[^\n]*\n(.*?)\n-- END REPO MANIFEST/s
)?.[1];

describe("full ledger audit", () => {
  it("embeds a manifest covering every repository migration, in order", () => {
    expect(manifest).toBeDefined();
    const listed = [...manifest!.matchAll(/\('(\d+)',\s*'(.*?)'\)/g)].map((m) => ({
      version: m[1],
      name: m[2].replace(/''/g, "'"),
    }));
    expect(listed).toEqual(repoMigrations);
  });

  it("is read-only: no writes, no temp objects, no DO blocks", () => {
    // A read-only transaction bars CREATE/DO outright; asserting it here
    // catches the mistake in review rather than against production.
    expect(audit).toMatch(/BEGIN TRANSACTION READ ONLY;/);
    expect(audit.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    const body = audit.replace(/^\s*--.*$/gm, "");
    expect(body).not.toMatch(/\b(INSERT INTO|UPDATE\s+\w|DELETE FROM|TRUNCATE|GRANT|REVOKE)\b/i);
    expect(body).not.toMatch(/\b(CREATE|ALTER|DROP)\b/i);
    expect(body).not.toMatch(/\bDO\s*\$/i);
  });

  it("probes only the catalog, never a possibly-missing relation", () => {
    // Referencing a missing table resolves at parse time and would abort the
    // whole audit under ON_ERROR_STOP=1 (the bug fixed in f128ab6).
    const probes = audit.match(/live\(version, is_live\) AS \(VALUES(.*?)\n\),/s)?.[1];
    expect(probes).toBeDefined();
    const fromTargets = [...probes!.matchAll(/\bFROM\s+([a-z_.]+)/gi)].map((m) => m[1]);
    expect(fromTargets.length).toBeGreaterThan(0);
    for (const target of fromTargets) {
      expect(target.startsWith("pg_")).toBe(true);
    }
    expect(probes).not.toMatch(/FROM\s+public\./i);
  });

  it("classifies a live-but-unrecorded migration as blocking, never as appliable", () => {
    expect(audit).toMatch(/WHEN is_live IS TRUE\s+THEN 'PENDING_BUT_LIVE'/);
    expect(audit).toMatch(/WHEN is_live IS TRUE\s+THEN 'INVESTIGATE: do not replay/);
  });
});
