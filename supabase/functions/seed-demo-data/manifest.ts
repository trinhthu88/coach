export const LIVE_DEMO_ORG_ID = "d3000000-0000-4000-8000-000000000001";
export const LIVE_DEMO_VERSION = 1;

export type DemoAccountKind = "learner_a" | "learner_c" | "coach" | "sponsor";

export const DEMO_ACCOUNTS = [
  { kind: "learner_a", email: "learner-a@demo.clariva.club", name: "Demo Learner — Executive Coaching", passwordEnv: "DEMO_LEARNER_A_PASSWORD" },
  { kind: "learner_c", email: "learner-c@demo.clariva.club", name: "Demo Learner — Emerging Leaders", passwordEnv: "DEMO_LEARNER_C_PASSWORD" },
  { kind: "coach", email: "coach@demo.clariva.club", name: "Demo Coach", passwordEnv: "DEMO_COACH_PASSWORD" },
  { kind: "sponsor", email: "sponsor@demo.clariva.club", name: "Demo Sponsor", passwordEnv: "DEMO_SPONSOR_PASSWORD" },
] as const;

type Module = "coaching" | "mentoring" | "peer_coaching" | "triads" | "training" | "quiz" | "daily_prompt";

export const DEMO_PROGRAMMES: ReadonlyArray<{
  code: "A" | "B" | "C" | "D"; name: string; leaderCount: number;
  lifecycle: "active" | "historical"; modules: readonly Module[];
}> = [
  { code: "A", name: "Executive Coaching", leaderCount: 8, lifecycle: "active", modules: ["coaching"] },
  { code: "B", name: "Leadership Development", leaderCount: 10, lifecycle: "active", modules: ["coaching", "mentoring", "triads", "training", "quiz", "daily_prompt"] },
  { code: "C", name: "Emerging Leaders", leaderCount: 12, lifecycle: "active", modules: ["coaching", "mentoring", "peer_coaching", "triads", "training", "quiz", "daily_prompt"] },
  { code: "D", name: "Leadership Excellence", leaderCount: 10, lifecycle: "historical", modules: ["coaching", "mentoring", "peer_coaching", "triads", "training", "quiz", "daily_prompt"] },
] as const;
