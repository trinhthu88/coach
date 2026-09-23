import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, format } from "date-fns";

const { rpc, from, upsert, stored } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
  stored: { reflection: null as string | null, actions: [] as Record<string, unknown>[] },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ role: "coachee" }) }));
// The goal check-in writer has its own tests; here only its placement matters.
vi.mock("../SessionGoalRatings", () => ({
  SessionGoalRatings: (props: { enrollmentId: string; sourceActivityType: string }) => (
    <div data-testid="goal-ratings-stub" data-enrollment={props.enrollmentId} data-source={props.sourceActivityType} />
  ),
}));

import "@/i18n/config";
import { PostSessionChecklist } from "../PostSessionChecklist";
import type { SessionSourceTable } from "@/lib/postSessionDeliverables";

type Row = Record<string, unknown>;

const base: Row = {
  module: "coaching",
  source_table: "sessions",
  session_id: "s1",
  enrollment_id: "e-self",
  participant_role: "coachee",
  is_self: true,
  session_status: "completed",
  session_completed: true,
  has_reflection: true,
  has_goal_checkin: true,
  goal_checkin_required: true,
  has_action: true,
  has_satisfaction: true,
  satisfaction_rating: 4,
  deliverables_complete: true,
};

function mockRows(rows: Row[]) {
  rpc.mockImplementation((fn: string) => {
    if (fn === "session_deliverables") return Promise.resolve({ data: rows, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

function mockTables() {
  from.mockImplementation((table: string) => {
    if (table === "session_learning_reflections") {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: stored.reflection ? { body: stored.reflection } : null, error: null }),
        upsert,
      };
      return chain;
    }
    if (table === "enrollment_actions") {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => Promise.resolve({ data: stored.actions, error: null }),
      };
      return chain;
    }
    if (table === "coachee_goals") {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => Promise.resolve({ data: [{ id: "goal-provider", title: "Practise listening" }], error: null }),
      };
      return chain;
    }
    throw new Error(`unexpected table ${table}`);
  });
}

function renderChecklist(sourceTable: SessionSourceTable = "sessions", sessionId = "s1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PostSessionChecklist sourceTable={sourceTable} sessionId={sessionId} viewerUserId="u-self" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  upsert.mockReset();
  upsert.mockResolvedValue({ error: null });
  stored.reflection = null;
  stored.actions = [];
  mockTables();
});

