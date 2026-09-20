import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const enrollmentContext = vi.fn();
const developmentJourney = vi.fn();

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" }, role: "coachee" }),
}));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: (...args: unknown[]) => enrollmentContext(...args),
}));
vi.mock("@/hooks/journey/useEnrollmentDevelopmentJourney", () => ({
  useEnrollmentDevelopmentJourney: (...args: unknown[]) => developmentJourney(...args),
}));

import "@/i18n/config";
import { RecentDevelopmentCard } from "../RecentDevelopmentCard";

const event = (id: string, title: string, occurredAt: string) => ({
  id,
  enrollmentId: "enrollment-1",
  occurredAt,
  type: "goal" as const,
  subtype: "goal_created",
  title,
  summary: null,
  sourceId: id,
  sourceType: "coachee_goals",
});

describe("RecentDevelopmentCard", () => {
  it("shows an explicit empty state when the development journey has no events", () => {
    enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-1" }, loading: false });
    developmentJourney.mockReturnValue({ events: [], loading: false, error: null });
    render(<MemoryRouter><RecentDevelopmentCard /></MemoryRouter>);
    expect(screen.getByText("Nothing in your development history yet.")).toBeInTheDocument();
  });

  it("renders exactly the first N events from the shared projection, in the order the hook returned them", () => {
    enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-1" }, loading: false });
    const events = [
      event("1", "Newest event", "2026-10-20T00:00:00Z"),
      event("2", "Second event", "2026-10-15T00:00:00Z"),
      event("3", "Third event", "2026-10-10T00:00:00Z"),
      event("4", "Fourth event (cut off)", "2026-10-05T00:00:00Z"),
    ];
    developmentJourney.mockReturnValue({ events, loading: false, error: null });

    render(<MemoryRouter><RecentDevelopmentCard limit={3} /></MemoryRouter>);

    expect(screen.getByText("Newest event")).toBeInTheDocument();
    expect(screen.getByText("Second event")).toBeInTheDocument();
    expect(screen.getByText("Third event")).toBeInTheDocument();
    expect(screen.queryByText("Fourth event (cut off)")).not.toBeInTheDocument();
  });

  it("calls the same hook used by the full Development Journey with the selected enrollment and coachee", () => {
    enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-1" }, loading: false });
    developmentJourney.mockReturnValue({ events: [], loading: false, error: null });
    render(<MemoryRouter><RecentDevelopmentCard /></MemoryRouter>);
    expect(developmentJourney).toHaveBeenCalledWith("enrollment-1", "learner-1");
  });
});
