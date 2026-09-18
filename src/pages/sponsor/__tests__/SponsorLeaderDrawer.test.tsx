import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@/i18n/config";
import i18n from "@/i18n/config";
import { SponsorLeaderDrawer, SponsorLeaderProfile } from "../SponsorLeaderDrawer";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";

const leader = {
  enrollment_id: "enrollment-1",
  learner_display_name: "Priya Shah",
  programme_label: "Executive Coaching",
  cohort_id: "cohort-1",
  cohort_label: "Leadership cohort",
  enrollment_status: "active",
  enrollment_start_date: "2026-01-01",
  enrollment_end_date: "2026-12-31",
  required_units: 24,
  completed_units: 12,
  due_units: 12,
  booked_units: 2,
  overdue_units: 0,
  full_completion_pct: 50,
  due_adherence_pct: 100,
  schedule_coverage_pct: 100,
  pace_status: "on_track",
  coaching_completed_count: 5,
  mentoring_completed_count: 2,
  peer_completed_count: 1,
  triad_completed_count: 0,
  goal_count: 2,
  goal_setup: true,
  goal_progress_pct: 68,
  open_action_count: 1,
  total_action_count: 3,
  completed_action_count: 2,
  action_completion_pct: 66.7,
  satisfaction_avg: 4.4,
  satisfaction_rated_count: 4,
} as unknown as SponsorRosterRow;

describe("SponsorLeaderDrawer", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders the sponsor-safe leader detail hierarchy without private content", () => {
    render(<SponsorLeaderDrawer leader={leader} onClose={() => undefined} />);

    expect(screen.getByText("Priya Shah")).toBeInTheDocument();
    expect(screen.getByText("At a glance")).toBeInTheDocument();
    expect(screen.getByText("Programme journey")).toBeInTheDocument();
    expect(screen.getByText("Participation & activity")).toBeInTheDocument();
    expect(screen.getByText("Attention items")).toBeInTheDocument();
    expect(screen.getByText("This is everything you can see")).toBeInTheDocument();
    expect(screen.queryByText("A confidential coaching note")).not.toBeInTheDocument();
    expect(screen.queryByText("Priya's private goal wording")).not.toBeInTheDocument();
  });

  it("renders the enrollment-scoped journey, checkpoint trend, and learning breakdown", () => {
    render(
      <SponsorLeaderProfile
        leader={{
          ...leader,
          required_units: 16,
          completed_units: 9,
          due_units: 16,
          overdue_units: 7,
          coaching_required_units: 8,
          coaching_completed_units: 5,
          coaching_due_units: 8,
          training_required_units: 4,
          training_completed_units: 3,
          training_due_units: 4,
          peer_required_units: 2,
          peer_completed_units: 1,
          peer_due_units: 2,
          mentoring_required_units: 1,
          mentoring_completed_units: 0,
          mentoring_due_units: 1,
          triad_required_units: 1,
          triad_completed_units: 0,
          triad_due_units: 1,
        }}
        onBack={() => undefined}
        journey={[
          {
            checkpoint_number: 1,
            due_on: "2026-04-01",
            label: "Coaching checkpoint",
            module_scope: ["coaching"],
            required_units: 8,
            completed_units: 5,
            state: "overdue",
          },
          {
            checkpoint_number: 2,
            due_on: "2026-05-01",
            label: "Practice checkpoint",
            module_scope: ["training", "peer_coaching"],
            required_units: 16,
            completed_units: 9,
            state: "current",
          },
        ]}
        experience={{
          weeklyParticipation: [{
            week_number: 2,
            week_start: "2026-04-27",
            week_end: "2026-05-03",
            required_units: 2,
            due_units: 2,
            completed_units: 1,
            activity_units: 1,
            state: "current",
            is_current: true,
          }],
          learningBreakdown: [{
            key: "quizzes",
            label: "Quizzes",
            required_units: 2,
            due_units: 1,
            completed_units: 1,
            progress_available: true,
            status: "current",
          }, {
            key: "reflections",
            label: "Reflections",
            required_units: 1,
            due_units: 1,
            completed_units: 0,
            progress_available: true,
            status: "overdue",
          }, {
            key: "skill_cards",
            label: "Skill Cards",
            required_units: 1,
            due_units: 1,
            completed_units: 1,
            progress_available: true,
            status: "completed",
          }, {
            key: "daily_prompts",
            label: "Daily Prompts",
            required_units: 0,
            due_units: 0,
            completed_units: 0,
            progress_available: false,
            status: "unavailable",
          }],
          coachingUtilisation: {
            required_units: 4,
            completed_units: 2,
            due_units: 2,
            booked_units: 1,
            utilisation_pct: 50,
            next_session_at: null,
          },
        }}
      />
    );

    expect(screen.getAllByText("Checkpoint 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Checkpoint 2").length).toBeGreaterThan(0);
    expect(screen.queryByText("Coaching checkpoint")).not.toBeInTheDocument();
    expect(screen.queryByText("Practice checkpoint")).not.toBeInTheDocument();
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(screen.getByText("Required activities")).toBeInTheDocument();
    expect(screen.getByText("Overdue required")).toBeInTheDocument();
    expect(screen.getByText("Coaching utilisation")).toBeInTheDocument();
    expect(screen.getByText("Completed required activities")).toBeInTheDocument();
    expect(screen.getAllByText("9 / 16").length).toBeGreaterThan(0);
    expect(screen.getByText("You are here")).toBeInTheDocument();
    expect(screen.getByText("Training & learning")).toBeInTheDocument();
    expect(screen.getByText("Skill Cards")).toBeInTheDocument();
    expect(screen.getByText("Quizzes")).toBeInTheDocument();
    expect(screen.getByText("Reflections")).toBeInTheDocument();
    expect(screen.queryByText("Daily Prompts")).not.toBeInTheDocument();
    expect(screen.getByLabelText("CP1: 63%")).toBeInTheDocument();
    expect(screen.getByLabelText("CP2: 56%")).toBeInTheDocument();
    expect(screen.getAllByText("50%").length).toBeGreaterThan(0);
  });
});