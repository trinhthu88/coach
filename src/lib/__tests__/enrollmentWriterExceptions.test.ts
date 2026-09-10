import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("temporary direct enrollment writer exceptions", () => {
  it("limits direct programme enrollment writes to the two Phase 7 seed replacements", () => {
    const candidates = execFileSync(
      "rg",
      ["-l", "programme_enrollments", "src", "supabase/functions", "--glob", "*.{ts,tsx}"],
      { cwd: process.cwd(), encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .filter(Boolean);

    const writers = candidates
      .filter((file) => /from\("programme_enrollments"\)[\s\S]{0,240}\.(insert|upsert|update|delete)\(/.test(
        readFileSync(file, "utf8")
      ))
      .sort();

    expect(writers).toEqual([
      "supabase/functions/seed-demo-data/index.ts",
      "supabase/functions/seed-tasc-content/index.ts",
    ]);
  });
});
