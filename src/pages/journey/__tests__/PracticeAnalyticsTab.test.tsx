import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const practiceAnalytics = vi.fn();
vi.mock("@/hooks/journey/usePracticeAnalytics", () => ({
  usePracticeAnalytics: (...args: unknown[]) => practiceAnalytics(...args),
}));

import "@/i18n/config";
import { PracticeAnalyticsTab } from "../PracticeAnalyticsTab";

describe("PracticeAnalyticsTab", () => {
  it("shows an explicit empty state, not a fabricated competency score, when there is no peer feedback", () => {
    practiceAnalytics.mockReturnValue({
      loading: false,
      entries: [],
      feedback: [],
      profilesById: {},
      stats: { coached: { booked: 0, completed: 0 }, peerGiven: { booked: 0, completed: 0 }, peerReceived: { booked: 0, completed: 0 } },
      competencyScores: [
        { key: "ethical_practice", score: null, observations: 0 },
        { key: "maintains_presence", score: null, observations: 0 },
      ],
    });
    render(
      <PracticeAnalyticsTab
        enrollmentId="e1"
        userId="u1"
        selfReflectionsCount={0}
        onViewReflections={vi.fn()}
        onViewFeedback={vi.fn()}
      />
    );
    expect(
      screen.getByText("No competency feedback yet — this fills in as you receive peer coaching feedback.")
    ).toBeInTheDocument();
    // Never a fabricated illustrative score from the prototype.
    expect(screen.queryByText("84")).not.toBeInTheDocument();
  });

  it("renders only competencies with a real observed score, using the real peer-completed session count", () => {
    practiceAnalytics.mockReturnValue({
      loading: false,
      entries: [],
      feedback: [{ id: "f1", peer_session_id: "ps1", created_at: "2026-09-10T00:00:00Z", feedback_note: "Great listening.", peer_coachee_id: "peer-1" }],
      profilesById: { "peer-1": { full_name: "Linh Tran" } },
      stats: { coached: { booked: 0, completed: 0 }, peerGiven: { booked: 1, completed: 1 }, peerReceived: { booked: 0, completed: 0 } },
      competencyScores: [
        { key: "listens_actively", score: 88, observations: 1 },
        { key: "ethical_practice", score: null, observations: 0 },
      ],
    });
    render(
      <PracticeAnalyticsTab
        enrollmentId="e1"
        userId="u1"
        selfReflectionsCount={3}
        onViewReflections={vi.fn()}
        onViewFeedback={vi.fn()}
      />
    );
    expect(screen.getByText("Listens actively")).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.queryByText("Ethical practice")).not.toBeInTheDocument();
    expect(screen.getByText("Linh Tran")).toBeInTheDocument();
    // Self-reflections count comes from the caller (Development Journey
    // reflection events), never recomputed inside this component.
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
