import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Admin-added accounts are activated through an emailed setup link
// (/set-new-password). No edge function may generate, set, or return a
// temporary password.
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: "generatePassword helper", pattern: /generate_?password/i },
  { name: "temporary password value", pattern: /temp(orary)?_?password/i },
  // createUser / updateUserById({ password: ... }) — setting a password server-side.
  { name: "password property set on an auth user", pattern: /\bpassword\s*:/ },
];

describe("no temporary passwords in edge functions", () => {
  const files = sourceFiles(join(process.cwd(), "supabase/functions"));

  it("finds edge function sources to scan", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN)("no edge function contains a $name", ({ pattern }) => {
    const offenders = files
      .filter((file) => pattern.test(readFileSync(file, "utf8").replace(/^\s*(\/\/|\*).*$/gm, "")))
      .map((file) => relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });

  it("the admin UI never displays a temporary password", () => {
    const offenders = sourceFiles(join(process.cwd(), "src/pages"))
      .filter((file) => /temp_password|tempPassword/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });
});
