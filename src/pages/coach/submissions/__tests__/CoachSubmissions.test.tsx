import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, upload, remove, toastError, toastSuccess } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
// Signed URL lifetimes, by storage path.
const signedFor = vi.hoisted(() => new Map<string, number>());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc,
    storage: {
      from: () => ({
        upload,
        remove,
        createSignedUrl: (path: string, expiresIn: number) => {
          signedFor.set(path, expiresIn);
          return Promise.resolve({ data: { signedUrl: `https://signed/${path}` }, error: null });
        },
      }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));

import "@/i18n/config";
import CoachSubmissions from "../CoachSubmissions";
import CoachSubmissionDetail from "../CoachSubmissionDetail";
import { SubmissionsToAssessCard } from "@/pages/dashboard/cards/SubmissionsToAssessCard";

function inboxRow(over: Record<string, unknown>) {
  return {
    submission_id: "s", enrollment_id: "enr-1", inbox_tab: "to_assess", kind: "triad", cohort_id: "c1", cohort_name: "Cohort One",
    learner_name: "Learner", requirement_ordinal: 1, attempt_no: 1, status: "with_assessor", submitted_at: "2026-10-01T09:00:00Z",
    assigned_at: "2026-10-02T09:00:00Z", due_on: "2026-10-09", is_overdue: false, triad_reflection_id: null, reflection: null,
    transcript_text: null, quiz_correct: null, quiz_total: null, quiz_score_pct: null, learner_files: [], return_reason: null,
    my_latest_review_version: null, my_latest_feedback_text: null, my_latest_outcome: null, released_at: null,
    ...over,
  };
}

const TRIAD = inboxRow({
  submission_id: "s-triad", learner_name: "Linh Tran", triad_reflection_id: "refl-1",
  reflection: {
    submitted_at: "2026-10-01T09:00:00Z",
    answers: [
      { question_id: "q1", question_key: "learned_coach", section: "coach", question: "What did you learn as Coach?", question_vi: null, answer: "Ask, then listen." },
      { question_id: "q2", question_key: "overall", section: "general", question: "What will you try next?", question_vi: null, answer: "Shorter questions." },
    ],
  },
});
const FINAL_RETURNED = inboxRow({
  submission_id: "s-final", learner_name: "Minh Vo", kind: "final_assessment", cohort_id: "c2", cohort_name: "Cohort Two",
  inbox_tab: "returned", status: "returned", attempt_no: 2, is_overdue: true, due_on: "2026-10-01",
  transcript_text: "Coach: What would make today useful?",
  quiz_correct: 7, quiz_total: 10, quiz_score_pct: 70,
  learner_files: [{ storage_path: "enr-2/s-final/session.mp3", file_kind: "recording", mime: "audio/mpeg", size_bytes: 40000000, duration_seconds: 1500 }],
  return_reason: "Please reference one ICF competency.",
  my_latest_review_version: 1, my_latest_feedback_text: "Solid session.", my_latest_outcome: "pass",
  enrollment_id: "enr-2",
});
const WAITING = inboxRow({ submission_id: "s-wait", learner_name: "Hoa Le", inbox_tab: "awaiting_validation", status: "awaiting_validation" });
const RELEASED = inboxRow({ submission_id: "s-rel", learner_name: "Quang Do", inbox_tab: "released", status: "released", due_on: null, released_at: "2026-09-30T09:00:00Z" });

let inbox: unknown[] = [];

function renderAt(path: string, element: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/coach/submissions" element={<CoachSubmissions />} />
          <Route path="/coach/submissions/:submissionId" element={<CoachSubmissionDetail />} />
          <Route path="/dashboard" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  inbox = [TRIAD, FINAL_RETURNED, WAITING, RELEASED];
  rpc.mockReset();
  upload.mockReset().mockResolvedValue({ data: {}, error: null });
  remove.mockReset().mockResolvedValue({ data: [], error: null });
  toastError.mockReset();
  toastSuccess.mockReset();
  rpc.mockImplementation((name: string) => {
    if (name === "coach_assessment_inbox") return Promise.resolve({ data: inbox, error: null });
    if (name === "coach_submit_review") return Promise.resolve({ data: "review-2", error: null });
    throw new Error(`unexpected rpc ${name}`);
  });
});

describe("Coach -> Submissions", () => {
  it("splits the inbox into the four tabs, with counts", async () => {
    renderAt("/coach/submissions", null);
    const rows = await screen.findAllByTestId("coach-submission-row");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Linh Tran · Triad 1")]);
    expect(screen.getByTestId("coach-submissions-tab-to_assess")).toHaveTextContent("To assess (1)");
    expect(screen.getByTestId("coach-submissions-tab-returned")).toHaveTextContent("Returned to me (1)");
    expect(screen.getByTestId("coach-submissions-tab-awaiting_validation")).toHaveTextContent("Awaiting validation (1)");
    expect(screen.getByTestId("coach-submissions-tab-released")).toHaveTextContent("Released (1)");
  });

  it("opens a tab from the URL and filters by cohort and kind", async () => {
    renderAt("/coach/submissions?tab=returned", null);
    expect((await screen.findAllByTestId("coach-submission-row"))[0]).toHaveTextContent("Minh Vo · Final Assessment (attempt 2)");
    const [cohort, kind] = screen.getAllByRole("combobox");
    fireEvent.change(kind, { target: { value: "triad" } });
    expect(screen.getByTestId("coach-submissions-empty")).toHaveTextContent("No reviews have been returned to you.");
    expect(screen.getByTestId("coach-submissions-tab-to_assess")).toHaveTextContent("To assess (1)");
    fireEvent.change(kind, { target: { value: "all" } });
    fireEvent.change(cohort, { target: { value: "c1" } });
    expect(screen.getByTestId("coach-submissions-tab-returned")).toHaveTextContent("Returned to me (0)");
  });
});

