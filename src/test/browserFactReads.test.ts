import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Prompt 15 Part B: facts are computed in SQL and rendered here. Admin, Coach,
 * dashboard and Sponsor code must not read the raw activity tables to count,
 * average or pick from them -- each such number has a server function
 * (admin_dashboard_summary, admin_analytics_summary,
 * admin_programme_training_engagement, coach_client_summary,
 * learner_next_session_by_module / coach_next_session_by_module,
 * learner_training_summary, admin_coach_delivery_summary, ...).
 *
 * A read that only fetches rows to show or act on them is allowed, listed
 * below with the reason. Adding to this list needs a reason that is not a
 * calculation.
 */
const GUARDED_DIRS = ["src/hooks/admin", "src/hooks/coach", "src/hooks/dashboard", "src/pages/sponsor"];
const TABLES = /\.from\(\s*["'`](sessions|peer_sessions|mentoring_sessions|assignment_submissions|training_progress)["'`]\s*\)/g;

const ALLOWED: Record<string, { table: string; reason: string }[]> = {
  "src/hooks/admin/useCoacheeProfileDetail.ts": [
    { table: "sessions", reason: "Admin's list of a learner's ten most recent session rows, shown as a list" },
  ],
  "src/hooks/coach/useClientDetail.ts": [
    { table: "sessions", reason: "the Coach's own session rows with this client (notes, links, actions), shown and edited" },
  ],
  "src/hooks/dashboard/useCoachDashboardData.ts": [
    { table: "sessions", reason: "booking requests and session rows the Coach confirms or declines" },
    { table: "peer_sessions", reason: "practice requests and rows the Coach acts on" },
  ],
  "src/hooks/dashboard/useLearnerFeedback.ts": [
    { table: "peer_sessions", reason: "ids of the learner's practice sessions, to fetch the feedback written on them" },
    { table: "sessions", reason: "the Coach's notes written on the learner's sessions, shown as feedback" },
    { table: "mentoring_sessions", reason: "the Mentor's notes written on the learner's sessions, shown as feedback" },
  ],
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("browser fact reads (Prompt 15 Part B)", () => {
  it("Admin, Coach, dashboard and Sponsor code reads no raw activity table unless allow-listed with a reason", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const dir of GUARDED_DIRS) {
      for (const file of files(join(root, dir))) {
        const rel = relative(root, file);
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(TABLES)) {
          const allowed = (ALLOWED[rel] ?? []).some((a) => a.table === m[1]);
          if (!allowed) offenders.push(`${rel}: .from("${m[1]}")`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every allow-list entry still exists and says why", () => {
    const root = process.cwd();
    for (const [rel, entries] of Object.entries(ALLOWED)) {
      const text = readFileSync(join(root, rel), "utf8");
      for (const { table, reason } of entries) {
        expect(reason.length, `${rel} ${table}`).toBeGreaterThan(20);
        expect(text, `${rel} no longer reads ${table}: remove the entry`).toMatch(new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]`));
      }
    }
  });
});
