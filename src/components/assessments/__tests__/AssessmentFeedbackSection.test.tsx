import { render, screen, waitFor, within } from "@testing-library/react";
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
  quiz_correct: 8, quiz_total: 10, quiz_score_pct: 80,
};
const TRIAD = {
  ...FINAL, submission_id: "sub-t", kind: "triad", requirement_id: "req-t", requirement_ordinal: 2, outcome: null,
  feedback_text: "Good questions.", feedback_files: [], quiz_correct: null, quiz_total: null, quiz_score_pct: null,
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
    expect(new Set(rpc.mock.calls.map(([name]) => name))).toEqual(new Set(["learner_assessment_feedback", "learner_mark_feedback_viewed"]));
    const cards = within(section).getAllByTestId("assessment-feedback-card");
    expect(cards[0]).toHaveTextContent("Final Assessment result");
    expect(within(cards[0]).getByTestId("assessment-feedback-outcome")).toHaveTextContent("Pass");
    expect(within(cards[0]).getByTestId("assessment-feedback-quiz")).toHaveTextContent("8 of 10 correct (80%)");
    expect(await within(cards[0]).findByRole("link", { name: "Feedback PDF" })).toHaveAttribute("href", "https://signed/e/sub-f/feedback.pdf");
    expect(cards[1]).toHaveTextContent("Feedback on Triad 2");
    expect(within(cards[1]).queryByTestId("assessment-feedback-outcome")).toBeNull();
  });

  it("records the first view of unseen feedback only", async () => {
    feedbackRows = [FINAL, TRIAD];
    renderSection();
    await screen.findByTestId("assessment-feedback-section");
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
