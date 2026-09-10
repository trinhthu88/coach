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

describe("temporary direct enrollment writer exceptions", () => {
  it("limits direct programme enrollment writes to the two Phase 7 seed replacements", () => {
    const writers = ["src", "supabase/functions"]
      .flatMap((directory) => sourceFiles(directory))
      .filter((file) => /from\("programme_enrollments"\)[\s\S]{0,240}\.(insert|upsert|update|delete)\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file))
      .sort();

    expect(writers).toEqual([
      "supabase/functions/seed-demo-data/index.ts",
      "supabase/functions/seed-tasc-content/index.ts",
    ]);
  });
});