describe("Coach -> Submission detail", () => {
  it("a Triad shows the reflection answers and sends feedback through coach_submit_review", async () => {
    renderAt("/coach/submissions/s-triad", null);
    const reflection = await screen.findByTestId("coach-submission-reflection");
    expect(reflection).toHaveTextContent("As Coach");
    expect(reflection).toHaveTextContent("What did you learn as Coach?");
    expect(reflection).toHaveTextContent("Ask, then listen.");
    expect(reflection).toHaveTextContent("Overall");
    // A Triad review gives feedback only: no result to choose.
    expect(screen.queryByTestId("coach-review-outcome")).toBeNull();
    expect(screen.getByTestId("coach-review-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("coach-review-text"), { target: { value: " Name the moment that shifted. " } });
    fireEvent.click(screen.getByTestId("coach-review-submit"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("coach_submit_review", {
        p_submission_id: "s-triad",
        p_feedback_text: "Name the moment that shifted.",
        p_outcome: undefined,
        p_files: [],
      }),
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it("a returned Final Assessment shows Admin's reason, the MP3, transcript and read-only quiz", async () => {
    renderAt("/coach/submissions/s-final", null);
    expect(await screen.findByTestId("coach-submission-return-reason")).toHaveTextContent("Please reference one ICF competency.");
    expect(await screen.findByTestId("coach-submission-audio")).toHaveAttribute("src", "https://signed/enr-2/s-final/session.mp3");
    // The link lasts the 25-minute recording plus a 30-minute margin, not five minutes.
    expect(signedFor.get("enr-2/s-final/session.mp3")).toBe(1500 + 30 * 60);
    expect(screen.getByTestId("coach-submission-transcript")).toHaveTextContent("What would make today useful?");
    expect(screen.getByTestId("coach-submission-quiz")).toHaveTextContent("7 of 10 correct (70%)");
    expect(within(screen.getByTestId("coach-submission-quiz")).queryByRole("textbox")).toBeNull();
    // Starts from the assessor's last version.
    expect(screen.getByTestId("coach-review-text")).toHaveValue("Solid session.");
    // Attempt 2 is the last: Resubmit cannot be chosen.
    expect(screen.getByRole("radio", { name: "Resubmit" })).toBeDisabled();
    expect(screen.getByTestId("coach-review-submit")).toHaveTextContent("Send the revised review");
  });

  it("uploads a feedback PDF under the submission's path, then registers it", async () => {
    renderAt("/coach/submissions/s-final", null);
    const input = await screen.findByTestId("coach-review-pdf");
    const pdf = new File(["%PDF-1.4"], "Minh feedback.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [pdf] } });
    fireEvent.click(screen.getByTestId("coach-review-submit"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("coach_submit_review", expect.anything()));
    const [path, file, opts] = upload.mock.calls[0];
    expect(path).toMatch(/^enr-2\/s-final\/feedback-\d+-Minh_feedback\.pdf$/);
    expect(file).toBe(pdf);
    expect(opts).toMatchObject({ contentType: "application/pdf" });
    expect(rpc).toHaveBeenCalledWith("coach_submit_review", {
      p_submission_id: "s-final",
      p_feedback_text: "Solid session.",
      p_outcome: "pass",
      p_files: [{ storage_path: path, file_kind: "feedback_pdf" }],
    });
  });

  it("refuses a PDF over 10 MB and a file that is not a PDF before uploading", async () => {
    renderAt("/coach/submissions/s-final", null);
    const input = await screen.findByTestId("coach-review-pdf");
    const big = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByTestId("coach-review-pdf-error")).toHaveTextContent("10 MB or smaller");
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.docx", { type: "application/msword" })] } });
    expect(screen.getByTestId("coach-review-pdf-error")).toHaveTextContent("must be a PDF");
    expect(upload).not.toHaveBeenCalled();
  });

  it("removes the uploaded PDF when the review is refused", async () => {
    rpc.mockImplementation((name: string) =>
      name === "coach_assessment_inbox"
        ? Promise.resolve({ data: inbox, error: null })
        : Promise.resolve({ data: null, error: { code: "42501", message: "Only the active assessor submits a review" } }),
    );
    renderAt("/coach/submissions/s-final", null);
    fireEvent.change(await screen.findByTestId("coach-review-pdf"), {
      target: { files: [new File(["%PDF"], "f.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByTestId("coach-review-submit"));
    await waitFor(() => expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]));
    expect(toastError).toHaveBeenCalled();
  });

  it("awaiting validation shows the coach's own review, read-only", async () => {
    inbox = [inboxRow({ ...WAITING, my_latest_review_version: 1, my_latest_feedback_text: "Sent feedback." })];
    renderAt("/coach/submissions/s-wait", null);
    expect(await screen.findByTestId("coach-submission-my-review")).toHaveTextContent("Sent feedback.");
    expect(screen.queryByTestId("coach-review-form")).toBeNull();
  });
});

describe("Dashboard: Submissions to assess", () => {
  it("counts new and returned submissions", async () => {
    renderAt("/dashboard", <SubmissionsToAssessCard />);
    const card = await screen.findByTestId("submissions-to-assess-card");
    expect(card).toHaveTextContent("Submissions to assess (2)");
    expect(card).toHaveTextContent("1 overdue");
    expect(within(card).getByRole("link")).toHaveAttribute("href", "/coach/submissions");
  });

  it("is hidden for a coach with nothing assigned", async () => {
    inbox = [];
    const { container } = renderAt("/dashboard", <SubmissionsToAssessCard />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
