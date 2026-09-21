import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/i18n/config";
import { ClientRow } from "../ClientRow";
import type { Client } from "@/hooks/coach/types";

const base: Client = {
  id: "c1", full_name: "Linh Nguyen", email: "linh@example.test", avatar_url: null,
  totalSessions: 4, completed: 4, cancelled: 0, upcomingCount: 0, lastSession: null, nextSession: null,
  goalsActive: 1, goalsAll: [], milestonesDone: 0, milestonesTotal: 0, enrollmentId: "e1",
  completionPct: 67, actionItemsDone: 0, actionItemsTotal: 0, overdueActions: 9,
  paceStatus: "on_track", progressError: false, weekStart: null,
};

describe("ClientRow (P0-3: canonical progress and status)", () => {
  it("shows the canonical completion % and pace status — overdue actions never change the status", () => {
    render(<ClientRow client={base} onOpen={() => {}} />);
    expect(screen.getAllByText(/67%/).length).toBeGreaterThan(0);
    const pace = screen.getAllByTestId("client-pace")[0];
    expect(pace).toHaveAttribute("data-pace", "on_track");
    expect(pace).toHaveTextContent("On track");
  });

  it("shows an error state, not 0%, when the canonical read failed", () => {
    render(<ClientRow client={{ ...base, completionPct: null, paceStatus: null, progressError: true }} onOpen={() => {}} />);
    expect(screen.getAllByTestId("client-progress-error")[0]).toHaveTextContent("Progress unavailable");
    expect(screen.queryByTestId("client-pace")).not.toBeInTheDocument();
  });
});
