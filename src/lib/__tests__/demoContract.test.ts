import { describe, expect, it } from "vitest";
import {
  DEMO_ACCOUNTS,
  DEMO_ANCHOR_DATE,
  DEMO_BATCH_1_CONTRACT,
  DEMO_BATCH_2_CONTRACT,
  DEMO_BATCH_3_CONTRACT,
  DEMO_BATCH_4_CONTRACT,
  DEMO_LEADERS,
  DEMO_FIXTURE_IDS,
  DEMO_FIXTURE_VERSION,
  DEMO_LEADER_COUNT,
  DEMO_ORGANIZATION_ID,
  DEMO_PROGRAMMES,
} from "../../../supabase/functions/demo-admin/manifest";

describe("Clariva live-demo Batch 1 contract", () => {
  it("uses one fixed target and deterministic fixture identifiers", () => {
    expect(DEMO_FIXTURE_IDS.organization).toBe(DEMO_ORGANIZATION_ID);
    expect(new Set(Object.values(DEMO_FIXTURE_IDS.programmes)).size).toBe(4);
    expect(new Set(Object.values(DEMO_FIXTURE_IDS.cohorts)).size).toBe(4);
    expect(new Set(Object.values(DEMO_FIXTURE_IDS.accounts)).size).toBe(4);
    expect(DEMO_FIXTURE_IDS.leaders).toHaveLength(40);
    expect(DEMO_FIXTURE_IDS.enrollments).toHaveLength(40);
    expect(DEMO_FIXTURE_IDS.leaders.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    expect(DEMO_FIXTURE_IDS.enrollments.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    expect(DEMO_ORGANIZATION_ID).toBe("c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01");
  });

  it("keeps the approved portfolio and Batch 1 scope separate", () => {
    expect(DEMO_FIXTURE_VERSION).toBe("clariva-live-demo-v1");
    expect(DEMO_ANCHOR_DATE).toBe("2026-01-05");
    expect(DEMO_LEADER_COUNT).toBe(40);
    expect(DEMO_ACCOUNTS).toHaveLength(4);
    expect(DEMO_PROGRAMMES).toHaveLength(4);
    expect(DEMO_BATCH_1_CONTRACT.creates.leaders).toBe(0);
    expect(DEMO_BATCH_1_CONTRACT.creates.activity).toBe(0);
  });

  it("keeps Batch 2 counts, distribution, and shared learner identities deterministic", () => {
    expect(DEMO_BATCH_2_CONTRACT.creates).toMatchObject({
      programmes: 4,
      cohorts: 4,
      accounts: 4,
      authUsers: 42,
      profiles: 42,
      roleAssignments: 42,
      leaderProfiles: 40,
      enrollments: 40,
      activity: 0,
      ownershipResources: 221,
    });
    expect(DEMO_BATCH_2_CONTRACT.cohortDistribution).toEqual({ A: 8, B: 10, C: 12, D: 10 });
    expect(DEMO_LEADERS.filter((leader) => leader.email.includes("demo-learner-"))).toHaveLength(2);
    expect(DEMO_LEADERS.find((leader) => leader.serial === 1)?.userId)
      .toBe(DEMO_FIXTURE_IDS.accounts.learnerExecutive);
    expect(DEMO_LEADERS.find((leader) => leader.serial === 19)?.userId)
      .toBe(DEMO_FIXTURE_IDS.accounts.learnerEmerging);
  });

  it("keeps Batch 3 activity, progress, privacy, and ownership counts deterministic", () => {
    expect(DEMO_BATCH_3_CONTRACT.historicalCompletedCohort).toBe("D");
    expect(DEMO_BATCH_3_CONTRACT.activeCohorts).toEqual(["A", "B", "C"]);
    expect(DEMO_BATCH_3_CONTRACT.paceStates).toEqual([
      "ahead",
      "on_track",
      "scheduled",
      "behind",
    ]);
    expect(DEMO_BATCH_3_CONTRACT.creates).toMatchObject({
      programmeModules: 24,
      trainingWeeks: 18,
      enrollmentSnapshots: 254,
      scheduleMilestones: 748,
      coachingSessions: 128,
      mentoringSessions: 60,
      peerSessions: 44,
      triadGroups: 7,
      triadSessions: 14,
      goals: 40,
      goalMilestones: 80,
      goalRatings: 40,
      goalCheckins: 40,
      actions: 57,
      trainingProgress: 192,
      sensitiveContentRows: 0,
      ownershipResources: 1746,
    });
    expect(DEMO_BATCH_3_CONTRACT.privacy.excluded).toContain("transcripts");
    expect(DEMO_BATCH_3_CONTRACT.privacy.excluded).toContain("files");
  });

  it("keeps Batch 4 reset scope and rebuild safeguards fixed", () => {
    expect(DEMO_BATCH_4_CONTRACT.operation).toBe("reset");
    expect(DEMO_BATCH_4_CONTRACT.resetScope).toBe("registered-demo-owned-resources-only");
    expect(DEMO_BATCH_4_CONTRACT.deterministicRebuild).toEqual({
      ownershipResources: 1746,
      generationIncrement: 1,
      repeatedResetState: "identical_fixture_state",
    });
    expect(DEMO_BATCH_4_CONTRACT.privacy).toEqual({
      sponsorSafeAggregatesOnly: true,
      forbiddenContentLeaks: 0,
    });
    expect(DEMO_BATCH_4_CONTRACT.safeguards).toContain("rollback_on_error");
  });
});