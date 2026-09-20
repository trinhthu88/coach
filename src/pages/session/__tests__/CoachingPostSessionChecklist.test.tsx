import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from, upsert } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import "@/i18n/config";
import { CoachingPostSessionChecklist } from "../CoachingPostSessionChecklist";

type Evidence = {
  session_completed: boolean;
  has_reflection: boolean;
  has_goal_checkin: boolean;
  has_action: boolean;
  has_satisfaction: boolean;
  goal_checkin_required: boolean;
  evidence_complete: boolean;
};

const ALL_PRESENT: Evidence = {
  session_completed: true,
  has_reflection: true,
  has_goal_checkin: true,
  has_action: true,
  has_satisfaction: true,
  goal_checkin_required: true,
  evidence_complete: true,
};

function mockEvidence(overrides: Partial<Evidence>) {
  const row = { session_id: "s1", enrollment_id: "e1", ...ALL_PRESENT, ...overrides };
  rpc.mockImplementation((fn: string) =>
    fn === "coaching_session_evidence"
      ? Promise.resolve({ data: [row], error: null })
      : Promise.resolve({ data: null, error: null }),
  );
}

/** `session_learning_reflections` holds at most one row per (enrollment, activity). */
function mockStoredReflection(body: string | null) {
  from.mockImplementation((table: string) => {
    if (table === "session_learning_reflections") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: body ? { body } : null, error: null }),
              }),
            }),
          }),
        }),
        upsert,
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

function renderChecklist(props: Partial<{ enrollmentId: string; canSubmitReflection: boolean }> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CoachingPostSessionChecklist sessionId="s1" {...props} />
    </QueryClientProvider>,
  );
}

async function item(key: string) {
  return await screen.findByTestId(`post-session-${key}`);
}

describe("CoachingPostSessionChecklist", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    upsert.mockReset();
    upsert.mockResolvedValue({ error: null });
  });

  it("renders nothing until the Coach has marked the session held", async () => {
    mockEvidence({ session_completed: false, evidence_complete: false });
    const { container } = renderChecklist();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="coaching-post-session"]')).toBeNull();
  });

  it("shows follow-up as outstanding while evidence is incomplete", async () => {
    mockEvidence({ has_action: false, has_satisfaction: false, evidence_complete: false });
    renderChecklist();
    // Two of the four required items are done.
    expect(await screen.findByTestId("coaching-evidence-status")).toHaveTextContent("2/4");
  });

  // Each outstanding item is reported on its own. None of them gates the
  // programme unit any more - the completed session already counts.
  it.each([
    ["reflection", { has_reflection: false }],
    ["goalCheckin", { has_goal_checkin: false }],
    ["action", { has_action: false }],
    ["satisfaction", { has_satisfaction: false }],
  ])("marks %s outstanding without touching programme completion", async (key, missing) => {
    mockEvidence({ ...missing, evidence_complete: false });
    renderChecklist();
    expect(await item(key)).toHaveAttribute("data-done", "false");
    expect(screen.getByTestId("coaching-evidence-status")).toHaveTextContent("3/4");
  });

  it("reports follow-up complete only when all four are present", async () => {
    mockEvidence({});
    renderChecklist();
    const status = await screen.findByTestId("coaching-evidence-status");
    expect(status).toHaveTextContent(/complete/i);
    for (const key of ["reflection", "goalCheckin", "action", "satisfaction"]) {
      expect(await item(key)).toHaveAttribute("data-done", "true");
    }
  });

  // Section 20: the gate is vacuous for an enrollment carrying no active goal,
  // so it must not be counted as an outstanding requirement.
  it("marks the goal check-in not applicable when the enrollment has no active goal", async () => {
    mockEvidence({ goal_checkin_required: false, has_goal_checkin: false, evidence_complete: true });
    renderChecklist();
    const row = await item("goalCheckin");
    expect(row).toHaveAttribute("data-required", "false");
    expect(screen.getByTestId("coaching-evidence-status")).toHaveTextContent(/complete/i);
  });

  it("never shows a Coach private note or Admin flag as an evidence item", async () => {
    mockEvidence({});
    renderChecklist();
    await screen.findByTestId("coaching-post-session");
    expect(screen.queryByText(/private note/i)).toBeNull();
    expect(screen.queryByText(/flag/i)).toBeNull();
  });

  // The reflection item is the only one of the four whose writer lives on this
  // card. Without it `session_learning_reflections` has no INSERT path anywhere
  // in the app and the reflection stays permanently outstanding.
  describe("reflection writer", () => {
    it("lets the learner write the reflection that clears the item", async () => {
      mockEvidence({ has_reflection: false, evidence_complete: false });
      mockStoredReflection(null);
      renderChecklist({ enrollmentId: "e1", canSubmitReflection: true });

      const box = await screen.findByLabelText(/your reflection/i);
      fireEvent.change(box, { target: { value: "  I delegate too late.  " } });
      fireEvent.click(screen.getByTestId("coaching-reflection-save"));

      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
      expect(upsert).toHaveBeenCalledWith(
        {
          enrollment_id: "e1",
          source_activity_type: "coaching",
          source_activity_id: "s1",
          body: "I delegate too late.",
        },
        { onConflict: "enrollment_id,source_activity_type,source_activity_id" },
      );
    });

    it("edits the one stored reflection instead of stacking a second", async () => {
      mockEvidence({ evidence_complete: true });
      mockStoredReflection("First answer");
      renderChecklist({ enrollmentId: "e1", canSubmitReflection: true });

      const box = await screen.findByLabelText<HTMLTextAreaElement>(/your reflection/i);
      await waitFor(() => expect(box.value).toBe("First answer"));
      // Unchanged text is not a save.
      expect(screen.getByTestId("coaching-reflection-save")).toBeDisabled();

      fireEvent.change(box, { target: { value: "Second answer" } });
      fireEvent.click(screen.getByTestId("coaching-reflection-save"));
      await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
      expect(upsert.mock.calls[0][0]).toMatchObject({ body: "Second answer" });
    });

    it("refuses to save an empty reflection", async () => {
      mockEvidence({ has_reflection: false, evidence_complete: false });
      mockStoredReflection(null);
      renderChecklist({ enrollmentId: "e1", canSubmitReflection: true });

      await screen.findByLabelText(/your reflection/i);
      expect(screen.getByTestId("coaching-reflection-save")).toBeDisabled();
      fireEvent.change(screen.getByLabelText(/your reflection/i), { target: { value: "   " } });
      expect(screen.getByTestId("coaching-reflection-save")).toBeDisabled();
      expect(upsert).not.toHaveBeenCalled();
    });

    it("never offers the composer to anyone but the learner", async () => {
      mockEvidence({ has_reflection: false, evidence_complete: false });
      renderChecklist({ enrollmentId: "e1", canSubmitReflection: false });
      await screen.findByTestId("coaching-post-session");
      expect(screen.queryByTestId("coaching-reflection-composer")).toBeNull();
      // The Coach's view must not even read the learner's narrative.
      expect(from).not.toHaveBeenCalled();
    });
  });

  it("reads evidence completeness from the backend rather than deriving it on screen", async () => {
    // Every item present but the backend says evidence is incomplete: the
    // component must follow the backend, not recompute the conjunction.
    mockEvidence({ evidence_complete: false });
    renderChecklist();
    expect(await screen.findByTestId("coaching-evidence-status")).toHaveTextContent("4/4");
    expect(screen.getByTestId("coaching-evidence-status")).not.toHaveTextContent(/^Programme unit complete$/);
  });
});
