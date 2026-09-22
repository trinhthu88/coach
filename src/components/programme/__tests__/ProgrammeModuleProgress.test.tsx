import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/i18n/config";
import { parseProgrammeExperience, type ProgrammeProgressFacts } from "@/lib/programmeProfile";
import { ProgrammeModuleProgress } from "../ProgrammeModuleProgress";

// Exactly the JSON canonical_learning_breakdown returns through
// sponsor_canonical_leader_experience: counts per child type, nothing else.
const experience = parseProgrammeExperience({
  weekly_participation: [],
  coaching_utilisation: null,
  learning_breakdown: [
    { key: "skill_cards", label: "Skill Cards", required_units: 8, due_units: 5, completed_units: 5, overdue_units: 0, progress_available: true, status: "current" },
    { key: "quizzes", label: "Quizzes", required_units: 8, due_units: 5, completed_units: 4, overdue_units: 1, progress_available: true, status: "overdue" },
    { key: "reflections", label: "Reflections", required_units: 8, due_units: 5, completed_units: 5, overdue_units: 0, progress_available: true, status: "current" },
    { key: "daily_prompts", label: "Daily Prompts", required_units: 5, due_units: 5, completed_units: 3, overdue_units: 2, progress_available: true, status: "overdue" },
  ],
});

const facts = {
  coaching_completed_units: 2, coaching_required_units: 4, coaching_due_units: 4,
  training_completed_units: 5, training_required_units: 8, training_due_units: 5,
  peer_completed_units: 0, peer_required_units: 2, peer_due_units: 0,
  mentoring_completed_units: 1, mentoring_required_units: 2, mentoring_due_units: 2,
  triad_completed_units: 0, triad_required_units: 2, triad_due_units: 0,
} as unknown as ProgrammeProgressFacts;

describe("Sponsor Training / Learning breakdown", () => {
  it("shows every configured child type with its own denominator, beside Training = weeks", () => {
    render(<ProgrammeModuleProgress facts={facts} learningBreakdown={experience.learningBreakdown} viewer="sponsor" />);
    const breakdown = screen.getByTestId("learning-breakdown");
    expect(within(breakdown).getByTestId("learning-skill_cards")).toHaveTextContent("5/8");
    expect(within(breakdown).getByTestId("learning-quizzes")).toHaveTextContent("4/8");
    expect(within(breakdown).getByTestId("learning-reflections")).toHaveTextContent("5/8");
    // Five daily prompts exist, so the denominator is five -- never forced to 8.
    expect(within(breakdown).getByTestId("learning-daily_prompts")).toHaveTextContent("3/5");
    expect(within(breakdown).getByTestId("learning-daily_prompts")).toHaveTextContent(/2 overdue/);
  });

  it("a child type the programme does not configure is not shown", () => {
    const withoutPrompts = experience.learningBreakdown.map((i) =>
      i.key === "daily_prompts" ? { ...i, required_units: 0, completed_units: 0, due_units: 0, progress_available: false, status: "unavailable" as const } : i,
    );
    render(<ProgrammeModuleProgress facts={facts} learningBreakdown={withoutPrompts} viewer="sponsor" />);
    expect(screen.queryByTestId("learning-daily_prompts")).not.toBeInTheDocument();
    expect(screen.getByTestId("learning-quizzes")).toBeInTheDocument();
  });

  it.each(["learner", "sponsor"] as const)(
    "uses the same four configured rows and figures for the %s view",
    (viewer) => {
      const { rerender } = render(
        <ProgrammeModuleProgress facts={facts} learningBreakdown={experience.learningBreakdown} viewer={viewer} />,
      );
      const breakdown = screen.getByTestId("learning-breakdown");
      const expected = [
        ["learning-skill_cards", "5/8", "5 units due"],
        ["learning-quizzes", "4/8", "5 units due"],
        ["learning-reflections", "5/8", "5 units due"],
        ["learning-daily_prompts", "3/5", "5 units due"],
      ] as const;

      for (const [testId, ratio, due] of expected) {
        const row = within(breakdown).getByTestId(testId);
        expect(row).toHaveTextContent(ratio);
        expect(row).toHaveTextContent(due);
      }
      expect(within(breakdown).getByTestId("learning-quizzes")).toHaveTextContent("1 overdue");
      expect(within(breakdown).getByTestId("learning-daily_prompts")).toHaveTextContent("2 overdue");

      rerender(<ProgrammeModuleProgress facts={facts} learningBreakdown={experience.learningBreakdown} viewer={viewer === "learner" ? "sponsor" : "learner"} />);
      expect(screen.getByTestId("learning-breakdown")).toHaveTextContent("4/8");
      expect(screen.getByTestId("learning-breakdown")).toHaveTextContent("3/5");
    },
  );
});
