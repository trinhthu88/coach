import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, upload, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, functions: { invoke } } }));
vi.mock("@/lib/uploadWithProgress", () => ({ uploadWithProgress: upload }));
// The browser reads the MP3's length at upload; it travels with the submission.
vi.mock("@/lib/audioDuration", () => ({ measureAudioDuration: () => Promise.resolve(1520.4) }));
vi.mock("@/hooks/useActiveEnrollment", () => ({
  useActiveEnrollment: () => ({ enrollmentId: "enr-1", loading: false }),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ role: "coachee", user: { id: "learner-1" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import "@/i18n/config";
import FinalAssessmentPage from "../FinalAssessmentPage";

function fa(over: Record<string, unknown> = {}) {
  return {
    requirement_id: "req-f", due_on: "2026-11-30", instructions: "Record a 45-minute session.", instructions_vi: "Ghi âm 45 phút.",
    transcript_mode: "optional", max_file_mb: 50, quiz_enabled: true, quiz_question_count: 2, attempt_no: 1,
    state: "not_submitted", quiz_taken: false, quiz_submission_id: null, submission_id: null, submitted_at: null,
    released_at: null, quiz_correct: null, quiz_total: null, quiz_score_pct: null, pass_mark_pct: null, quiz_passed: null,
    final_result: null, can_resubmit: false,
    ...over,
  };
}
const QUESTIONS = [
  { question_id: "q1", question_text: "First?", question_text_vi: null, sort_order: 1, options: [{ id: "a", text: "Yes" }, { id: "b", text: "No" }] },
  { question_id: "q2", question_text: "Second?", question_text_vi: null, sort_order: 2, options: [{ id: "a", text: "Yes" }, { id: "b", text: "No" }] },
];

let state = fa();
let transcription: Record<string, unknown> | null = null;
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FinalAssessmentPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mp3 = (name = "session.mp3", size = 30 * 1024 * 1024) => {
  const f = new File(["x"], name, { type: "audio/mpeg" });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

beforeEach(() => {
  state = fa();
  transcription = { attempt_no: 1, cap: 3, remaining: 3, draft_text: null, draft_storage_path: null, draft_at: null };
  rpc.mockReset();
  upload.mockReset();
  invoke.mockReset();
  rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "learner_final_assessment") return Promise.resolve({ data: [state], error: null });
    if (name === "learner_final_assessment_quiz") return Promise.resolve({ data: QUESTIONS, error: null });
    if (name === "learner_submit_final_assessment_quiz") {
      state = fa({ quiz_taken: true, quiz_submission_id: "quiz-sub-1" });
      return Promise.resolve({ data: "quiz-sub-1", error: null });
    }
    if (name === "learner_submit_assessment") return Promise.resolve({ data: args.p_submission_id, error: null });
    if (name === "learner_final_assessment_transcription") return Promise.resolve({ data: transcription ? [transcription] : [], error: null });
    throw new Error(`unexpected rpc ${name}`);
  });
});

describe("Final Assessment (learner)", () => {
  it("shows the instructions and four steps: quiz, recording, transcript, review", async () => {
    renderPage();
    expect(await screen.findByTestId("final-assessment-instructions")).toHaveTextContent("Record a 45-minute session.");
    expect(within(screen.getByTestId("final-assessment-steps")).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "1. Quiz", "2. Recording", "3. Transcript", "4. Review & submit",
    ]);
  });

  it("without a quiz or transcript there are only the recording and review steps", async () => {
    state = fa({ quiz_enabled: false, transcript_mode: "none" });
    renderPage();
    const steps = await screen.findByTestId("final-assessment-steps");
    expect(within(steps).getAllByRole("button").map((b) => b.textContent)).toEqual(["1. Recording", "2. Review & submit"]);
  });

  it("takes the quiz through learner_submit_final_assessment_quiz, and never shows a score", async () => {
    renderPage();
    const quiz = await screen.findByTestId("final-quiz");
    const questions = within(quiz).getAllByTestId("final-quiz-question");
    expect(screen.getByTestId("final-quiz-submit")).toBeDisabled();
    fireEvent.click(within(questions[0]).getByLabelText("Yes"));
    fireEvent.click(within(questions[1]).getByLabelText("No"));
    fireEvent.click(screen.getByTestId("final-quiz-submit"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("learner_submit_final_assessment_quiz", { p_enrollment_id: "enr-1", p_answers: { q1: "a", q2: "b" } }),
    );
    expect(await screen.findByTestId("final-quiz-taken")).toHaveTextContent("score will be shown with your result");
    expect(document.body).not.toHaveTextContent(/%/);
  });

  it("refuses a non-MP3 or a file over 50 MB, with the 64 kbps tip", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("final-step-recording"));
    expect(screen.getByTestId("final-recording-tip")).toHaveTextContent("64 kbps");
    const input = screen.getByTestId("final-recording-input");
    fireEvent.change(input, { target: { files: [new File(["x"], "session.mp4", { type: "video/mp4" })] } });
    expect(screen.getByTestId("final-recording-error")).toHaveTextContent("must be an MP3 file");
    fireEvent.change(input, { target: { files: [mp3("big.mp3", 50 * 1024 * 1024 + 1)] } });
    expect(screen.getByTestId("final-recording-error")).toHaveTextContent("50 MB or smaller");
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads the MP3 with a progress bar, then submits it with the quiz and transcript", async () => {
    state = fa({ quiz_taken: true, quiz_submission_id: "quiz-sub-1" });
    let report: (f: number) => void = () => {};
    let finish: () => void = () => {};
    upload.mockImplementation(({ onProgress }: { onProgress: (f: number) => void }) => {
      report = onProgress;
      return new Promise<void>((resolve) => (finish = resolve));
    });
    renderPage();
    fireEvent.click(await screen.findByTestId("final-step-recording"));
    fireEvent.change(screen.getByTestId("final-recording-input"), { target: { files: [mp3()] } });
    await waitFor(() => expect(upload).toHaveBeenCalled());
    const call = upload.mock.calls[0][0];
    expect(call.bucket).toBe("assessment-files");
    expect(call.contentType).toBe("audio/mpeg");
    expect(call.path).toMatch(/^enr-1\/[0-9a-f-]{36}\/recording\.mp3$/);
    act(() => report(0.42));
    expect(screen.getByTestId("final-recording-progress")).toHaveTextContent("Uploading… 42%");
    await act(async () => finish());
    expect(await screen.findByTestId("final-recording-uploaded")).toHaveTextContent("session.mp3");

    fireEvent.click(screen.getByTestId("final-step-transcript"));
    fireEvent.change(screen.getByTestId("final-transcript"), { target: { value: "Coach: what would make today useful?" } });
    fireEvent.click(screen.getByTestId("final-step-review"));
    expect(screen.getByTestId("final-review-quiz")).toHaveAttribute("data-done", "true");
    expect(screen.getByTestId("final-review-recording")).toHaveAttribute("data-done", "true");
    fireEvent.click(screen.getByTestId("final-submit"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("learner_submit_assessment", expect.anything()));
    const submitted = rpc.mock.calls.find(([n]) => n === "learner_submit_assessment")![1];
    expect(submitted).toEqual({
      p_submission_id: call.path.split("/")[1],
      p_enrollment_id: "enr-1",
      p_cohort_requirement_id: "req-f",
      p_kind: "final_assessment",
      p_quiz_submission_id: "quiz-sub-1",
      p_transcript_text: "Coach: what would make today useful?",
      p_transcript_source: "pasted",
      p_files: [{ storage_path: call.path, file_kind: "recording", duration_seconds: 1520.4 }],
    });
  });

  it("cannot submit before the quiz and recording are done, or without a required transcript", async () => {
    state = fa({ transcript_mode: "required" });
    renderPage();
    fireEvent.click(await screen.findByTestId("final-step-review"));
    expect(screen.getByTestId("final-submit")).toBeDisabled();
    expect(screen.getByTestId("final-review-transcript")).toHaveTextContent("Transcript missing");
  });

  it("under review: the status, no score", async () => {
    state = fa({ state: "under_review", submitted_at: "2026-10-05T09:00:00Z", quiz_taken: true });
    renderPage();
    expect(await screen.findByTestId("final-assessment-status")).toHaveTextContent("Under review");
    expect(screen.queryByTestId("final-assessment-steps")).toBeNull();
    expect(screen.queryByTestId("final-assessment-quiz-result")).toBeNull();
  });

  it("released: the result and, only now, the quiz score against the pass mark", async () => {
    state = fa({
      state: "completed", final_result: "pass", released_at: "2026-10-06T09:00:00Z",
      quiz_correct: 9, quiz_total: 10, quiz_score_pct: 90, pass_mark_pct: 70, quiz_passed: true,
    });
    renderPage();
    expect(await screen.findByTestId("final-assessment-final-result")).toHaveTextContent("Pass");
    expect(screen.getByTestId("final-assessment-quiz-result")).toHaveTextContent("9 of 10 correct (90%) · at or above the 70% pass mark");
    expect(screen.getByRole("link", { name: "Read your assessor's feedback" })).toHaveAttribute("href", "/coachee/journey#feedback-results");
  });

  it("Resubmit opens attempt 2 with the steps again", async () => {
    state = fa({ state: "resubmit_requested", attempt_no: 2, can_resubmit: true });
    renderPage();
    expect(await screen.findByTestId("final-assessment-resubmit")).toHaveTextContent("attempt 2 of 2");
    expect(screen.getByTestId("final-assessment-steps")).toBeInTheDocument();
  });

  describe("automatic transcription (A7)", () => {
    async function uploadRecording() {
      upload.mockResolvedValue(undefined);
      renderPage();
      fireEvent.click(await screen.findByTestId("final-step-recording"));
      fireEvent.change(screen.getByTestId("final-recording-input"), { target: { files: [mp3()] } });
      await screen.findByTestId("final-recording-uploaded");
      return upload.mock.calls[0][0].path as string;
    }

    it("asks for the recording first", async () => {
      renderPage();
      fireEvent.click(await screen.findByTestId("final-step-transcript"));
      expect(screen.getByTestId("final-auto-transcribe-needs-recording")).toBeInTheDocument();
      expect(screen.queryByTestId("final-auto-transcribe")).toBeNull();
    });

    it("drafts the transcript, lets the learner edit it, and submits it as 'auto'", async () => {
      state = fa({ quiz_taken: true, quiz_submission_id: "quiz-sub-1" });
      invoke.mockResolvedValue({ data: { text: "Coach: hôm nay bạn muốn gì?", source: "auto" }, error: null });
      const path = await uploadRecording();
      fireEvent.click(screen.getByTestId("final-step-transcript"));
      fireEvent.click(screen.getByTestId("final-auto-transcribe-consent"));
      fireEvent.click(screen.getByTestId("final-auto-transcribe"));
      await waitFor(() => expect(screen.getByTestId("final-transcript")).toHaveValue("Coach: hôm nay bạn muốn gì?"));
      expect(invoke).toHaveBeenCalledWith("transcribe-assessment-recording", { body: { enrollment_id: "enr-1", storage_path: path, consent: true } });
      expect(screen.getByTestId("final-auto-transcribe-draft")).toHaveTextContent("automatic draft");
      // Never overwrites what is in the box.
      expect(screen.getByTestId("final-auto-transcribe")).toBeDisabled();

      fireEvent.change(screen.getByTestId("final-transcript"), { target: { value: "Coach: Hôm nay bạn muốn đạt được gì?" } });
      fireEvent.click(screen.getByTestId("final-step-review"));
      fireEvent.click(screen.getByTestId("final-submit"));
      await waitFor(() => expect(rpc).toHaveBeenCalledWith("learner_submit_assessment", expect.anything()));
      const submitted = rpc.mock.calls.find(([n]) => n === "learner_submit_assessment")![1];
      expect(submitted).toMatchObject({ p_transcript_text: "Coach: Hôm nay bạn muốn đạt được gì?", p_transcript_source: "auto" });
    });

    it("a cleared draft replaced by the learner's own text is 'pasted'", async () => {
      state = fa({ quiz_taken: true, quiz_submission_id: "quiz-sub-1" });
      invoke.mockResolvedValue({ data: { text: "draft" }, error: null });
      await uploadRecording();
      fireEvent.click(screen.getByTestId("final-step-transcript"));
      fireEvent.click(screen.getByTestId("final-auto-transcribe-consent"));
      fireEvent.click(screen.getByTestId("final-auto-transcribe"));
      await waitFor(() => expect(screen.getByTestId("final-transcript")).toHaveValue("draft"));
      fireEvent.change(screen.getByTestId("final-transcript"), { target: { value: "" } });
      fireEvent.change(screen.getByTestId("final-transcript"), { target: { value: "My own transcript" } });
      fireEvent.click(screen.getByTestId("final-step-review"));
      fireEvent.click(screen.getByTestId("final-submit"));
      await waitFor(() => expect(rpc).toHaveBeenCalledWith("learner_submit_assessment", expect.anything()));
      expect(rpc.mock.calls.find(([n]) => n === "learner_submit_assessment")![1]).toMatchObject({ p_transcript_source: "pasted" });
    });

    it("shows a friendly message when the service is not configured", async () => {
      invoke.mockResolvedValue({
        data: null,
        error: { context: new Response(JSON.stringify({ error: "not_configured" }), { status: 503 }) },
      });
      await uploadRecording();
      fireEvent.click(screen.getByTestId("final-step-transcript"));
      fireEvent.click(screen.getByTestId("final-auto-transcribe-consent"));
      fireEvent.click(screen.getByTestId("final-auto-transcribe"));
      expect(await screen.findByTestId("final-auto-transcribe-error")).toHaveTextContent("Automatic transcription is not available");
      expect(screen.getByTestId("final-transcript")).toHaveValue("");
    });
  
    it("shows the privacy notice, and the button only after the learner ticks consent", async () => {
      await uploadRecording();
      fireEvent.click(screen.getByTestId("final-step-transcript"));
      expect(screen.getByTestId("final-auto-transcribe-panel")).toHaveTextContent(
        "sent to an external transcription service (OpenAI)",
      );
      expect(screen.queryByTestId("final-auto-transcribe")).toBeNull();
      fireEvent.click(screen.getByTestId("final-auto-transcribe-consent"));
      expect(screen.getByTestId("final-auto-transcribe")).toBeInTheDocument();
      expect(invoke).not.toHaveBeenCalled();
    });

    it("shows how many drafts are left, and no button when all 3 are used", async () => {
      transcription = { ...transcription, remaining: 2 };
      await uploadRecording();
      fireEvent.click(screen.getByTestId("final-step-transcript"));
      expect(await screen.findByTestId("final-auto-transcribe-remaining")).toHaveTextContent("2 of 3 automatic drafts left");

      transcription = { ...transcription, remaining: 0 };
      invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "limit_reached" }), { status: 429 }) } });
      fireEvent.click(screen.getByTestId("final-auto-transcribe-consent"));
      fireEvent.click(screen.getByTestId("final-auto-transcribe"));
      expect(await screen.findByTestId("final-auto-transcribe-error")).toHaveTextContent("used all automatic drafts");
      // The count is re-read after every call.
      await waitFor(() => expect(screen.getByTestId("final-auto-transcribe-remaining")).toHaveTextContent("used all 3"));
      expect(screen.queryByTestId("final-auto-transcribe")).toBeNull();
    });

    it("brings back the saved draft after a reload, as an automatic draft", async () => {
      transcription = { ...transcription, remaining: 2, draft_text: "Saved draft from before", draft_at: "2026-10-06T10:00:00Z" };
      renderPage();
      fireEvent.click(await screen.findByTestId("final-step-transcript"));
      await waitFor(() => expect(screen.getByTestId("final-transcript")).toHaveValue("Saved draft from before"));
      expect(screen.getByTestId("final-auto-transcribe-draft")).toBeInTheDocument();
      expect(invoke).not.toHaveBeenCalled();
    });
  });
});
