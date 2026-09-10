import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("programme enrollment writer boundary", () => {
  it("does not directly write programme_enrollments in production source", () => {
    const writers = ["src", "supabase/functions"]
      .flatMap((directory) => sourceFiles(directory))
      .filter((file) => /from\("programme_enrollments"\)[\s\S]{0,240}\.(insert|upsert|update|delete)\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file))
      .sort();

    expect(writers).toEqual([]);
  });
});

const permittedFixtureWriters = new Set([
  "supabase/functions/seed-demo-data/index.ts",
  "supabase/functions/seed-tasc-content/index.ts",
]);

const activityOwnershipColumns: Record<string, string[]> = {
  sessions: ["enrollment_id"],
  peer_sessions: ["enrollment_id"],
  coachee_peer_sessions: ["enrollment_id"],
  mentoring_sessions: ["enrollment_id"],
  training_progress: ["enrollment_id"],
  assignment_submissions: ["enrollment_id"],
  daily_prompt_responses: ["enrollment_id"],
  reflection_submissions: ["enrollment_id"],
  triad_reflections: ["enrollment_id"],
  coachee_goals: ["enrollment_id"],
  coachee_milestones: ["enrollment_id"],
  coachee_goal_ratings: ["enrollment_id"],
  triad_groups: ["enrollment_1_id", "enrollment_2_id"],
  triad_sessions: ["coach_enrollment_id", "coachee_enrollment_id", "observer_enrollment_id"],
};

describe("activity enrollment ownership assertions", () => {
  it("does not use unsupported UUID aggregates in the enrollment ownership migration", () => {
    const migration = readFileSync(
      "supabase/migrations/20260910161000_enrollment_activity_ownership.sql",
      "utf8"
    );

    expect(migration).not.toMatch(/\b(?:min|max|sum|avg)\s*\(\s*pe\.id\s*\)/i);
  });

  it("does not reference triad session role columns dropped by the redesign migration", () => {
    const migration = readFileSync(
      "supabase/migrations/20260910161000_enrollment_activity_ownership.sql",
      "utf8"
    );

    expect(migration).not.toMatch(/\b(?:coach_role_id|coachee_role_id|observer_role_id)\b/);
  });

  it("requires non-seed activity writes to carry enrollment ownership", () => {
    const missingOwnership: string[] = [];

    for (const file of ["src", "supabase/functions"].flatMap((directory) => sourceFiles(directory))) {
      const relativeFile = relative(process.cwd(), file);
      if (permittedFixtureWriters.has(relativeFile)) continue;

      const source = readFileSync(file, "utf8");
      for (const [table, columns] of Object.entries(activityOwnershipColumns)) {
        const callPattern = new RegExp(`from\\("${table}"\\)\\s*\\.(insert|upsert)\\s*\\(`, "g");
        for (const match of source.matchAll(callPattern)) {
          const callSource = source.slice(match.index, match.index + 700);
          if (!columns.some((column) => callSource.includes(column))) {
            missingOwnership.push(`${relativeFile}:${table}`);
          }
        }
      }
    }

    expect(missingOwnership.sort()).toEqual([]);
  });
});
