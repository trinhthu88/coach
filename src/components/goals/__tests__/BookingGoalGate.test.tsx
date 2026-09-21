import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "@/i18n/config";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

let mockRole: "coach" | "coachee" = "coachee";
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, role: mockRole }),
}));

import { BookingGoalGate, goalsHrefForRole } from "../BookingGoalGate";

const gate = (blocked: boolean) => ({
  enrollment_id: "e1",
  blocked,
  reason: blocked ? "goal_required_before_booking" : null,
  has_active_goal: !blocked,
  active_goal_count: blocked ? 0 : 1,
  max_active_goals: 3,
  in_grace_period: false,
  gate_starts_on: "2026-09-01",
  grace_ends_on: "2026-09-07",
  blocked_from: "2026-09-08",
});

function renderGate(enrollmentId: string | null = "e1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BookingGoalGate enrollmentId={enrollmentId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BookingGoalGate", () => {
  beforeEach(() => {
    rpc.mockReset();
    mockRole = "coachee";
  });

  it("shows the exact message and a link to the journey goals when the server says blocked", async () => {
    rpc.mockResolvedValue({ data: gate(true), error: null });
    renderGate();
    expect(
      await screen.findByText("Create at least one programme goal before booking your next session."),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Set a goal →" });
    expect(link).toHaveAttribute("href", "/coachee/journey#goals");
    expect(rpc).toHaveBeenCalledWith("enrollment_goal_gate", { p_enrollment_id: "e1" });
  });

  it("links a coach-as-learner to their own journey goals", async () => {
    mockRole = "coach";
    rpc.mockResolvedValue({ data: gate(true), error: null });
    renderGate();
    expect(await screen.findByRole("link", { name: "Set a goal →" })).toHaveAttribute("href", "/coach/my-journey#goals");
    expect(goalsHrefForRole("coachee")).toBe("/coachee/journey#goals");
  });

  it("renders nothing when the gate is open", async () => {
    rpc.mockResolvedValue({ data: gate(false), error: null });
    const { container } = renderGate();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing (and does not query) without an enrollment", () => {
    const { container } = renderGate(null);
    expect(rpc).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("stays open when the gate cannot be read — the server remains the rule", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "nope" } });
    const { container } = renderGate();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
