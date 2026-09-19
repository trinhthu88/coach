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
  // Retired in 20260918180000_retire_legacy_sponsor_sources.
  "sponsor_enrollment_summaries",
  "sponsor_cohort_summaries",
  "sponsor_organisation_summary",
  "sponsor_leader_engagement_summary",
  "sponsor_canonical_leader_next_booking",
  "get_admin_enrollment_progress",
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
    // Coachee prototype: plain page header + the one shared Programme Journey.
    expect(journey).toMatch(/data-testid="journey-header"/);
    expect(journey).toMatch(/<LearnerProgrammeJourney/);
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
    expect(read("hooks/triads/useMyTriads.ts")).toMatch(/fetchTriadMembers\(/);
    // The reflection page and Your Sessions reuse the one learner Triad projection.
    expect(read("pages/triads/TriadReflectionPage.tsx")).toMatch(/useTriadSessionEntry\(/);
    expect(read("hooks/sessions/useSessionsData.ts")).toMatch(/fetchMyTriads\(/);
    for (const file of ["hooks/triads/useMyTriads.ts", "pages/triads/TriadReflectionPage.tsx", "pages/triads/TriadsPage.tsx", "pages/triads/TriadSessionDetail.tsx"]) {
      expect(read(file), file).not.toMatch(/from\("profiles"\)/);
    }
    expect(read("hooks/triads/useTriadMembers.ts")).toMatch(/rpc\("learner_triad_members"/);
    // No other learner code calls the projection directly or rebuilds membership from sessions.
    const callers = files.filter((f) => /rpc\(\s*"learner_triad_members"/.test(readFileSync(f, "utf8")) && !f.endsWith("integrations/supabase/types.ts"));
    expect(callers.map((f) => relative(SRC, f))).toEqual(["hooks/triads/useTriadMembers.ts"]);
  });

  it("learner module pages (Coaching / Peer / Mentoring / Triads) read progress and sessions only from canonical sources", () => {
    const workspace = read("hooks/journey/useModuleWorkspace.ts");
    expect(workspace).toMatch(/useLearnerCanonicalProgress\(/);
    expect(workspace).toMatch(/useEnrollmentSessions\(/);
    expect(workspace).toMatch(/programmeModuleRows\(/);
    const modulePages = [
      "pages/coachee/MyCoachSection.tsx",
      "pages/coachee/MyPeerPracticeSection.tsx",
      "pages/coachee/MyMentorSection.tsx",
      "pages/triads/TriadsPage.tsx",
    ];
    for (const file of modulePages) {
      const text = read(file);
      expect(text, file).toMatch(/useModuleWorkspace\("(coaching|peer|mentoring|triads)"\)/);
      // No direct session-table reads and no client-side completion counting.
      expect(text, file).not.toMatch(/from\("(sessions|coachee_peer_sessions|peer_sessions|mentoring_sessions|triad_sessions)"\)/);
      expect(text, file).not.toMatch(/status\s*===\s*"completed"\)\.length/);
    }
    // Shared module presentation never queries data.
    expect(read("components/programme/module/ModulePage.tsx")).not.toMatch(/supabase|useQuery|use[A-Z]\w*Progress\(/);
  });

  it("Development journey renders experienced events only — no programme progress source", () => {
    for (const file of ["components/journey/DevelopmentJourneyList.tsx", "lib/developmentJourneyView.ts"]) {
      expect(read(file), file).not.toMatch(/useLearnerCanonical|canonical_progress|required_units|supabase/);
    }
  });

  it("nav keeps Develop Myself open: no group is collapsed by default and learners get static groups", () => {
    const layout = read("components/AppLayout.tsx");
    expect(layout).toMatch(/DEFAULT_COLLAPSED_GROUPS = new Set<string>\(\)/);
    expect(layout).toMatch(/staticGroups=\{role === "coachee"\}/);
  });

  it("scheduling policy is only ever interpreted by the database — no frontend date generation", () => {
    // The policy names appear only in the Admin programme template editor / its validation.
    const policyFiles = files.filter((f) => /evenly_distributed|monthly_frequency/.test(readFileSync(f, "utf8")) && !/__tests__|\.test\./.test(f));
    expect(policyFiles.map((f) => relative(SRC, f)).sort()).toEqual(["lib/programmeModuleConfig.ts", "pages/admin/ProgrammeModuleScheduleFields.tsx"]);
    for (const file of ["lib/programmeModuleConfig.ts", "pages/admin/ProgrammeModuleScheduleFields.tsx"]) {
      expect(read(file), file).not.toMatch(/addDays|addMonths|differenceInDays|\/\s*required_?[uU]nits/);
    }
    // Proposals come only from the canonical RPC, and only the Admin schedule hook asks for them.
    const proposalCallers = files.filter((f) => /rpc\(\s*"(cohort_requirement_schedule_proposal|admin_save_cohort_requirement_dates)"/.test(readFileSync(f, "utf8")));
    expect(proposalCallers.map((f) => relative(SRC, f))).toEqual(["hooks/admin/useCohortRequirementSchedule.ts"]);
    const tableReaders = files.filter((f) => /from\("cohort_requirement_dates"\)/.test(readFileSync(f, "utf8")));
    expect(tableReaders.map((f) => relative(SRC, f))).toEqual(["hooks/admin/useCohortRequirementSchedule.ts"]);
    // The Admin schedule helpers group and compare backend dates; they never compute one.
    expect(read("lib/cohortSchedule.ts")).not.toMatch(/addDays|addMonths|getTime\(\)|setDate\(|differenceIn/);
  });

  it("no role-specific checkpoint reinterpretation: every journey renders the backend's checkpoints as returned", () => {
    // Sponsor Cohort Detail no longer merges/regroups checkpoints client-side.
    expect(read("pages/sponsor/SponsorCohortDetail.tsx")).not.toMatch(/groupJourneyCheckpoints|representative/);
    // The shared checkpoint card never uses the backend label as a title.
    expect(read("components/programme/ProgrammeJourney.tsx")).not.toMatch(/point\.label/);
    // The learner detail only shows the label as Training week source content.
    expect(read("components/programme/LearnerProgrammeJourney.tsx")).toMatch(/point\.label && point\.module_scope\.includes\("training"\)/);
    // Learner / Sponsor journeys come from the canonical RPCs only.
    expect(read("hooks/useLearnerCanonicalProgress.ts")).toMatch(/rpc\("learner_canonical_journey"/);
    expect(read("hooks/sponsor/useSponsorLeaderData.ts")).toMatch(/rpc\("sponsor_canonical_leader_journey"/);
  });

  it("Admin Dashboard, Analytics and Alerts read completion and status from the canonical engine", () => {
    for (const file of ["pages/admin/AdminDashboard.tsx", "pages/admin/AdminAnalytics.tsx", "pages/admin/AdminAlerts.tsx"]) {
      const text = read(file);
      expect(text, file).toMatch(/fetchAdminCanonicalProgress\(/);
      // No second Admin completion engine, no stored-status "at risk", no snapshot reads.
      expect(text, file).not.toMatch(/get_admin_enrollment_progress|enrollment_module_(snapshots|milestones)|progress_pct/);
      expect(text, file).not.toMatch(/\.status === "at_risk"/);
    }
    expect(read("lib/adminCanonicalProgress.ts")).toMatch(/rpc\("admin_canonical_enrollment_progress"/);
    // Alerts count overdue actions from the original action records, not a session subset.
    expect(read("pages/admin/AdminAlerts.tsx")).toMatch(/from\("enrollment_actions"\)/);
    expect(read("pages/admin/AdminAlerts.tsx")).not.toMatch(/withEnrollmentActions/);
  });

  it("no surface calls a retired engine or reads a derived snapshot / deprecated cache", () => {
    const retired = /rpc\(\s*"(get_enrollment_progress|get_admin_enrollment_progress|sponsor_(cohort|enrollment)_summaries[a-z_]*|sponsor_organisation_summary[a-z_]*|sponsor_metric_rows[a-z_]*|sponsor_[a-z]+_cadence_items|sponsor_leader_engagement_summary|sponsor_enrollment_next_session|sponsor_leader_programme_history)"/;
    const snapshotReads = /from\("(enrollment_module_snapshots|enrollment_module_milestones)"\)|["'\s,]progress_pct["'\s,]/;
    const offenders = files.filter((f) => !f.endsWith("integrations/supabase/types.ts") && (retired.test(readFileSync(f, "utf8")) || snapshotReads.test(readFileSync(f, "utf8"))));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  describe("Triad source of truth (frontend + Edge Functions)", () => {
    const FUNCTIONS = join(process.cwd(), "supabase", "functions");
    const functionFiles = (dir = FUNCTIONS): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return functionFiles(path);
        return /\.(ts|tsx)$/.test(name) ? [path] : [];
      });
    const runtime = [...files.filter((f) => !f.endsWith("integrations/supabase/types.ts")), ...functionFiles()];
    const label = (f: string) => relative(process.cwd(), f);

    it("no runtime code reads a retired Triad table or field", () => {
      const retired = /\b(programme_)?triad_rounds\b|completion_deadline|(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|(learned|will_use)_as_(coach|coachee|observer)/;
      expect(runtime.filter((f) => retired.test(readFileSync(f, "utf8"))).map(label)).toEqual([]);
    });

    it("auto-assignment is requirement-first: one cohort Triad requirement, never a programme-wide pool", () => {
      const fn = readFileSync(join(FUNCTIONS, "triad-auto-assign", "index.ts"), "utf8");
      expect(fn).toMatch(/body\.cohort_requirement_date_id/);
      expect(fn).toMatch(/rpc\("triad_requirement_candidates_internal"/);
      expect(fn).toMatch(/rpc\("triad_create_group_internal"/);
      expect(fn).not.toMatch(/programme_id|from\("(programme_enrollments|triad_groups|triad_group_members)"\)/);
    });

    it("Triad completion is never derived from reflections or session rows outside canonical progress", () => {
      // A reflection rate is labelled as one; no surface names it "completion".
      expect(runtime.filter((f) => /triadCompletion/.test(readFileSync(f, "utf8"))).map(label)).toEqual([]);
      const timeline = read("hooks/journey/useProgrammeTimeline.ts");
      expect(timeline).toMatch(/\.unitCompleted\)/);
      expect(timeline).not.toMatch(/status\s*===\s*"completed"/);
    });

    it("Triad due dates and overdue state are rendered, never computed, on Triad surfaces", () => {
      for (const file of [
        "hooks/triads/useMyTriads.ts",
        "hooks/triads/useAdminTriads.ts",
        "pages/triads/TriadsPage.tsx",
        "pages/triads/components/TriadGroupHero.tsx",
        "pages/admin/AdminTriadRequirementCard.tsx",
        "pages/admin/AdminCohortTriads.tsx",
      ]) {
        const text = read(file);
        expect(text, file).not.toMatch(/Date\.now\(\)|isPast|isBefore|isAfter|differenceIn|addDays|addMonths/);
        expect(text, file).not.toMatch(/from\("(triad_[a-z_]+|cohort_requirement_dates)"\)/);
      }
    });

    it("\"inactive 7+ days\" has one canonical calculation read by Admin and the Edge Functions", () => {
      const readers = runtime.filter((f) => /rpc\(\s*"(admin_enrollment_inactivity|canonical_enrollment_inactivity_internal)"/.test(readFileSync(f, "utf8")));
      expect(readers.map(label).sort()).toEqual([
        "src/hooks/admin/useAdminProgrammeEngagement.ts",
        "src/pages/admin/AdminAlerts.tsx",
        "supabase/functions/send-programme-reminders/index.ts",
        "supabase/functions/send-weekly-admin-summary/index.ts",
      ]);
      // Nobody re-derives last activity or the 7-day window locally.
      const local = /lastActive|last_active_by|stale_participant"|7 \* (DAY_MS|24 \* 60 \* 60 \* 1000)[^;]*(activ|stale)/i;
      expect(runtime.filter((f) => local.test(readFileSync(f, "utf8"))).map(label)).toEqual([]);
    });

    it("the Triad reflection rate has one canonical calculation read by Admin Analytics and the weekly email", () => {
      const readers = runtime.filter((f) => /rpc\(\s*"(admin_programme_triad_reflection_rate|triad_reflection_rate_internal)"/.test(readFileSync(f, "utf8")));
      expect(readers.map(label).sort()).toEqual([
        "src/hooks/admin/useAdminProgrammeEngagement.ts",
        "supabase/functions/send-weekly-admin-summary/index.ts",
      ]);
      // No Admin surface counts Triad reflections itself.
      expect(files.filter((f) => /from\("triad_reflections"\)/.test(readFileSync(f, "utf8"))).map(label)).toEqual([]);
    });

    it("membership has one read path per role: learners via learner_triad_members / overview, Admin via its RPC", () => {
      expect(files.filter((f) => /from\("triad_group_members"\)/.test(readFileSync(f, "utf8"))).map(label)).toEqual([]);
    });
  });

  it("schedule mismatch state comes from one canonical source for every role", () => {
    const hook = read("hooks/useCanonicalScheduleState.ts");
    expect(hook).toMatch(/learner_canonical_schedule_state/);
    expect(hook).toMatch(/sponsor_canonical_leader_schedule_state/);
    expect(hook).toMatch(/admin_canonical_schedule_state/);
    expect(read("components/programme/LearnerProgrammeJourney.tsx")).toMatch(/useCanonicalScheduleState\("learner"/);
    expect(read("pages/sponsor/SponsorLeaderDrawer.tsx")).toMatch(/useCanonicalScheduleState\("sponsor"/);
  });
});

