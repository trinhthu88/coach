import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import "@/i18n/config";
import {
  AdminFinalAssessmentDetail,
  LearnerFinalAssessmentSection,
  SponsorFinalAssessmentSection,
} from "../FinalAssessmentResults";
import type { AdminFinalAssessment } from "@/hooks/assessments/useFinalAssessmentResult";

function learnerRow(over: Record<string, unknown> = {}) {
  return {
    requirement_id: "req-f", due_on: "2026-11-30", instructions: null, instructions_vi: null, transcript_mode: "optional",
    max_file_mb: 50, quiz_enabled: true, quiz_question_count: 10, attempt_no: 1, state: "under_review", quiz_taken: true,
    quiz_submission_id: "q1", submission_id: "s1", submitted_at: "2026-10-01T09:00:00Z", released_at: null,
    quiz_correct: null, quiz_total: null, quiz_score_pct: null, pass_mark_pct: null, quiz_passed: null,
    final_result: null, can_resubmit: false,
    ...over,
  };
}

let rows: Record<string, unknown[]> = {};
function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rows = {};
  rpc.mockReset();
  rpc.mockImplementation((name: string) => Promise.resolve({ data: rows[name] ?? [], error: null }));
});

describe("Learner My Journey: Final Assessment", () => {
  it("under review: the state, and no quiz score before release", async () => {
    rows.learner_final_assessment = [learnerRow()];
    renderWith(<LearnerFinalAssessmentSection enrollmentId="enr-1" />);
    expect(await screen.findByTestId("final-assessment-state")).toHaveTextContent("Under review");
    expect(rpc).toHaveBeenCalledWith("learner_final_assessment", { p_enrollment_id: "enr-1" });
    expect(screen.queryByTestId("final-assessment-quiz")).toBeNull();
    expect(screen.queryByTestId("final-assessment-result")).toBeNull();
  });

  it("released: the result and the quiz score against the pass mark", async () => {
    rows.learner_final_assessment = [
      learnerRow({ state: "completed", final_result: "not_pass", released_at: "2026-10-05T09:00:00Z", quiz_correct: 6, quiz_total: 10, quiz_score_pct: 60, pass_mark_pct: 70, quiz_passed: false }),
    ];
    renderWith(<LearnerFinalAssessmentSection enrollmentId="enr-1" />);
    expect(await screen.findByTestId("final-assessment-result")).toHaveTextContent("Not pass");
    expect(screen.getByTestId("final-assessment-quiz")).toHaveTextContent("6 of 10 correct (60%) · below the 70% pass mark");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/final-assessment");
  });

  it("renders nothing for a programme without a Final Assessment", async () => {
    const { container } = renderWith(<LearnerFinalAssessmentSection enrollmentId="enr-1" />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Admin enrollment detail: Final Assessment", () => {
  const fa: AdminFinalAssessment = {
    state: "resubmit_requested", attemptNo: 2, dueOn: "2026-11-30", submittedAt: null, releasedAt: "2026-10-04T09:00:00Z",
    quizCorrect: null, quizTotal: null, quizScorePct: null, passMarkPct: 70, quizPassed: null, outcome: "resubmit", finalResult: null,
  };
  it("shows the state, the attempt, the assessor's outcome and the quiz against the pass mark", () => {
    renderWith(
      <AdminFinalAssessmentDetail
        fa={{ ...fa, state: "completed", attemptNo: 2, outcome: "pass", finalResult: "pass", quizCorrect: 9, quizTotal: 10, quizScorePct: 90, quizPassed: true }}
      />,
    );
    expect(screen.getByTestId("final-assessment-state")).toHaveTextContent("Result released");
    expect(screen.getByText("Attempt 2 of 2")).toBeInTheDocument();
    expect(screen.getByTestId("final-assessment-outcome")).toHaveTextContent("Pass");
    expect(screen.getByTestId("final-assessment-quiz")).toHaveTextContent("9 of 10 correct (90%) · at or above the 70% pass mark");
  });
  it("Resubmit is visible to Admin as Resubmission requested", () => {
    renderWith(<AdminFinalAssessmentDetail fa={fa} />);
    expect(screen.getByTestId("final-assessment-state")).toHaveTextContent("Resubmission requested");
    expect(screen.getByTestId("final-assessment-outcome")).toHaveTextContent("Resubmit");
    expect(screen.getByTestId("final-assessment-result")).toHaveTextContent("—");
  });
});

describe("Sponsor leader detail: Final Assessment", () => {
  it("reads only sponsor_final_assessment_status: Under review, no result", async () => {
    rows.sponsor_final_assessment_status = [{ status: "under_review", result: null }];
    renderWith(<SponsorFinalAssessmentSection enrollmentId="enr-1" />);
    expect(await screen.findByTestId("final-assessment-state")).toHaveTextContent("Under review");
    expect(screen.queryByTestId("final-assessment-result")).toBeNull();
    expect(new Set(rpc.mock.calls.map(([name]) => name))).toEqual(new Set(["sponsor_final_assessment_status"]));
  });
  it("Completed with Pass / Not pass only: no quiz, no outcome detail", async () => {
    rows.sponsor_final_assessment_status = [{ status: "completed", result: "pass" }];
    renderWith(<SponsorFinalAssessmentSection enrollmentId="enr-1" />);
    expect(await screen.findByTestId("final-assessment-result")).toHaveTextContent("Result: Pass");
    expect(screen.getByTestId("final-assessment-state")).toHaveTextContent("Completed");
    expect(screen.queryByTestId("final-assessment-quiz")).toBeNull();
    expect(screen.getByTestId("sponsor-final-assessment")).not.toHaveTextContent(/%|Resubmit|attempt/i);
  });
  it("renders nothing when the leader's programme has no Final Assessment", async () => {
    const { container } = renderWith(<SponsorFinalAssessmentSection enrollmentId="enr-1" />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
