import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import "@/i18n/config";
import { CoachingPostSessionChecklist } from "../CoachingPostSessionChecklist";

type Evidence = {
  session_completed: boolean;
  has_reflection: boolean;
  has_goal_checkin: boolean;
  has_action: boolean;
  has_satisfaction: boolean;
  goal_checkin_required: boolean;
  unit_complete: boolean;
};

const ALL_PRESENT: Evidence = {
  session_completed: true,
  has_reflection: true,
  has_goal_checkin: true,
  has_action: true,
  has_satisfaction: true,
  goal_checkin_required: true,
  unit_complete: true,
};

function mockEvidence(overrides: Partial<Evidence>) {
  const row = { session_id: "s1", enrollment_id: "e1", ...ALL_PRESENT, ...overrides };
  rpc.mockImplementation((fn: string) =>
    fn === "coaching_session_evidence"
      ? Promise.resolve({ data: [row], error: null })
      : Promise.resolve({ data: null, error: null }),
  );
}

function renderChecklist() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CoachingPostSessionChecklist sessionId="s1" />
    </QueryClientProvider>,
  );
}

async function item(key: string) {
  return await screen.findByTestId(`post-session-${key}`);
}

describe("CoachingPostSessionChecklist", () => {
  beforeEach(() => rpc.mockReset());

  it("renders nothing until the Coach has marked the session held", async () => {
    mockEvidence({ session_completed: false, unit_complete: false });
    const { container } = renderChecklist();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="coaching-post-session"]')).toBeNull();
  });

  it("shows the programme unit as pending while evidence is outstanding", async () => {
    mockEvidence({ has_action: false, has_satisfaction: false, unit_complete: false });
    renderChecklist();
    // Two of the four required items are done.
    expect(await screen.findByTestId("coaching-unit-status")).toHaveTextContent("2/4");
  });

  // Section 17/25: each gate blocks the unit on its own.
  it.each([
    ["reflection", { has_reflection: false }],
    ["goalCheckin", { has_goal_checkin: false }],
    ["action", { has_action: false }],
    ["satisfaction", { has_satisfaction: false }],
  ])("marks %s outstanding and keeps the unit pending", async (key, missing) => {
    mockEvidence({ ...missing, unit_complete: false });
    renderChecklist();
    expect(await item(key)).toHaveAttribute("data-done", "false");
    expect(screen.getByTestId("coaching-unit-status")).toHaveTextContent("3/4");
  });

  it("completes the programme unit only when all four are present", async () => {
    mockEvidence({});
    renderChecklist();
    const status = await screen.findByTestId("coaching-unit-status");
    expect(status).toHaveTextContent(/complete/i);
    for (const key of ["reflection", "goalCheckin", "action", "satisfaction"]) {
      expect(await item(key)).toHaveAttribute("data-done", "true");
    }
  });

  // Section 20: the gate is vacuous for an enrollment carrying no active goal,
  // so it must not be counted as an outstanding requirement.
  it("marks the goal check-in not required when the enrollment has no active goal", async () => {
    mockEvidence({ goal_checkin_required: false, has_goal_checkin: false, unit_complete: true });
    renderChecklist();
    const row = await item("goalCheckin");
    expect(row).toHaveAttribute("data-required", "false");
    expect(screen.getByTestId("coaching-unit-status")).toHaveTextContent(/complete/i);
  });

  it("never shows a Coach private note or Admin flag as a gate", async () => {
    mockEvidence({});
    renderChecklist();
    await screen.findByTestId("coaching-post-session");
    expect(screen.queryByText(/private note/i)).toBeNull();
    expect(screen.queryByText(/flag/i)).toBeNull();
  });

  it("reads completion from the backend rather than deriving it on screen", async () => {
    // Every gate present but the backend says the unit is not complete: the
    // component must follow the backend, not recompute the conjunction.
    mockEvidence({ unit_complete: false });
    renderChecklist();
    expect(await screen.findByTestId("coaching-unit-status")).toHaveTextContent("4/4");
    expect(screen.getByTestId("coaching-unit-status")).not.toHaveTextContent(/^Programme unit complete$/);
  });
});
