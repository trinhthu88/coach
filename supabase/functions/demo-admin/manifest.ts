export const DEMO_FIXTURE_VERSION = "clariva-live-demo-v1";
export const DEMO_ORGANIZATION_SLUG = "clariva-demo-organization";
export const DEMO_ORGANIZATION_NAME = "Clariva Demo Organization";
export const DEMO_ORGANIZATION_ID = "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01";
export const DEMO_ANCHOR_DATE = "2026-01-05";

// These IDs are part of the fixture contract. Later batches may populate the
// rows, but must not generate a second set of identifiers for the same fixture.
export const DEMO_FIXTURE_IDS = {
  organization: DEMO_ORGANIZATION_ID,
  programmes: {
    A: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0101",
    B: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0102",
    C: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0103",
    D: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2a0104",
  },
  cohorts: {
    A: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0101",
    B: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0102",
    C: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0103",
    D: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2b0104",
  },
  accounts: {
    learnerExecutive: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0101",
    learnerEmerging: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0102",
    coach: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0103",
    sponsor: "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0104",
  },
} as const;

export const DEMO_BATCH_1_CONTRACT = {
  fixtureVersion: DEMO_FIXTURE_VERSION,
  organizationId: DEMO_ORGANIZATION_ID,
  anchorDate: DEMO_ANCHOR_DATE,
  creates: {
    organizations: 1,
    registryRows: 1,
    programmes: 0,
    cohorts: 0,
    accounts: 0,
    leaders: 0,
    activity: 0,
  },
} as const;

export const DEMO_ACCOUNTS = [
  {
    key: "learner-executive",
    label: "Demo Learner — Executive Coaching",
    email: "demo-learner-executive@demo.clariva.club",
    role: "coachee",
  },
  {
    key: "learner-emerging",
    label: "Demo Learner — Emerging Leaders",
    email: "demo-learner-emerging@demo.clariva.club",
    role: "coachee",
  },
  {
    key: "coach",
    label: "Demo Coach",
    email: "demo-coach@demo.clariva.club",
    role: "coach",
  },
  {
    key: "sponsor",
    label: "Demo Sponsor",
    email: "demo-sponsor@demo.clariva.club",
    role: "sponsor",
  },
] as const;

export const DEMO_PROGRAMMES = [
  {
    key: "A",
    name: "Executive Coaching",
    cohortName: "Executive Coaching — Cohort A",
    leaderCount: 8,
    lifecycle: "active",
    modules: ["coaching"],
  },
  {
    key: "B",
    name: "Leadership Development",
    cohortName: "Leadership Development — Cohort B",
    leaderCount: 10,
    lifecycle: "active",
    modules: ["coaching", "mentoring", "triads", "training", "quiz", "daily_prompt", "assessment"],
  },
  {
    key: "C",
    name: "Emerging Leaders",
    cohortName: "Emerging Leaders — Cohort C",
    leaderCount: 12,
    lifecycle: "active",
    modules: ["coaching", "mentoring", "peer_coaching", "triads", "training", "quiz", "daily_prompt", "assessment"],
  },
  {
    key: "D",
    name: "Leadership Excellence",
    cohortName: "Leadership Excellence — Cohort D",
    leaderCount: 10,
    lifecycle: "completed",
    modules: ["coaching", "mentoring", "peer_coaching", "triads", "training", "quiz", "daily_prompt", "assessment"],
  },
] as const;

export const DEMO_LEADER_COUNT = DEMO_PROGRAMMES.reduce((total, programme) => total + programme.leaderCount, 0);

if (
  DEMO_LEADER_COUNT !== 40 ||
  DEMO_ACCOUNTS.length !== 4 ||
  DEMO_FIXTURE_IDS.organization !== DEMO_ORGANIZATION_ID ||
  DEMO_BATCH_1_CONTRACT.anchorDate !== DEMO_ANCHOR_DATE
) {
  throw new Error("Clariva demo manifest does not match the approved portfolio counts");
}