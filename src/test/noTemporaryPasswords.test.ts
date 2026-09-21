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

describe("one identity onboarding pattern (rule 6)", () => {
  const root = process.cwd();
  const code = [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "supabase/functions"))].filter(
    (f) => !/__tests__|\/test\//.test(f) && !f.endsWith("noTemporaryPasswords.test.ts"),
  );

  it("nothing reads or writes must_change_password", () => {
    const offenders = code.filter((f) => /must_change_password/.test(readFileSync(f, "utf8"))).map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });

  it("every admin provisioning path calls the one service, admin-provision-user", () => {
    const invokes = code
      .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/functions\.invoke\(\s*["']([a-z-]*(invite|provision)[a-z-]*)["']/g)].map((m) => `${relative(root, f)} -> ${m[1]}`));
    expect(invokes.every((i) => i.endsWith("-> admin-provision-user") || i.includes("coach-invite-coachee"))).toBe(true);
    expect(invokes.some((i) => i.endsWith("-> admin-provision-user"))).toBe(true);
    // The retired parallel paths do not come back.
    for (const dir of ["admin-invite-users", "admin-bulk-invite-users", "invite-sponsor"]) {
      expect(() => readdirSync(join(root, "supabase/functions", dir))).toThrow();
    }
  });

  it("the self-requested access approval sends the same one-use setup link", () => {
    const approve = readFileSync(join(root, "supabase/functions/approve-access-request/index.ts"), "utf8");
    expect(approve).toMatch(/redirectTo:\s*`\$\{SITE_URL\}\/set-new-password`/);
  });
});
