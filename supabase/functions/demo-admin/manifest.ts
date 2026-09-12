export const DEMO_FIXTURE_VERSION = "clariva-live-demo-v1";
export const DEMO_ORGANIZATION_SLUG = "clariva-demo-organization";
export const DEMO_ORGANIZATION_NAME = "Clariva Demo Organization";

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

if (DEMO_LEADER_COUNT !== 40 || DEMO_ACCOUNTS.length !== 4) {
  throw new Error("Clariva demo manifest does not match the approved portfolio counts");
}