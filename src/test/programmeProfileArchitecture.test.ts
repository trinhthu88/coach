import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards for the shared programme-profile architecture. These catch
 * the regressions this refactor removed: a second Programme Journey
 * implementation, a learner surface reading a non-canonical progress source,
 * or a retired reporting RPC coming back.
 */
const SRC = join(process.cwd(), "src");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(join(SRC, path), "utf8");
const files = sourceFiles();

/** Retired reporting RPCs (see supabase/tests/legacy_reporting_surfaces_absent_test.sql). */
const RETIRED_RPCS = [
  "sponsor_can_view_coachee",
  "sponsor_coach_utilisation",
  "sponsor_confidence_trend",
  "sponsor_engagement_red_flags",
  "sponsor_goal_growth_summary",
  "sponsor_kpis",
  "sponsor_programme_engagement",
  "sponsor_roster",
  "sponsor_satisfaction_summary",
  "sponsor_satisfaction_trend",
  "sponsor_timeline",
];

describe("programme profile architecture", () => {
  it("no frontend code calls a retired reporting RPC", () => {
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return RETIRED_RPCS.filter((rpc) => new RegExp(`rpc\\(\\s*["']${rpc}["']`).test(text)).map((rpc) => `${relative(SRC, file)} → ${rpc}`);
    });
    expect(offenders).toEqual([]);
  });

  it("learner progress/journey surfaces never read the legacy snapshot progress RPC", () => {
    const offenders = files.filter((file) => /rpc\(\s*["']get_enrollment_progress["']/.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it("there is exactly one Programme Journey checkpoint renderer", () => {
    const renderers = files.filter((file) => /data-testid="journey-checkpoint"/.test(readFileSync(file, "utf8")));
    expect(renderers.map((f) => relative(SRC, f))).toEqual(["components/programme/ProgrammeJourney.tsx"]);
  });

  it("Sponsor Leader Detail, the Learner Dashboard and My Journey all render the shared journey", () => {
    expect(read("pages/sponsor/SponsorLeaderDrawer.tsx")).toMatch(/<ProgrammeJourney\s[^>]*viewer="sponsor"/);
    expect(read("pages/dashboard/coachee/CoacheeDashboard.tsx")).toMatch(/<LearnerProgrammeJourney[\s\S]*?variant="summary"/);
    expect(read("pages/CoacheeJourney.tsx")).toMatch(/<LearnerProgrammeJourney[^>]*variant="full"/);
    expect(read("components/programme/LearnerProgrammeJourney.tsx")).toMatch(/<ProgrammeJourney[\s\S]*?viewer="learner"/);
  });

  it("the sponsor and learner data hooks share one journey/experience parser", () => {
    for (const hook of ["hooks/sponsor/useSponsorLeaderData.ts", "hooks/useLearnerCanonicalProgress.ts"]) {
      const text = read(hook);
      expect(text).toMatch(/parseProgrammeJourney\(/);
      expect(text).toMatch(/parseProgrammeExperience\(/);
      expect(text).not.toMatch(/function parseJourney|function parseExperience/);
    }
  });

  it("shared programme components receive canonical values and never query data themselves", () => {
    const shared = files.filter((f) => relative(SRC, f).startsWith("components/programme/") && !f.endsWith("LearnerProgrammeJourney.tsx"));
    for (const file of shared) {
      const text = readFileSync(file, "utf8");
      expect(text, relative(SRC, file)).not.toMatch(/supabase|useQuery|use[A-Z]\w*Progress\(/);
    }
  });

  it("My Journey is built on the shared profile system, not the older card layout", () => {
    const journey = read("pages/CoacheeJourney.tsx");
    expect(journey).toMatch(/<ProgrammeProfileHeader/);
    expect(journey).toMatch(/<ProfileSection/);
    expect(journey).not.toMatch(/@\/components\/ui\/card/);
    expect(journey).toMatch(/<FeedbackItemCard/);
  });

  it("learner feedback never selects author-private note columns", () => {
    expect(read("hooks/dashboard/useLearnerFeedback.ts")).not.toMatch(/select\([^)]*private_notes/);
  });

  it("learner surfaces render canonical goal progress instead of recalculating it", () => {
    for (const file of ["pages/dashboard/coachee/LearnerGoalsActions.tsx", "pages/CoacheeJourney.tsx"]) {
      const text = read(file);
      expect(text, file).not.toMatch(/goalProgressPct|useGoalRatingRows/);
      expect(text, file).toMatch(/useLearnerCanonicalGoalProgress/);
    }
  });

  it("the learner checkpoint detail derives no units of its own", () => {
    expect(read("components/programme/LearnerProgrammeJourney.tsx")).not.toMatch(/required_units\s*-|-\s*point\.completed_units/);
  });

  it("enrollment-scoped learner session lists read the canonical history projection only", () => {
    const hook = read("hooks/journey/useEnrollmentSessions.ts");
    expect(hook).toMatch(/rpc\("learner_session_history"/);
    expect(hook).not.toMatch(/from\("(sessions|peer_sessions|coachee_peer_sessions|mentoring_sessions|triad_sessions)"\)/);
  });

  it("there is one session-detail route resolver", () => {
    const offenders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return !file.endsWith("lib/sessionPaths.ts") && /`\/sessions\/\$\{[^}]+\}\?type=/.test(text);
    });
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it("My Journey, the Dashboard and the Development Journey share the canonical reflection feed", () => {
    expect(read("pages/CoacheeJourney.tsx")).toMatch(/useLearnerReflectionFeed\(/);
    expect(read("pages/dashboard/coachee/LearnerFeedbackDevelopment.tsx")).toMatch(/useLearnerReflectionFeed\(/);
    const devJourney = read("hooks/journey/useEnrollmentDevelopmentJourney.ts");
    expect(devJourney).toMatch(/rpc\("learner_reflection_feed"/);
    // No second reflection fetch from the original tables in those surfaces.
    for (const file of ["pages/CoacheeJourney.tsx", "pages/dashboard/coachee/LearnerFeedbackDevelopment.tsx", "hooks/journey/useEnrollmentDevelopmentJourney.ts"]) {
      expect(read(file), file).not.toMatch(/from\("(coachee_reflections|triad_reflections|reflection_answers|daily_prompt_responses)"\)/);
    }
  });

  it("learner Triad surfaces resolve co-members only through the canonical triad member source", () => {
    for (const file of ["hooks/triads/useMyTriads.ts", "pages/triads/TriadReflectionPage.tsx", "hooks/sessions/useSessionsData.ts"]) {
      expect(read(file), file).toMatch(/fetchTriadMembers\(/);
    }
    for (const file of ["hooks/triads/useMyTriads.ts", "pages/triads/TriadReflectionPage.tsx", "pages/triads/TriadsPage.tsx", "pages/triads/TriadSessionDetail.tsx"]) {
      expect(read(file), file).not.toMatch(/from\("profiles"\)/);
    }
    expect(read("hooks/triads/useTriadMembers.ts")).toMatch(/rpc\("learner_triad_members"/);
    // No other learner code calls the projection directly or rebuilds membership from sessions.
    const callers = files.filter((f) => /learner_triad_members/.test(readFileSync(f, "utf8")) && !f.endsWith("integrations/supabase/types.ts"));
    expect(callers.map((f) => relative(SRC, f))).toEqual(["hooks/triads/useTriadMembers.ts"]);
  });
});
