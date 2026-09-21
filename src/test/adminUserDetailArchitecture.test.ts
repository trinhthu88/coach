import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Admin → user detail reads ONLY the admin_* canonical wrappers — the same
 * engines the learner and sponsor read — and never computes completion,
 * overdue, goal or satisfaction values itself.
 */
const SRC = join(process.cwd(), "src");
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const HOOK = "hooks/admin/useAdminUserDetail.ts";
const VIEW_FILES = ["pages/admin/AdminUserDetail.tsx", "pages/admin/userDetail/EnrollmentDetailPanel.tsx", "pages/admin/userDetail/display.ts"];

const ADMIN_WRAPPERS: Record<string, RegExp> = {
  admin_user_enrollments: /canonical_enrollment_progress\(e\.id, p_as_of\)/,
  admin_enrollment_module_progress: /FROM public\.canonical_module_progress\(p_enrollment_id, p_as_of\)/,
  admin_enrollment_engagement: /FROM public\.canonical_enrollment_engagement\(p_enrollment_id\)/,
  admin_enrollment_goals: /FROM public\.canonical_goal_progress\(p_enrollment_id\)/,
  admin_enrollment_goal_checkins: /FROM public\.goal_checkins/,
  admin_enrollment_actions: /FROM public\.enrollment_actions/,
  admin_learner_session_history: /FROM public\.canonical_session_history\(p_enrollment_id\)/,
  admin_learner_reflection_feed: /FROM public\.canonical_reflection_feed\(p_enrollment_id\)/,
};

function lastDefinition(name: string): string | null {
  let last: string | null = null;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const after = sql.slice(m.index);
      const tag = /AS\s+(\$[a-z_]*\$)/i.exec(after);
      if (!tag) continue;
      const start = tag.index + tag[0].length;
      last = after.slice(start, after.indexOf(tag[1], start));
    }
  }
  return last;
}

describe("Admin user detail — single source of truth", () => {
  it("the data hook calls only admin_* canonical wrappers", () => {
    const hook = code(read(HOOK));
    const rpcs = [...hook.matchAll(/rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(rpcs.length).toBeGreaterThan(0);
    expect(rpcs.filter((name) => !name.startsWith("admin_"))).toEqual([]);
    for (const name of Object.keys(ADMIN_WRAPPERS)) expect(hook, name).toMatch(new RegExp(`"${name}"`));
    // Overall canonical progress comes from the shared admin reader.
    expect(hook).toMatch(/fetchAdminCanonicalProgress\(\[enrollmentId\]\)/);
    // The only direct table read is the person's profile (name / email).
    expect([...hook.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1])).toEqual(["profiles"]);
  });

  it("the page and panel never query data or compute progress themselves", () => {
    for (const file of VIEW_FILES) {
      const text = code(read(file));
      expect(text, file).not.toMatch(/integrations\/supabase\/client|\.rpc\(|\.from\(/);
      // No completion / overdue / goal / satisfaction arithmetic.
      expect(text, file).not.toMatch(/\*\s*100|\/\s*\w*(required|total|count)\w*|Math\.(round|floor|ceil)\(|reduce\(/);
      expect(text, file).not.toMatch(/get_admin_enrollment_progress|enrollment_module_snapshots|programmeCompletionPct/);
    }
    // Feedback is the learner's own reader (admin RLS), reflections the shared mapper.
    expect(read("pages/admin/userDetail/EnrollmentDetailPanel.tsx")).toMatch(/useLearnerFeedback\(userId, enrollment\.enrollment_id\)/);
    expect(read(HOOK)).toMatch(/map\(toLearnerReflection\)/);
  });

  it("every admin wrapper is admin-gated and a thin projection of its engine", () => {
    for (const [name, engine] of Object.entries(ADMIN_WRAPPERS)) {
      const body = lastDefinition(name);
      expect(body, name).not.toBeNull();
      expect(body, name).toMatch(/public\.has_role\(auth\.uid\(\), 'admin'::public\.app_role\)/);
      expect(body, name).toMatch(engine);
    }
  });

  it("learner and admin session history / reflections share one engine body", () => {
    for (const [learner, engine] of [
      ["learner_session_history", "canonical_session_history"],
      ["learner_reflection_feed", "canonical_reflection_feed"],
    ]) {
      const wrapper = lastDefinition(learner) ?? "";
      expect(wrapper, learner).toMatch(new RegExp(`public\\.${engine}\\(e\\.id\\)`));
      expect(wrapper, learner).toMatch(/e\.user_id = auth\.uid\(\)/);
      const body = lastDefinition(engine) ?? "";
      expect(body, engine).not.toMatch(/auth\.uid\(\)/);
    }
    expect(lastDefinition("admin_learner_reflection_feed")).toMatch(/NOT f\.is_private/);
  });

  it("one detail view: both admin coachee routes render AdminUserDetail", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/path="\/admin\/coachees\/:userId" element={<ProtectedRoute role="admin"><AdminUserDetail \/>/);
    expect(app).toMatch(/path="\/admin\/coachees\/:userId\/enrollments\/:enrollmentId" element={<ProtectedRoute role="admin"><AdminUserDetail \/>/);
    expect(app).not.toMatch(/AdminEnrollmentReview/);
    expect(existsSync(join(SRC, "pages/admin/AdminEnrollmentReview.tsx"))).toBe(false);
    expect(read("pages/admin/AdminCoachees.tsx")).toMatch(/to={`\/admin\/coachees\/\$\{r\.id\}`}/);
  });
});
