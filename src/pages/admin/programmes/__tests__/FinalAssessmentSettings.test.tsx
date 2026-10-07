import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, insert } = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("../../training/QuizQuestionEditor", () => ({
  QuizQuestionEditor: ({ assignmentId }: { assignmentId: string }) => <div data-testid="quiz-editor">{assignmentId}</div>,
}));

import i18n from "@/i18n/config";
import { ModuleConfigRow, defaultModuleRows, MODULE_TYPES } from "../../AdminProgrammes";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;

let quizAssignment: { id: string } | null = null;
function renderRow(config: Record<string, unknown>, onConfigChange = vi.fn(), programmeId: string | null = "prog-1") {
  const row = defaultModuleRows().final_assessment;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ModuleConfigRow
        module="final_assessment"
        row={{ enabled: true, config: { ...row.config, ...config } }}
        onToggle={vi.fn()}
        onConfigChange={onConfigChange}
        t={t}
        trainingWeeks={[]}
        programmeId={programmeId ?? undefined}
      />
    </QueryClientProvider>,
  );
  return onConfigChange;
}

beforeEach(() => {
  quizAssignment = null;
  insert.mockReset().mockResolvedValue({ error: null });
  from.mockImplementation((table: string) => {
    if (table !== "assignments") throw new Error(`unexpected table ${table}`);
    return {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: quizAssignment, error: null }) }) }),
      insert,
    };
  });
});

describe("Programme Builder: Final Assessment", () => {
  it("is its own module in the builder, not the old 'assessment' one", () => {
    expect(MODULE_TYPES).toContain("final_assessment");
    expect(MODULE_TYPES).toContain("assessment");
  });

  it("fixes media to MP3 and 50 MB, and has no units field: one requirement per cohort", () => {
    renderRow({});
    const settings = screen.getByTestId("final-assessment-settings");
    expect(within(settings).getByTestId("final-assessment-media")).toHaveTextContent("MP3 audio only (audio/mpeg)");
    expect(settings).toHaveTextContent("50 MB");
    expect(screen.queryByLabelText(t("programmes.modules.schedule.requiredUnits"))).toBeNull();
  });

  it("making it required sets exactly one required unit", () => {
    const onChange = renderRow({});
    fireEvent.click(screen.getByRole("switch", { name: t("programmes.modules.schedule.requiredToggle") }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ required: true, required_units: 1 }));
  });

  it("sets the transcript mode and the instructions in both languages", () => {
    const onChange = renderRow({});
    fireEvent.click(screen.getByRole("radio", { name: "Required" }));
    expect(onChange).toHaveBeenCalledWith({ transcript: "required" });
    fireEvent.change(screen.getByLabelText("Instructions (Vietnamese)"), { target: { value: "Ghi âm một buổi coaching." } });
    expect(onChange).toHaveBeenCalledWith({ instructions_vi: "Ghi âm một buổi coaching." });
  });

  it("turning the quiz on proposes a 70% pass mark", () => {
    const onChange = renderRow({});
    fireEvent.click(screen.getByRole("switch", { name: "Quiz" }));
    expect(onChange).toHaveBeenCalledWith({ quiz_enabled: true, pass_mark_pct: 70 });
  });

  it("creates the quiz as an assignment of the final assessment, not of a training week", async () => {
    renderRow({ quiz_enabled: true, pass_mark_pct: 80 });
    expect(screen.getByLabelText("Pass mark (%)")).toHaveValue(80);
    fireEvent.click(await screen.findByTestId("final-assessment-create-quiz"));
    await waitFor(() =>
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ final_assessment_programme_id: "prog-1", training_week_id: null, assignment_type: "quiz" }),
      ),
    );
  });

  it("edits an existing quiz with the question editor", async () => {
    quizAssignment = { id: "quiz-1" };
    renderRow({ quiz_enabled: true, pass_mark_pct: 70 });
    expect(await screen.findByTestId("quiz-editor")).toHaveTextContent("quiz-1");
  });

  it("asks to save the programme before adding questions", () => {
    renderRow({ quiz_enabled: true }, vi.fn(), null);
    expect(screen.getByText(t("programmes.finalAssessment.saveFirst"))).toBeInTheDocument();
  });
});
