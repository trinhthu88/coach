export const DEMO_FIXTURE_VERSION = "clariva-live-demo-v1";
export const DEMO_ORGANIZATION_SLUG = "clariva-demo-organization";
export const DEMO_ORGANIZATION_NAME = "Clariva Demo Organization";
export const DEMO_ORGANIZATION_ID = "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2e7a01";
export const DEMO_ANCHOR_DATE = "2026-01-05";

const leaderIdFor = (serial: number) =>
  `c7f8e4b2-2f34-4a1d-8f6f-d${serial.toString().padStart(11, "0")}`;
const enrollmentIdFor = (serial: number) =>
  `c7f8e4b2-2f34-4a1d-8f6f-e${serial.toString().padStart(11, "0")}`;

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
  leaders: Array.from({ length: 40 }, (_, index) =>
    index === 0
      ? "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0101"
      : index === 18
        ? "c7f8e4b2-2f34-4a1d-8f6f-1f8e8d2c0102"
        : leaderIdFor(index + 1),
  ),
  enrollments: Array.from({ length: 40 }, (_, index) => enrollmentIdFor(index + 1)),
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

const LEADER_NAMES = [
  "Demo Learner — Executive Coaching", "Marcus Lee", "Sofia Nguyen", "Daniel Wong", "Maya Patel", "Ethan Lim", "Chloe Pham", "Noah Chen",
  "Isla Ho", "Julian Park", "Nadia Vo", "Theo Martin", "Amara Singh", "Leo Nguyen", "Mina Le", "Rafael Cruz",
  "Avery Do", "Grace Tan", "Demo Learner — Emerging Leaders", "Caleb Ong", "Hana Bui", "Miles Dao",
  "Elena Pham", "Kai Wong", "Tessa Nguyen", "Arjun Mehta", "Sienna Lim", "Ben Hoang", "Naomi Lee", "Adam Vo",
  "Claire Chen", "Duy Phan", "Ivy Tran", "Samir Khan", "Jade Nguyen", "Finn Le", "Rina Patel", "Luca Ho",
  "Tuan Vo", "Mai Nguyen",
] as const;

export const DEMO_LEADERS = DEMO_PROGRAMMES.flatMap((programme, programmeIndex) =>
  Array.from({ length: programme.leaderCount }, (_, cohortPosition) => {
    const serial = DEMO_PROGRAMMES
      .slice(0, programmeIndex)
      .reduce((total, item) => total + item.leaderCount, 0) + cohortPosition + 1;
    const key = `${programme.key}${String(cohortPosition + 1).padStart(2, "0")}`;
    const userId = DEMO_FIXTURE_IDS.leaders[serial - 1];
    const email = serial === 1
      ? DEMO_ACCOUNTS[0].email
      : serial === 19
        ? DEMO_ACCOUNTS[1].email
        : `demo-leader-${key.toLowerCase()}@demo.clariva.club`;
    return {
      key,
      serial,
      name: LEADER_NAMES[serial - 1],
      email,
      userId,
      programmeKey: programme.key,
      cohortId: DEMO_FIXTURE_IDS.cohorts[programme.key],
      enrollmentId: DEMO_FIXTURE_IDS.enrollments[serial - 1],
    };
  }),
);

export const DEMO_LEADER_COUNT = DEMO_LEADERS.length;

export const DEMO_BATCH_2_CONTRACT = {
  fixtureVersion: DEMO_FIXTURE_VERSION,
  organizationId: DEMO_ORGANIZATION_ID,
  anchorDate: DEMO_ANCHOR_DATE,
  creates: {
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
  },
  cohortDistribution: { A: 8, B: 10, C: 12, D: 10 },
} as const;

export const DEMO_BATCH_3_CONTRACT = {
  fixtureVersion: DEMO_FIXTURE_VERSION,
  organizationId: DEMO_ORGANIZATION_ID,
  anchorDate: DEMO_ANCHOR_DATE,
  historicalCompletedCohort: "D",
  activeCohorts: ["A", "B", "C"],
  paceStates: ["ahead", "on_track", "scheduled", "behind"],
  creates: {
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
  },
  privacy: {
    restrictedTextPolicy: "neutral-fixture-labels-only",
    excluded: [
      "notes",
      "objectives",
      "reflections",
      "written_feedback",
      "comments",
      "files",
      "recordings",
      "transcripts",
      "quiz_detail",
      "assessment_detail",
    ],
  },
} as const;

if (
  DEMO_LEADER_COUNT !== 40 ||
  DEMO_ACCOUNTS.length !== 4 ||
  DEMO_LEADERS.filter((leader) => leader.programmeKey === "A").length !== 8 ||
  DEMO_LEADERS.filter((leader) => leader.programmeKey === "B").length !== 10 ||
  DEMO_LEADERS.filter((leader) => leader.programmeKey === "C").length !== 12 ||
  DEMO_LEADERS.filter((leader) => leader.programmeKey === "D").length !== 10 ||
  DEMO_FIXTURE_IDS.organization !== DEMO_ORGANIZATION_ID ||
  DEMO_BATCH_1_CONTRACT.anchorDate !== DEMO_ANCHOR_DATE ||
  DEMO_BATCH_2_CONTRACT.anchorDate !== DEMO_ANCHOR_DATE ||
  DEMO_BATCH_3_CONTRACT.anchorDate !== DEMO_ANCHOR_DATE ||
  DEMO_BATCH_3_CONTRACT.creates.ownershipResources !== 1746
) {
  throw new Error("Clariva demo manifest does not match the approved portfolio counts");
}