describe("PostSessionChecklist", () => {
  it("reads every tick from session_deliverables for the session's own table", async () => {
    mockRows([base]);
    renderChecklist();
    expect(await screen.findByTestId("post-session-checklist")).toHaveAttribute("data-mode", "own");
    expect(rpc).toHaveBeenCalledWith("session_deliverables", { p_source_table: "sessions", p_session_id: "s1" });
    for (const key of ["reflection", "goalCheckin", "action", "satisfaction"]) {
      expect(screen.getByTestId(`post-session-${key}`)).toHaveAttribute("data-done", "true");
    }
    expect(screen.getByTestId("post-session-status")).toHaveTextContent("Follow-up complete");
  });

  it("renders nothing before the session has been held", async () => {
    mockRows([{ ...base, session_status: "confirmed", session_completed: false }]);
    const { container } = renderChecklist();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container.querySelector("[data-testid=post-session-checklist]")).toBeNull();
  });

  it("highlights outstanding items and shows the check-in as not required without an active goal", async () => {
    mockRows([{ ...base, has_reflection: false, has_action: false, has_goal_checkin: false, goal_checkin_required: false, deliverables_complete: false }]);
    renderChecklist();
    expect(await screen.findByTestId("post-session-reflection-outstanding")).toBeInTheDocument();
    expect(screen.getByTestId("post-session-action-outstanding")).toBeInTheDocument();
    expect(screen.getByTestId("post-session-goalCheckin")).toHaveAttribute("data-required", "false");
    expect(screen.queryByTestId("post-session-goalCheckin-outstanding")).toBeNull();
    // 1 of 3 required items (satisfaction) is done.
    expect(screen.getByTestId("post-session-status")).toHaveTextContent("1/3");
  });

  it("writes a Mentoring reflection to the one store with the mentoring source type", async () => {
    mockRows([{ ...base, module: "mentoring", source_table: "mentoring_sessions", session_id: "m1", participant_role: "mentee", has_reflection: false, deliverables_complete: false }]);
    renderChecklist("mentoring_sessions", "m1");
    const box = await screen.findByLabelText("Your reflection");
    fireEvent.change(box, { target: { value: "Map stakeholders earlier." } });
    fireEvent.click(screen.getByTestId("post-session-reflection-save"));
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith(
        { enrollment_id: "e-self", source_activity_type: "mentoring", source_activity_id: "m1", body: "Map stakeholders earlier." },
        { onConflict: "enrollment_id,source_activity_type,source_activity_id" },
      ),
    );
  });

  it("lets the PROVIDER of a peer session complete their own items on their own enrollment", async () => {
    mockRows([
      { ...base, module: "peer_coaching", source_table: "coachee_peer_sessions", session_id: "p1", enrollment_id: "e-receiver", participant_role: "receiver", is_self: false, satisfaction_rating: null },
      { ...base, module: "peer_coaching", source_table: "coachee_peer_sessions", session_id: "p1", enrollment_id: "e-provider", participant_role: "provider", is_self: true,
        has_satisfaction: false, satisfaction_rating: null, has_action: false, deliverables_complete: false },
    ]);
    stored.actions = [{ id: "a1", enrollment_id: "e-provider", source_activity_type: "coachee_peer_coaching", source_activity_id: "p1", title: "Existing", status: "open", goal_id: null, milestone_id: null, due_date: null }];
    renderChecklist("coachee_peer_sessions", "p1");

    expect(await screen.findByText(/You gave this peer session/)).toBeInTheDocument();
    expect(screen.getByTestId("goal-ratings-stub")).toHaveAttribute("data-enrollment", "e-provider");
    expect(screen.getByTestId("goal-ratings-stub")).toHaveAttribute("data-source", "peer_coaching");

    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("submit_session_satisfaction", {
        p_source_table: "coachee_peer_sessions", p_session_id: "p1", p_enrollment_id: "e-provider", p_rating: 5,
      }),
    );

    expect(await screen.findByText("Existing")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("post-session-action-input"), { target: { value: "Practise silence" } });
    fireEvent.change(screen.getByTestId("post-session-action-goal"), { target: { value: "goal-provider" } });
    fireEvent.change(screen.getByTestId("post-session-action-due-date"), { target: { value: "2026-10-15" } });
    fireEvent.click(screen.getByTestId("post-session-action-add"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("save_enrollment_activity_actions", expect.objectContaining({
        p_enrollment_id: "e-provider",
        p_source_activity_type: "coachee_peer_coaching",
        p_source_activity_id: "p1",
        p_actions: [
          expect.objectContaining({ id: "a1", title: "Existing" }),
           expect.objectContaining({ id: null, title: "Practise silence", status: "open", goal_id: "goal-provider", due_date: "2026-10-15" }),
        ],
      })),
    );
  });

  it("shows each saved action's due date by status colour and its goal as a link", async () => {
    const day = (n: number) => format(addDays(new Date(), n), "yyyy-MM-dd");
    const action = (id: string, due: string) => ({
      id, enrollment_id: "e-self", source_activity_type: "coaching", source_activity_id: "s1",
      title: `Action ${id}`, status: "open", goal_id: "goal-provider", milestone_id: null, due_date: due,
    });
    mockRows([base]);
    stored.actions = [action("late", day(-1)), action("soon", day(7)), action("later", day(8))];
    renderChecklist();

    expect(await screen.findByText("Action late")).toBeInTheDocument();
    const dues = screen.getAllByTestId("action-due");
    expect(dues.map((d) => d.getAttribute("data-status"))).toEqual(["overdue", "dueSoon", "onTrack"]);
    expect(dues[0]).toHaveClass("text-destructive");
    expect(dues[1]).toHaveClass("text-warning");
    expect(dues[2]).toHaveClass("text-success");
    const goals = await screen.findAllByTestId("action-goal");
    expect(goals).toHaveLength(3);
    expect(goals[0]).toHaveTextContent("Goal: Practise listening");
    expect(goals[0]).toHaveAttribute("href", "/coachee/journey#goal-goal-provider");
  });

  it("sends a Triad member to the role-based reflection page and waits for it before rating", async () => {
    mockRows([{ ...base, module: "triads", source_table: "triad_sessions", session_id: "t1", participant_role: "participant", has_reflection: false, has_satisfaction: false, satisfaction_rating: null, deliverables_complete: false }]);
    renderChecklist("triad_sessions", "t1");
    expect(await screen.findByRole("link", { name: "Write my reflection" })).toHaveAttribute("href", "/triads/t1/reflect");
    expect(screen.queryByTestId("post-session-reflection-composer")).toBeNull();
    expect(screen.queryByRole("radio", { name: "5 stars" })).toBeNull();
    expect(screen.getByText("Rate the session once you have submitted your reflection.")).toBeInTheDocument();
    expect(screen.getByTestId("goal-ratings-stub")).toHaveAttribute("data-source", "triad");
  });

  it("shows a coach or mentor the learner's ticks read-only, with no writers", async () => {
    mockRows([{ ...base, module: "mentoring", source_table: "mentoring_sessions", session_id: "m1", participant_role: "mentee", is_self: false, has_reflection: false, satisfaction_rating: null, deliverables_complete: false }]);
    renderChecklist("mentoring_sessions", "m1");
    expect(await screen.findByTestId("post-session-checklist")).toHaveAttribute("data-mode", "readonly");
    expect(screen.getByTestId("post-session-reflection")).toHaveAttribute("data-done", "false");
    expect(screen.queryByTestId("post-session-reflection-composer")).toBeNull();
    expect(screen.queryByTestId("post-session-actions")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});

describe("PostSessionChecklist — counterpart items (coach / mentor / peer)", () => {
  function renderAs(sourceTable: SessionSourceTable, learnerRows: Row[], counterpart: Row[]) {
    rpc.mockImplementation((fn: string) => {
      if (fn === "session_deliverables") return Promise.resolve({ data: learnerRows, error: null });
      if (fn === "session_counterpart_deliverables") return Promise.resolve({ data: counterpart, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PostSessionChecklist sourceTable={sourceTable} sessionId="s1" viewerUserId="coach-1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("shows the coach their own outstanding session notes, with the learner's ticks read-only", async () => {
    renderAs("sessions", [{ ...base, is_self: false }], [
      { user_id: "coach-1", counterpart_role: "coach", item: "session_notes", required: true, done: false, session_completed: true, is_self: true },
      { user_id: "coach-1", counterpart_role: "coach", item: "feedback_to_learner", required: false, done: true, session_completed: true, is_self: true },
    ]);
    const card = await screen.findByTestId("counterpart-checklist");
    expect(card).toHaveTextContent("Your post-session items");
    expect(screen.getByTestId("counterpart-session_notes")).toHaveAttribute("data-done", "false");
    expect(screen.getByTestId("counterpart-feedback_to_learner")).toHaveAttribute("data-required", "false");
    expect(screen.getByTestId("counterpart-status")).toHaveTextContent("Outstanding · 0/1");
    expect(screen.getByTestId("post-session-checklist")).toHaveAttribute("data-mode", "readonly");
  });

  it("marks the mentor complete once notes and feedback are both in", async () => {
    renderAs("mentoring_sessions", [], [
      { user_id: "m-1", counterpart_role: "mentor", item: "session_notes", required: true, done: true, session_completed: true, is_self: true },
      { user_id: "m-1", counterpart_role: "mentor", item: "feedback_to_mentee", required: true, done: true, session_completed: true, is_self: true },
    ]);
    expect(await screen.findByTestId("counterpart-status")).toHaveTextContent("All done");
  });

  it("shows nothing before the session is held, and nothing to someone else's counterpart rows", async () => {
    renderAs("sessions", [], [
      { user_id: "coach-1", counterpart_role: "coach", item: "session_notes", required: true, done: false, session_completed: false, is_self: true },
      { user_id: "coach-2", counterpart_role: "coach", item: "session_notes", required: true, done: false, session_completed: true, is_self: false },
    ]);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("session_counterpart_deliverables", expect.anything()));
    expect(screen.queryByTestId("counterpart-checklist")).not.toBeInTheDocument();
  });
});
