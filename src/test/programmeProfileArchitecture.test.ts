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

  it("there is no scheduling policy left to interpret — the cohort owns one date per requirement", () => {
    // The distribution modes are gone from the product, not just from the UI.
    // Comments are stripped (they legitimately explain what was retired), and
    // the generated Supabase types are excluded: they still describe the
    // historical enrollment_module_snapshots column.
    const stripComments = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const policyFiles = files.filter(
      (f) => /evenly_distributed|monthly_frequency|training_linked|distribution_mode/.test(
        stripComments(readFileSync(f, "utf8")),
      )
        && !/__tests__|\.test\.|integrations\/supabase\/types\.ts/.test(f),
    );
    // The retired keys were purged from stored configs (20260927300000), so
    // no client code names them at all any more.
    expect(policyFiles.map((f) => relative(SRC, f)).sort()).toEqual([]);
    expect(stripComments(read("lib/programmeModuleConfig.ts"))).not.toMatch(
      /evenly_distributed|monthly_frequency|training_linked/,
    );
    // Module defaults and per-requirement dates are read and written through
    // the canonical RPCs only, and only by the Admin cohort schedule hook.
    const deadlineCallers = files.filter((f) =>
      /rpc\(\s*"(admin_cohort_module_deadlines|admin_set_cohort_module_deadlines|cohort_module_deadline_proposal|admin_cohort_requirement_schedule|admin_set_cohort_requirement_dates)"/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(deadlineCallers.map((f) => relative(SRC, f))).toEqual(["hooks/admin/useCohortRequirementSchedule.ts"]);
    // Nothing reads the requirement rows directly: they are the database's
    // materialisation of required_units against the deadline.
    const tableReaders = files.filter((f) =>
      /from\("(cohort_requirement_dates|cohort_module_deadlines)"\)/.test(readFileSync(f, "utf8")),
    );
    expect(tableReaders.map((f) => relative(SRC, f))).toEqual([]);
    // The Admin helpers order and compare backend dates; they never compute one.
    expect(read("lib/cohortSchedule.ts")).not.toMatch(/addDays|addMonths|getTime\(\)|setDate\(|differenceIn/);
    expect(read("pages/admin/ProgrammeModuleScheduleFields.tsx")).not.toMatch(
      /addDays|addMonths|differenceInDays|\/\s*required_?[uU]nits/,
    );
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

  it("every Admin '% complete' is the canonical number the learner sees — never time elapsed", () => {
    for (const file of ["hooks/admin/useAdminCoacheesData.ts", "pages/admin/AdminCoaches.tsx"]) {
      const text = read(file);
      expect(text, file).toMatch(/fetchAdminCanonicalProgress\(/);
      expect(text, file).toMatch(/canonicalCompletionPct\(/);
    }
    expect(read("components/programme/ProgrammeMetricCards.tsx")).toMatch(/canonicalCompletionPct\(facts\.full_completion_pct\)/);
    // No surface estimates completion from enrollment dates.
    const timeBased = /programmeCompletionPct|30\.4375/;
    expect(files.filter((f) => timeBased.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f))).toEqual([]);
  });

  it("no client calls an internal canonical engine directly (they are revoked from authenticated)", () => {
    // These fail with "permission denied" for every signed-in user; clients go
    // through the role-scoped wrappers (learner_*, sponsor_*, admin_*, coach_*).
    const internal = /rpc\(\s*"(canonical_module_progress|canonical_enrollment_progress|canonical_enrollment_engagement|canonical_overdue_items|canonical_goal_progress|canonical_learning_breakdown)"/;
    const offenders = files.filter((f) => internal.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it("every Coach '% complete' is the canonical number — never a milestone, session or position ratio", () => {
    expect(read("hooks/coach/useCoachClients.ts")).toMatch(/rpc\("coach_canonical_enrollment_progress"/);
    expect(read("hooks/coach/useCoachClients.ts")).toMatch(/canonicalCompletionPct\(/);
    // Status is the canonical pace_status too -- no coach-side heuristic.
    const coachClients = read("hooks/coach/useCoachClients.ts");
    expect(coachClients).toMatch(/pace_status/);
    expect(coachClients).not.toMatch(/overdueActions\s*>=|needs_attention|c\.status\s*=/);
    expect(read("pages/coach/ClientDetailDialog.tsx")).not.toMatch(/Math\.round\(\(done\s*\/\s*ms\.length\)/);
    expect(read("pages/coach/ClientRow.tsx")).toMatch(/client\.completionPct/);
    expect(read("pages/CoachMyJourney.tsx")).toMatch(/canonicalCompletionPct\(canonical\.progress\?\.full_completion_pct\)/);
    // A "%" derived from ticked milestones or elapsed days must not reappear on
    // a progress surface.
    const localRatio = /milestonesDone\s*\/\s*client\.milestonesTotal|overallPct\b|elapsed\s*\/\s*total\)\s*\*\s*100\)?\s*[,}]?\s*\/\/\s*completion/;
    const progressSurfaces = [
      "pages/coach/ClientRow.tsx",
      "pages/coach/ClientDetailDialog.tsx",
      "hooks/coach/useClientDetail.ts",
      "pages/CoachMyJourney.tsx",
      "pages/dashboard/coachee/CoacheeDashboard.tsx",
      "pages/admin/AdminCoachees.tsx",
      "pages/admin/coachees/CoacheeProfileSheet.tsx",
    ];
    expect(progressSurfaces.filter((f) => localRatio.test(read(f)))).toEqual([]);
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
      // completion_deadline is deliberately NOT here any more: it is the name of
      // the canonical cohort-module deadline, checked by its own test above.
      const retired = /\b(programme_)?triad_rounds\b|(coach|coachee|observer)_enrollment_id|member_[123]_(id|response)|enrollment_[123]_id|(learned|will_use)_as_(coach|coachee|observer)|cohort_triad_operations/;
      expect(runtime.filter((f) => retired.test(readFileSync(f, "utf8"))).map(label)).toEqual([]);
    });

    it("no runtime code keeps a Triad round or the retired cohort-scoped assignment", () => {
      // There is no Triad round: the unit is the cohort Triad requirement.
      const round = /round_number|roundNumber|roundLabel|triad_requirement_units_internal|triad_unit_enrollment_status_internal/;
      expect(runtime.filter((f) => round.test(readFileSync(f, "utf8"))).map(label)).toEqual([]);
      // A group was once for the whole cohort; now every required Triad has its own group.
      const cohortScoped = /triad_cohort_candidates_internal|p_cohort_id: cohortId,\s*p_enrollment_ids|activeGroupId|active_group_id/;
      expect(runtime.filter((f) => cohortScoped.test(readFileSync(f, "utf8"))).map(label)).toEqual([]);
    });

    it("EVERY REQUIRED TRIAD HAS ITS OWN GROUP: auto-assignment is for one requirement and avoids repeated partners", () => {
      const fn = readFileSync(join(FUNCTIONS, "triad-auto-assign", "index.ts"), "utf8");
      expect(fn).toMatch(/body\.cohort_requirement_date_id/);
      expect(fn).not.toMatch(/body\.cohort_id|body\.programme_id/);
      expect(fn).toMatch(/rpc\("triad_clear_unconfirmed_auto_groups_internal", \{ p_cohort_requirement_date_id: requirementId \}\)/);
      expect(fn).toMatch(/rpc\("triad_requirement_candidates_internal", \{\s*p_cohort_requirement_date_id: requirementId,?\s*\}\)/);
      expect(fn).toMatch(/rpc\("triad_create_group_internal", \{\s*p_cohort_requirement_date_id: requirementId,/);
      expect(fn).toMatch(/groupPool\(pool\.ids, overlapOf, wasPartner\)/);
      expect(fn).toMatch(/repeated_pairs: repeatedPairs/);
      expect(fn).not.toMatch(/from\("(programme_enrollments|triad_groups|triad_group_members)"\)/);
      const hook = read("hooks/triads/useAdminTriads.ts");
      expect(hook).toMatch(/functions\.invoke\("triad-auto-assign", \{\s*body: \{ cohort_requirement_date_id: requirementId \},?\s*\}\)/);
      expect(hook).toMatch(/rpc\("admin_triad_create_group", \{\s*p_cohort_requirement_date_id: requirementId,/);
      expect(hook).toMatch(/rpc\("admin_triad_requirement_candidates"/);
      expect(hook).toMatch(/rpc\("admin_cohort_triad_requirements"/);
    });

    it("Admin and Learner show one block per required Triad; Sessions are labelled \"Triad N\"", () => {
      const admin = read("pages/admin/AdminTriadGroupManagement.tsx");
      expect(admin).toMatch(/units\.map\(\(r\) => \(\s*<TriadRequirementCard/);
      expect(admin).toMatch(/groups\.filter\(\(g\) => g\.requirementId === r\.requirementId\)/);
      expect(admin).toMatch(/priorPartnerNames/);
      const learner = read("pages/triads/TriadsPage.tsx");
      expect(learner).toMatch(/\(status\?\.schedule \?\? \[\]\)\.map\(\(m\) => <TriadRequirementSection/);
      expect(learner).toMatch(/g\.requirementId === requirementId/);
      expect(learner).toMatch(/<PendingAssignmentCard/);
      expect(read("hooks/sessions/useSessionsData.ts")).toMatch(/unitNumber: group\.unitNumber/);
      expect(read("pages/Sessions.tsx")).toMatch(/t\("list\.triadSession", \{ n: session\.triad\.unitNumber \}\)/);
    });

    it("Triad reminders are per requirement; a fulfilled Triad group is never nagged to schedule", () => {
      const reminders = readFileSync(join(FUNCTIONS, "triad-reminders", "index.ts"), "utf8");
      expect(reminders).toMatch(/t\.cohort_requirement_date_id/);
      expect(reminders).not.toMatch(/completed_units/);
      const programme = readFileSync(join(FUNCTIONS, "send-programme-reminders", "index.ts"), "utf8");
      expect(programme).toMatch(/!sessions\.some\(\(s\) => s\.status === "completed"\)/);
      expect(programme).not.toMatch(/triad_cohort_learners_internal/);
    });

    it("Triad completion is read from the canonical projection, never computed on a surface", () => {
      // A reflection rate is labelled as one; no surface names it "completion".
      expect(runtime.filter((f) => /triadCompletion/.test(readFileSync(f, "utf8"))).map(label)).toEqual([]);
      // Learner and Admin read canonical_triad_completion through their RPCs.
      expect(read("hooks/triads/useMyTriads.ts")).toMatch(/rpc\("learner_triad_status"/);
      expect(read("hooks/triads/useAdminTriads.ts")).toMatch(/rpc\("admin_cohort_triad_learners"/);
      for (const file of [
        "hooks/triads/useMyTriads.ts",
        "hooks/triads/useAdminTriads.ts",
        "pages/triads/TriadsPage.tsx",
        "pages/admin/AdminCohortTriads.tsx",
        "pages/admin/AdminTriadGroupManagement.tsx",
        "hooks/journey/useProgrammeTimeline.ts",
      ]) {
        const text = read(file);
        // No local count of completed sessions / capping at the requirement.
        expect(text, file).not.toMatch(/filter\([^)]*status\s*===\s*"completed"[^)]*\)\.length|Math\.min\([^)]*required|completedUnits\s*[+-]?=/);
      }
      const timeline = read("hooks/journey/useProgrammeTimeline.ts");
      expect(timeline).toMatch(/\.satisfied\)/);
      expect(timeline).not.toMatch(/status\s*===\s*"completed"/);
    });

    it("Triad due dates and overdue state are rendered, never computed, on Triad surfaces", () => {
      for (const file of [
        "hooks/triads/useMyTriads.ts",
        "hooks/triads/useAdminTriads.ts",
        "pages/triads/TriadsPage.tsx",
        "pages/triads/components/TriadGroupHero.tsx",
        "pages/admin/AdminTriadGroupManagement.tsx",
        "pages/admin/AdminCohortTriads.tsx",
      ]) {
        const text = read(file);
        expect(text, file).not.toMatch(/Date\.now\(\)|isPast|isBefore|isAfter|differenceIn|addDays|addMonths/);
        expect(text, file).not.toMatch(/from\("(triad_[a-z_]+|cohort_requirement_dates)"\)/);
      }
    });

    it("Admin Triads never turns a load failure into \"0 required\"", () => {
      const page = read("pages/admin/AdminCohortTriads.tsx");
      // The requirement is its own query; its error state renders no number.
      expect(page).toMatch(/useAdminCohortTriadRequirement\(/);
      expect(page).toMatch(/admin-triads-requirement-error/);
      // "N required" is only ever rendered from a loaded requirement.
      expect(page).toMatch(/requirement\.requirements \? t\("triads\.requiredTitle"/);
      expect(read("hooks/triads/useAdminTriads.ts")).toMatch(/requirements: query\.data \?\? null/);
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

    it("reflection-rate consumers never reconstruct cohort weeks (one canonical week schedule)", () => {
      for (const file of ["src/hooks/admin/useAdminProgrammeEngagement.ts", "supabase/functions/send-weekly-admin-summary/index.ts"]) {
        const text = readFileSync(join(process.cwd(), file), "utf8");
        expect(text, file).not.toMatch(/cohort_week_overrides|week_number\s*-\s*1|weekNumber\s*-\s*1|start_date[^\n]*\+|unlock_date/);
      }
    });

    it("membership has one read path per role: learners via learner_triad_members / overview, Admin via its RPC", () => {
      expect(files.filter((f) => /from\("triad_group_members"\)/.test(readFileSync(f, "utf8"))).map(label)).toEqual([]);
    });
  });

  describe("Coaching source of truth", () => {
    /** Guards test code, not prose: comments legitimately name retired fields. */
    const code = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // Every mandatory evidence gate in coaching_session_evidence() must be
    // reachable from the product. The reflection gate shipped without a writer
    // of any kind, which left session_learning_reflections with no INSERT path
    // and made unit_complete unreachable for every learner, while the checklist
    // still displayed it as an outstanding item the learner could act on.
    it("every Coaching evidence gate has a writer wired into a surface", () => {
      const GATE_WRITERS: [string, RegExp][] = [
        // reflection -> session_learning_reflections
        ["reflection", /from\("session_learning_reflections"\)[\s\S]{0,200}\.upsert\(/],
        // goal check-in -> goal_checkins, via the canonical RPC
        ["goalCheckin", /rpc\("record_goal_checkins"/],
        // follow-up action -> enrollment_actions, via the canonical RPC
        ["action", /rpc\("save_enrollment_activity_actions"/],
        // satisfaction -> sessions.coachee_rating
        ["satisfaction", /coachee_rating:\s/],
      ];
      for (const [gate, writer] of GATE_WRITERS) {
        const writers = files.filter((f) => writer.test(readFileSync(f, "utf8")));
        expect(writers, `no writer for the Coaching ${gate} gate`).not.toEqual([]);
      }
    });

    it("the reflection writer is reachable from the checklist that shows the gate", () => {
      // One post-session checklist serves all four modules (Coaching included).
      const checklist = read("pages/session/PostSessionChecklist.tsx");
      expect(checklist).toMatch(/useSubmitSessionReflection/);
      // The learner writes their own reflection; nobody else may: the writer
      // is only rendered for the server-identified own row (isSelf), every
      // other viewer gets the read-only ticks.
      expect(checklist).toMatch(/r\.isSelf/);
      expect(checklist).toMatch(/data-mode="readonly"/);
      const detail = read("pages/SessionDetail.tsx");
      expect(detail).toMatch(/<PostSessionChecklist sourceTable=\{tableName\} sessionId=\{session\.id\}/);
    });

    // The C2 regression shape precisely: the writer existed as an exported
    // hook that nothing imported, so the capability was unreachable from any
    // rendered screen while every unit test of the hook still passed. A gate
    // writer must be reached from a component, not merely exist.
    // C4/C5: a Coaching reflection lived in two places, so a learner who wrote
    // one was told the other was missing.
    it("there is one Coaching reflection store", () => {
      // The Admin "missing reflection" alert asks the canonical store.
      const scan = read("pages/admin/alertScan.ts");
      expect(scan).toMatch(/reflectedSessionIds/);
      expect(code(scan)).not.toMatch(/coachee_notes/);
      expect(read("pages/admin/AdminAlerts.tsx")).toMatch(/session_learning_reflections/);
    });

    // C7: programme Coaching quantity is the cohort requirement count.
    it("the booking screen renders canonical Coaching quantity, never a per-person cap", () => {
      const book = read("pages/BookSession.tsx");
      expect(book).toMatch(/useCanonicalCoachingProgress\(/);
      // receive_limit may only survive on the coach-as-coachee path, which
      // can_book_session() deliberately keeps on the legacy model.
      const programmeBranch = code(book.slice(0, book.indexOf('if (role === "coach")')));
      expect(programmeBranch).not.toMatch(/receive_limit/);
    });

    it("the reflection hooks are reached from a rendered surface, not only exported", () => {
      const RENDERED = files.filter((f) => /\/(pages|components)\//.test(f));
      for (const hook of ["useSubmitSessionReflection", "useSessionReflection"]) {
        const callers = RENDERED.filter((f) => new RegExp(`\\b${hook}\\b`).test(readFileSync(f, "utf8")));
        expect(callers, `${hook} is exported but no screen calls it`).not.toEqual([]);
      }
    });
  });

  describe("Mentoring source of truth", () => {
    const MIGRATIONS = join(process.cwd(), "supabase/migrations");
    const FN_DIR = join(process.cwd(), "supabase", "functions");
    const edgeFunctionFiles = (dir = FN_DIR): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return edgeFunctionFiles(path);
        return /\.(ts|tsx)$/.test(name) ? [path] : [];
      });
    const migrationSql = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
      .join("\n");

    // The lifecycle had three writers: a raw client INSERT, a service-role
    // UPDATE in an Edge Function, and a raw client UPDATE for completion.
    //
    // prep_file_* is deliberately excluded: the preparation document is the
    // learner's own optional evidence, it is not a protected lifecycle field,
    // and useMentoringPrepFile writes it directly by design.
    const LIFECYCLE_FIELDS =
      /\b(status|enrollment_id|cohort_requirement_id|cohort_id|mentor_id|mentee_id|confirmed_at|cancelled_at|cancelled_by|cancel_reason|start_time|duration_minutes)\s*:/;

    it("no runtime code creates or mutates a Mentoring session's lifecycle directly", () => {
      for (const file of [...files, ...edgeFunctionFiles()]) {
        const text = readFileSync(file, "utf8");
        expect(text, file).not.toMatch(/from\(\s*"mentoring_sessions"\s*\)[\s\S]{0,120}\.insert\(/);
        const updates = [...text.matchAll(/from\(\s*"mentoring_sessions"\s*\)[\s\S]{0,60}\.update\(\{([\s\S]{0,300}?)\}\)/g)];
        for (const [, body] of updates) {
          expect(body, `${file} writes a lifecycle field directly`).not.toMatch(LIFECYCLE_FIELDS);
        }
      }
    });

    it("booking, lifecycle and notes go through the canonical RPCs", () => {
      expect(read("pages/MentoringBookSession.tsx")).toMatch(/"book_mentoring_session"/);
      const core = read("hooks/mentoring/useMentoringSessionCore.ts");
      expect(core).toMatch(/"transition_mentoring_session_status"/);
      expect(core).toMatch(/"update_mentoring_session_notes"/);
      const confirm = readFileSync(
        join(process.cwd(), "supabase/functions/confirm-mentoring-session/index.ts"), "utf8");
      expect(confirm).toMatch(/"transition_mentoring_session_status"/);
      // Slot reservation belongs to the database trigger now.
      expect(confirm).not.toMatch(/is_booked/);
    });

    // The prep document is optional evidence and gates nothing.
    it("no Mentoring path requires a preparation document", () => {
      for (const file of [...files, ...edgeFunctionFiles()]) {
        const text = readFileSync(file, "utf8");
        expect(text, file).not.toMatch(/prep_file_path[\s\S]{0,60}(required|must|cannot complete)/i);
      }
      expect(migrationSql).toMatch(/DROP FUNCTION IF EXISTS public\.enforce_mentoring_prep_file_before_completion/);
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

describe("requirement calendar, organisation and learning breakdown (20260928100000-120000)", () => {
  const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

  it("the Admin roster shows the ENROLLMENT's organisation in its own column and canonical booked units", () => {
    const page = read("pages/admin/AdminCoachees.tsx");
    expect(page).toMatch(/coachees\.tableHeaders\.organisation/);
    expect(page).toMatch(/data-testid="coachee-organisation"/);
    const hook = read("hooks/admin/useAdminCoacheesData.ts");
    expect(hook).toMatch(/organization_name: enr\?\.organization_id/);
    // Never inferred from the cohort row, never counted from raw session rows.
    expect(hook).not.toMatch(/cohortsData[^\n]*organization_id\s*\?\?|from\("sessions"\)/);
    expect(hook).toMatch(/booked: available \? progress!\.booked_units/);
  });

  it("organisation leader counts and lists come from enrollments via the Admin RPCs", () => {
    const page = read("pages/admin/AdminOrganizations.tsx");
    expect(page).toMatch(/rpc\("admin_organization_leader_summary"\)/);
    expect(page).not.toMatch(/from\("programme_enrollments"\)/);
    expect(read("pages/admin/organizations/OrganisationEnrollmentsDialog.tsx")).toMatch(/rpc\("admin_organization_enrollments"/);
  });

  it("the Training breakdown renders every configured child type the backend returns", () => {
    const breakdown = read("components/programme/ProgrammeModuleProgress.tsx");
    expect(breakdown).toMatch(/configuredLearningItems\(learningBreakdown\)/);
    expect(breakdown).not.toMatch(/key === "skill_cards"|skill_cards"\s*\)/);
    expect(read("lib/programmeProfile.ts")).toMatch(/item\.progress_available && item\.required_units > 0/);
  });

  it("the Admin enrollment detail shows the requirement calendar from the canonical wrapper", () => {
    expect(read("hooks/admin/useAdminUserDetail.ts")).toMatch(/rpc\("admin_enrollment_requirement_calendar"/);
    // No client reads the internal calendar directly.
    const internal = files.filter((f) => /rpc\(\s*"canonical_enrollment_requirement_calendar"/.test(readFileSync(f, "utf8")));
    expect(internal).toEqual([]);
  });
});

describe("learner surfaces share ONE active-enrollment context (20260928130000/140000)", () => {
  const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
  const LEARNER_SURFACES = [
    "pages/dashboard/coachee/CoacheeDashboard.tsx",
    "pages/CoacheeJourney.tsx",
    "hooks/journey/useModuleWorkspace.ts",
    "hooks/useProgrammeModules.ts",
    "pages/Sessions.tsx",
    "pages/dashboard/cards/MyGoalCard.tsx",
    "pages/dashboard/cards/MyFeedbackCard.tsx",
    "pages/dashboard/cards/RecentDevelopmentCard.tsx",
    "pages/dashboard/cards/MyCoachCard.tsx",
    "pages/dashboard/cards/MentoringReceiveCard.tsx",
    "pages/MentoringFindMentor.tsx",
    "pages/MentoringBookSession.tsx",
    "pages/CoacheePeerBookSession.tsx",
  ];

  it("Dashboard, My Journey, module pages, Sessions and the sidebar resolve the enrollment through useActiveEnrollment", () => {
    for (const file of LEARNER_SURFACES) {
      const text = read(file);
      expect(text, file).toMatch(/useActiveEnrollment(Details)?\(\)/);
      expect(text, file).not.toMatch(/useEnrollmentContext\(|from\("programme_enrollments"\)/);
    }
    // My Journey no longer derives its enrollment id from a separate ad-hoc programme fetch.
    expect(read("pages/CoacheeJourney.tsx")).not.toMatch(/useJourneyProgramme|programmeApi/);
    // The resolver is the shared one: single ongoing enrollment, explicit errors.
    const hook = read("hooks/useActiveEnrollment.ts");
    expect(hook).toMatch(/useEnrollmentContext\(user\?\.id\)/);
    expect(hook).toMatch(/loadError/);
  });

  it("no learner hook is handed a user id where an enrollment id is expected", () => {
    const offenders = files.filter((f) => /useMyCoachCardData\(\s*(user\?\.id|ws\.userId|userId)\b/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it("every programme module keeps its own learner route and module-gated sidebar entry (Sessions is the hub, not a replacement)", () => {
    const app = read("App.tsx");
    for (const path of ["/training", "/coaches", "/mentoring", "/coachee/peer-practice", "/triads", "/sessions", "/coachee/journey"]) {
      expect(app, path).toContain(`path="${path}"`);
    }
    const layout = read("components/AppLayout.tsx");
    for (const [path, module] of [["/training", "training"], ["/coaches", "coaching"], ["/coachee/peer-practice", "peer_coaching"], ["/mentoring", "mentoring"], ["/triads", "triads"]]) {
      expect(layout, path).toMatch(new RegExp(`to: "${path.replace(/\//g, "\\/")}"[^\\n]*roles: \\["coachee"\\][^\\n]*module: "${module}"`));
    }
    // Badges come from the canonical module progress, not a sidebar count.
    expect(layout).toMatch(/useLearnerModuleProgress\(/);
    expect(read("hooks/useLearnerModuleProgress.ts")).toMatch(/rpc\("learner_module_progress"/);
  });

  it("the Training page reads the programme-selected weeks and their canonical requirement", () => {
    expect(read("hooks/dashboard/useProgrammeProgress.ts")).toMatch(/rpc\("learner_training_week_items"/);
    expect(read("pages/TrainingWeeks.tsx")).toMatch(/requirement_due_on/);
  });
});
