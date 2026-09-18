import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The hosted ledger row for 20260918120000_canonical_enrollment_engagement
 * was recorded by scripts/ledger/… (its SQL had been applied earlier with a
 * raw query). These checks keep that script honest: it may only record the
 * ledger row, and it may only do so when the live objects are exactly the
 * repository migration's.
 */
const root = process.cwd();
const script = readFileSync(join(root, "scripts/ledger/20260918120000_canonical_enrollment_engagement.sql"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20260918120000_canonical_enrollment_engagement.sql"), "utf8");

// Everything except the migration text stored (as data) in the statements column.
const executable = script.replace(/ARRAY\['(?:[^']|'')*'\]/s, "ARRAY[<migration text>]");

describe("canonical_enrollment_engagement ledger reconciliation", () => {
  it("never replays schema SQL: no DDL, grants or data changes outside the ledger insert", () => {
    expect(executable).not.toMatch(/\b(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|DELETE|UPDATE)\b/i);
    const inserts = executable.match(/\bINSERT INTO\s+([\w.]+)/gi) ?? [];
    expect(inserts).toEqual(["INSERT INTO supabase_migrations.schema_migrations"]);
    expect(executable).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM supabase_migrations\.schema_migrations/);
  });

  it("guards on the exact repository definitions (body md5 per function)", () => {
    const repoHashes = Object.fromEntries(
      [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\((.*?)AS \$\$(.*?)\$\$;/gs)].map((m) => [
        m[1],
        createHash("md5").update(m[3]).digest("hex"),
      ])
    );
    expect(Object.keys(repoHashes).sort()).toEqual([
      "canonical_enrollment_engagement",
      "canonical_goal_progress",
      "learner_canonical_engagement",
      "learner_canonical_goal_progress",
      "sponsor_canonical_enrollment_metadata",
    ]);
    for (const [name, hash] of Object.entries(repoHashes)) {
      expect(executable, name).toMatch(new RegExp(`'public\\.${name}\\([^']*\\)', '${hash}'`));
    }
    expect(executable).toMatch(/RAISE EXCEPTION 'Ledger reconciliation aborted: % body differs/);
  });

  it("records the repository migration text verbatim", () => {
    const stored = script.match(/ARRAY\['((?:[^']|'')*)'\]/s)?.[1].replace(/''/g, "'");
    expect(stored).toBe(migration);
  });
});
