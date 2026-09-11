import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, filters } = vi.hoisted(() => ({ rpc: vi.fn(), filters: [] as unknown[][] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc,
  from: (table: string) => {
    const result = { data: table === "coachee_goals" ? [{ id: "goal-1", title: "Listen well" }, { id: "goal-2", title: "Delegate" }] : [], error: null };
    const query = { select: () => query, eq: (key: string, value: string) => { filters.push([table, key, value]); return query; }, order: () => Promise.resolve(result), then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  },
} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { SessionGoalRatings } from "../SessionGoalRatings";
beforeEach(() => { filters.length = 0; rpc.mockReset().mockResolvedValue({ error: null }); });
describe("enrollment goal check-ins", () => {
  it("keeps an unentered rating empty and saves null using explicit enrollment and source", async () => {
    render(<SessionGoalRatings sessionId="session-1" coacheeId="learner" enrollmentId="history-1" sourceActivityType="mentoring" canEdit sessionStatus="completed" />);
    const input = (await screen.findAllByRole("spinbutton"))[0];
    expect(input).toHaveValue(null);
    expect(screen.getByText("goalRatings.saveReflection")).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Discussed: Listen well" }));
    fireEvent.click(screen.getByText("goalRatings.saveReflection"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("record_goal_checkins", expect.objectContaining({
      p_enrollment_id: "history-1",
      p_source_activity_type: "mentoring",
      p_source_activity_id: "session-1",
      p_checkins: [{ goal_id: "goal-1", new_rating: null, note: null }],
    })));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(filters).toContainEqual(["coachee_goals", "enrollment_id", "history-1"]);
    expect(filters).toContainEqual(["goal_checkins", "enrollment_id", "history-1"]);
    expect(filters.some(([, key]) => key === "coachee_id")).toBe(false);
  });
  it("does not load person-scoped goals when enrollment ownership is absent", async () => {
    render(<SessionGoalRatings sessionId="session-1" coacheeId="learner" canEdit sessionStatus="completed" />);
    await screen.findByText("goalRatings.enrollmentRequired");
    expect(filters).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reuses the submission ID when a save response fails", async () => {
    rpc.mockReset()
      .mockResolvedValueOnce({ error: new Error("network") })
      .mockResolvedValueOnce({ error: null });
    render(<SessionGoalRatings sessionId="session-1" coacheeId="learner" enrollmentId="history-1" canEdit sessionStatus="completed" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Discussed: Listen well" }));
    fireEvent.click(screen.getByText("goalRatings.saveReflection"));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("goalRatings.saveReflection"));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[0][1].p_submission_id).toBe(rpc.mock.calls[1][1].p_submission_id);
  });
});
