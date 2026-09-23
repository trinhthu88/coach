import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  quizSubmitted: false,
  reflectionSubmitted: false,
}));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: () => ({ selectedEnrollment: { id: "enr-1" } }),
}));
vi.mock("@/components/training/WeekDailyPrompts", () => ({ WeekDailyPrompts: () => null }));
vi.mock("@/hooks/training/useSkillCard", () => ({
  useSkillCard: () => ({
    week: {
      id: "w1", week_number: 1, programme_id: "prog-1", title: "Leadership basics", title_vi: null,
      subtitle: null, subtitle_vi: null, skill_card_html: "<p>Skill card body</p>", skill_card_html_vi: null,
      skill_card_visible: true, video_url: null, pdf_storage_path: null, pdf_storage_path_vi: null,
    },
    progress: null, loading: false, completing: false, markComplete: vi.fn(), downloadPdf: vi.fn(),
  }),
}));
vi.mock("@/hooks/training/useAssignments", () => ({
  useAssignments: () => ({
    loading: false,
    assignments: [{
      id: "quiz-1", assignment_type: "quiz", title: "Knowledge check", title_vi: null, sort_order: 1,
      submitted: state.quizSubmitted, score_pct: state.quizSubmitted ? 67 : null,
    }],
  }),
}));
vi.mock("@/hooks/training/useReflections", () => ({
  useWeekReflection: () => ({
    loading: false,
    reflection: { id: "r1", title: "Reflection: Leadership basics", title_vi: null },
    submission: state.reflectionSubmitted ? { id: "s1" } : null,
  }),
}));
vi.mock("@/hooks/training/useQuiz", () => ({
  useQuiz: () => ({
    loading: false, submitting: false, submit: vi.fn(),
    assignment: { id: "quiz-1", training_week_id: "w1", title: "Knowledge check", title_vi: null, instructions: null, instructions_vi: null },
    questions: [{
      id: "q1", question_text: "What changes first?", question_text_vi: null, sort_order: 1,
      explanation: "Results come through other people.", explanation_vi: null,
      options: [
        { id: "a", text: "Working longer hours", is_correct: false },
        { id: "b", text: "Results come through other people", is_correct: true },
      ],
    }],
    submission: state.quizSubmitted ? { answers: { q1: "a" }, score_pct: 0, correct_count: 0, total_count: 1 } : null,
  }),
}));

import "@/i18n/config";
import SkillCardView from "../SkillCardView";
import QuizView from "../QuizView";
import { MODULE_TYPES } from "../admin/AdminProgrammes";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/training/:weekId" element={<SkillCardView />} />
        <Route path="/training/:weekId/quiz/:assignmentId" element={<QuizView />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Skill Card -> Quiz -> Reflection", () => {
  beforeEach(() => {
    state.quizSubmitted = false;
    state.reflectionSubmitted = false;
  });

  it("the Skill Card ends with Take the Quiz and Write your Reflection", () => {
    renderAt("/training/w1");
    expect(screen.getByTestId("skill-card-quiz-link")).toHaveTextContent("Take the Quiz");
    expect(screen.getByTestId("skill-card-quiz-link")).toHaveAttribute("href", "/training/w1/quiz/quiz-1");
    expect(screen.getByTestId("skill-card-reflection-link")).toHaveTextContent("Write your Reflection");
    expect(screen.getByTestId("skill-card-reflection-link")).toHaveAttribute("href", "/training/w1/reflect");
  });

  it("both links stay once done, leading to the learner's own answers", () => {
    state.quizSubmitted = true;
    state.reflectionSubmitted = true;
    renderAt("/training/w1");
    expect(screen.getByTestId("skill-card-quiz-link")).toHaveTextContent("Review your answers");
    expect(screen.getByTestId("skill-card-quiz-link")).toHaveAttribute("href", "/training/w1/quiz/quiz-1");
    expect(screen.getByTestId("skill-card-reflection-link")).toHaveTextContent("Review your reflection");
  });

  it("a completed quiz opens read-only: the learner's answer and the correct one", () => {
    state.quizSubmitted = true;
    renderAt("/training/w1/quiz/quiz-1");
    const review = screen.getByTestId("quiz-review");
    expect(review).toHaveTextContent("Review your answers");
    expect(within(review).getByText(/Working longer hours/)).toHaveTextContent("Incorrect");
    expect(within(review).getByText(/Results come through other people —/)).toHaveTextContent("Correct");
    expect(screen.queryByRole("button", { name: "Submit quiz" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("Admin programme modules", () => {
  it("offers no separate Quiz or Daily Prompt module: they belong to each Training week", () => {
    expect(MODULE_TYPES).toContain("training");
    expect(MODULE_TYPES).not.toContain("quiz");
    expect(MODULE_TYPES).not.toContain("daily_prompt");
  });
});
