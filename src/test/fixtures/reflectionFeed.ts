import type { LearnerReflection } from "@/hooks/journey/useLearnerReflectionFeed";

const base = {
  details: {},
  rating: null,
  previousRating: null,
  linkedSessionTable: null,
  linkedSessionId: null,
  linkedGoalId: null,
  linkedActivityId: null,
  isPrivate: false,
  module: null,
  title: null,
} satisfies Partial<LearnerReflection>;

/** One learner_reflection_feed row per source, as the RPC returns them (newest first). */
export const reflectionFeedFixture: LearnerReflection[] = [
  { ...base, key: "journey_reflection:j1", sourceType: "journey_reflection", sourceTable: "coachee_reflections", sourceId: "j1", occurredAt: "2026-03-10T09:00:00Z", body: "Journey reflection: proud of this week.", details: { mood: "proud" }, isPrivate: true },
  { ...base, key: "goal_checkin:c1", sourceType: "goal_checkin", sourceTable: "goal_checkins", sourceId: "c1", occurredAt: "2026-03-09T09:00:00Z", title: "Lead weekly one-to-ones", body: "Goal check-in: I noticed that I delegate more.", rating: 8, previousRating: 7, linkedGoalId: "goal-1", linkedSessionTable: "sessions", linkedSessionId: "s2" },
  { ...base, key: "triad_reflection:tr1", sourceType: "triad_reflection", sourceTable: "triad_reflections", sourceId: "tr1", module: "triads", occurredAt: "2026-03-08T09:00:00Z", body: "Triad reflection: silence is useful.", details: { learned_as_coach: "Triad reflection: silence is useful.", round_number: 1 }, rating: 4, linkedSessionTable: "triad_sessions", linkedSessionId: "t1" },
  { ...base, key: "mentoring_session_reflection:m1", sourceType: "mentoring_session_reflection", sourceTable: "mentoring_sessions", sourceId: "m1", module: "mentoring", occurredAt: "2026-03-07T09:00:00Z", title: "Career mapping", body: "Mentoring reflection: map stakeholders earlier.", linkedSessionTable: "mentoring_sessions", linkedSessionId: "m1" },
  { ...base, key: "peer_session_reflection:p1", sourceType: "peer_session_reflection", sourceTable: "coachee_peer_sessions", sourceId: "p1", module: "peer_coaching", occurredAt: "2026-03-06T09:00:00Z", title: "Practice", body: "Peer reflection: open questions helped.", linkedSessionTable: "coachee_peer_sessions", linkedSessionId: "p1" },
  { ...base, key: "training_reflection:r1", sourceType: "training_reflection", sourceTable: "reflection_submissions", sourceId: "r1", module: "training", occurredAt: "2026-03-05T09:00:00Z", title: "Week one reflection", body: "Training reflection: I tried pausing.", details: { answers: [{ question: "What did you try?", answer: "Training reflection: I tried pausing." }] } },
  { ...base, key: "coaching_session_reflection:s1", sourceType: "coaching_session_reflection", sourceTable: "sessions", sourceId: "s1", module: "coaching", occurredAt: "2026-03-04T09:00:00Z", title: "Delegation", body: "Coaching reflection: I interrupt when anxious.", linkedSessionTable: "sessions", linkedSessionId: "s1" },
];
