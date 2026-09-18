import type { LearnerCanonicalProgress } from "@/hooks/useLearnerCanonicalProgress";
import type { SponsorLeaderProfileData } from "@/hooks/sponsor/useSponsorLeaderData";
import type { ProgrammeEngagementFacts, ProgrammeExperience, ProgrammeJourneyPoint } from "@/lib/programmeProfile";

/**
 * One enrollment, as the canonical backend returns it — the seeded
 * "Training / Learning partially complete" case (Skill Cards 5/6). The
 * learner RPCs (learner_canonical_*) and the sponsor RPCs
 * (sponsor_canonical_*) return these same values for the same enrollment
 * (proven in supabase/tests/learner_canonical_self_view_test.sql and
 * canonical_enrollment_engagement_test.sql); the UI tests below feed each
 * surface its own RPC shape built from this single source.
 */
export const ENROLLMENT_ID = "enrollment-seeded-partial";

export const canonicalProgress: LearnerCanonicalProgress = {
  enrollment_id: ENROLLMENT_ID,
  learner_display_name: "Jamie Learner",
  programme_label: "Leadership Accelerator",
  cohort_id: "cohort-1",
  cohort_label: "Spring cohort",
  programme_id: "programme-1",
  enrollment_start_date: "2026-01-01",
  enrollment_end_date: "2026-06-30",
  programme_start_date: "2026-01-01",
  programme_end_date: "2026-06-30",
  enrollment_status: "active",
  stored_enrollment_status: "active",
  effective_enrollment_status: "active",
  required_units: 16,
  completed_units: 14,
  due_units: 15,
  booked_units: 1,
  overdue_units: 1,
  full_completion_pct: 87.5,
  due_adherence_pct: 93.3,
  pace_status: "behind",
  progress_available: true,
  coaching_required_units: 4,
  coaching_completed_units: 4,
  coaching_due_units: 4,
  coaching_booked_units: 0,
  training_required_units: 6,
  training_completed_units: 5,
  training_due_units: 6,
  training_booked_units: 0,
  peer_required_units: 2,
  peer_completed_units: 2,
  peer_due_units: 2,
  peer_booked_units: 0,
  mentoring_required_units: 2,
  mentoring_completed_units: 2,
  mentoring_due_units: 2,
  mentoring_booked_units: 0,
  triad_required_units: 2,
  triad_completed_units: 1,
  triad_due_units: 1,
  triad_booked_units: 1,
};

export const canonicalEngagement: ProgrammeEngagementFacts = {
  goal_count: 2,
  goal_progress_pct: 55,
  open_action_count: 2,
  completed_action_count: 1,
  total_action_count: 3,
  satisfaction_avg: 4.5,
  satisfaction_rated_count: 4,
};

export const canonicalJourney: ProgrammeJourneyPoint[] = [
  { checkpoint_number: 1, due_on: "2026-01-05", label: "Week 1", module_scope: ["training"], required_units: 1, completed_units: 0, state: "overdue" },
  { checkpoint_number: 2, due_on: "2026-01-12", label: "Week 2", module_scope: ["training"], required_units: 2, completed_units: 0, state: "overdue" },
  { checkpoint_number: 3, due_on: "2026-01-19", label: "Week 3", module_scope: ["training"], required_units: 3, completed_units: 3, state: "completed" },
  { checkpoint_number: 4, due_on: "2026-02-02", label: "Week 5", module_scope: ["coaching", "training"], required_units: 6, completed_units: 6, state: "completed" },
  { checkpoint_number: 5, due_on: "2026-03-02", label: "Week 9", module_scope: ["mentoring", "peer_coaching", "training"], required_units: 12, completed_units: 11, state: "current" },
  { checkpoint_number: 6, due_on: "2026-04-06", label: "Week 14", module_scope: ["triads", "training"], required_units: 16, completed_units: 14, state: "upcoming" },
];

export const canonicalExperience: ProgrammeExperience = {
  weeklyParticipation: [],
  learningBreakdown: [
    { key: "skill_cards", label: "Skill Cards", required_units: 6, due_units: 6, completed_units: 5, progress_available: true, status: "overdue" },
    { key: "quizzes", label: "Quizzes", required_units: 0, due_units: 0, completed_units: 0, progress_available: false, status: "unavailable" },
    { key: "reflections", label: "Reflections", required_units: 0, due_units: 0, completed_units: 0, progress_available: false, status: "unavailable" },
    { key: "daily_prompts", label: "Daily Prompts", required_units: 0, due_units: 0, completed_units: 0, progress_available: false, status: "unavailable" },
  ],
  coachingUtilisation: { required_units: 4, completed_units: 4, due_units: 4, booked_units: 0, utilisation_pct: 100, next_session_at: null },
};

/** sponsor_canonical_enrollment_metadata row for the same enrollment (progress + shared engagement). */
export const sponsorLeaderRow = {
  ...canonicalProgress,
  ...canonicalEngagement,
  goal_setup: true,
  action_completion_pct: 33.3,
} as unknown as SponsorLeaderProfileData;
