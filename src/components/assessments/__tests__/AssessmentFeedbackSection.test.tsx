import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc,
    storage: { from: () => ({ createSignedUrl: (path: string) => Promise.resolve({ data: { signedUrl: `https://signed/${path}` }, error: null }) }) },
  },
}));

import "@/i18n/config";
import { AssessmentFeedbackSection } from "../AssessmentFeedbackSection";

const FINAL = {
  submission_id: "sub-f", kind: "final_assessment", requirement_id: "req-f", requirement_ordinal: 1, attempt_no: 1,
  submitted_at: "2026-09-20T09:00:00Z", released_at: "2026-10-02T09:00:00Z", viewed_at: null,
  assessor_name: "Coach Anh", review_id: "r-f", feedback_text: "Strong close.", outcome: "pass",
  feedback_files: [{ storage_path: "e/sub-f/feedback.pdf", mime: "application/pdf", size_bytes: 2000 }],
  quiz_correct: 8, quiz_total: 10, quiz_score_pct: 80, pass_mark_pct: 70, quiz_passed: true,
};
const TRIAD = {
  ...FINAL, submission_id: "sub-t", kind: "triad", requirement_id: "req-t", requirement_ordinal: 2, outcome: null,
  feedback_text: "Good questions.", feedback_files: [], quiz_correct: null, quiz_total: null, quiz_score_pct: null,
  pass_mark_pct: null, quiz_passed: null,
  viewed_at: "2026-10-03T09:00:00Z",
};

let feedbackRows: unknown[] = [];
function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AssessmentFeedbackSection enrollmentId="enr-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AssessmentFeedbackSection (My Journey -> Feedback & results)", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation((name: string) => {
      if (name === "learner_assessment_feedback") return Promise.resolve({ data: feedbackRows, error: null });
      if (name === "learner_mark_feedback_viewed") return Promise.resolve({ data: "2026-10-06T00:00:00Z", error: null });
      throw new Error(`unexpected rpc ${name}`);
    });
  });

  it("reads learner_assessment_feedback only and shows the released result, quiz and PDF", async () => {
    feedbackRows = [FINAL, TRIAD];
    renderSection();
    const section = await screen.findByTestId("assessment-feedback-section");
    expect(rpc).toHaveBeenCalledWith("learner_assessment_feedback", { p_enrollment_id: "enr-1" });
    const cards = within(section).getAllByTestId("assessment-feedback-card");
    expect(cards[0]).toHaveTextContent("Final Assessment result");
    fireEvent.click(within(cards[0]).getByRole("button", { name: "Open feedback" }));
    await waitFor(() =>
      expect(new Set(rpc.mock.calls.map(([name]) => name))).toEqual(new Set(["learner_assessment_feedback", "learner_mark_feedback_viewed"])),
    );
    expect(within(cards[0]).getByTestId("assessment-feedback-outcome")).toHaveTextContent("Pass");
    expect(within(cards[0]).getByTestId("assessment-feedback-quiz")).toHaveTextContent("8 of 10 correct (80%)");
    expect(within(cards[0]).getByTestId("assessment-feedback-pass-mark")).toHaveTextContent("at or above the 70% pass mark");
    expect(await within(cards[0]).findByRole("link", { name: "Feedback PDF" })).toHaveAttribute("href", "https://signed/e/sub-f/feedback.pdf");
    expect(cards[1]).toHaveTextContent("Feedback on Triad 2");
    expect(within(cards[1]).queryByTestId("assessment-feedback-outcome")).toBeNull();
  });

  it("says when the released quiz score is below the pass mark", async () => {
    feedbackRows = [{ ...FINAL, quiz_correct: 5, quiz_score_pct: 50, quiz_passed: false, viewed_at: "2026-10-03T09:00:00Z" }];
    renderSection();
    const card = await screen.findByTestId("assessment-feedback-card");
    expect(within(card).getByTestId("assessment-feedback-pass-mark")).toHaveTextContent("below the 70% pass mark");
  });

  it("records the first view when unseen feedback is opened, not when it renders", async () => {
    feedbackRows = [FINAL, TRIAD];
    renderSection();
    const cards = await screen.findAllByTestId("assessment-feedback-card");
    // Unseen feedback shows its heading only; seen feedback stays open.
    expect(within(cards[0]).queryByTestId("assessment-feedback-body")).toBeNull();
    expect(within(cards[1]).getByTestId("assessment-feedback-body")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalledWith("learner_mark_feedback_viewed", expect.anything());
    fireEvent.click(within(cards[0]).getByRole("button", { name: "Open feedback" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("learner_mark_feedback_viewed", { p_submission_id: "sub-f" }));
    expect(rpc).not.toHaveBeenCalledWith("learner_mark_feedback_viewed", { p_submission_id: "sub-t" });
  });

  it("renders nothing when nothing has been released", async () => {
    feedbackRows = [];
    const { container } = renderSection();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
