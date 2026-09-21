import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

const enrollmentContext = vi.fn();
const programmeModules = vi.fn();
const myCoachCardData = vi.fn();
const learnerCanonicalProgress = vi.fn();
const enrollmentSessions = vi.fn();

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "learner-1" } }),
}));
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: (...args: unknown[]) => enrollmentContext(...args),
}));
vi.mock("@/hooks/useProgrammeModules", () => ({
  useProgrammeModules: () => programmeModules(),
}));
vi.mock("@/hooks/dashboard/useMyCoachCardData", () => ({
  useMyCoachCardData: (...args: unknown[]) => myCoachCardData(...args),
}));
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: (...args: unknown[]) => learnerCanonicalProgress(...args),
}));
vi.mock("@/hooks/journey/useEnrollmentSessions", () => ({
  useEnrollmentSessions: (...args: unknown[]) => enrollmentSessions(...args),
}));

// Shared module structure (useModuleWorkspace): canonical requirements,
// post-session deliverables and the booking goal gate.
vi.mock("@/hooks/journey/useModuleRequirements", () => ({
  useModuleRequirements: () => ({ state: null, loading: false, error: null }),
}));
vi.mock("@/hooks/sessions/usePostSessionDeliverables", () => ({
  useLearnerSessionDeliverables: () => ({ deliverables: [], loading: false, error: null }),
}));
// Goals and actions linked to this module's sessions (listed in the shared card).
const linkedGoalsActions = vi.fn(() => ({ actions: [] as unknown[], goals: [] as unknown[], loading: false, error: null }));
vi.mock("@/hooks/journey/useModuleGoalsActions", () => ({ useModuleGoalsActions: () => linkedGoalsActions() }));
vi.mock("@/components/goals/useBookingGoalGate", () => ({
  useBookingGoalGate: () => ({ gate: null, blocked: false, loading: false }),
}));

import "@/i18n/config";
import { MyCoachSection } from "../MyCoachSection";

function renderSection() {
  return render(
    <MemoryRouter>
      <MyCoachSection />
    </MemoryRouter>
  );
}

beforeEach(() => {
  enrollmentContext.mockReturnValue({ selectedEnrollment: { id: "enrollment-1" }, loading: false });
  learnerCanonicalProgress.mockReturnValue({ progress: null, loading: false, error: null });
  enrollmentSessions.mockReturnValue({ sessions: [], loading: false, error: null });
});

describe("MyCoachSection", () => {
  it("renders nothing when the programme has no coaching module", () => {
    programmeModules.mockReturnValue({ hasModule: () => false, loading: false });
    myCoachCardData.mockReturnValue({ data: null, loading: false });
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an explicit 'no coach assigned' state (never a fabricated coach) when the module is configured but no coach is assigned", () => {
    programmeModules.mockReturnValue({ hasModule: () => true, loading: false });
    myCoachCardData.mockReturnValue({ data: null, loading: false });
    renderSection();
    expect(screen.getByTestId("my-coach")).toHaveTextContent("No coach is assigned to you yet");
    expect(screen.getByTestId("coaching-sessions")).toHaveTextContent("No coaching sessions in this programme yet.");
  });

  it("shows coaching progress from the canonical progress row, not a count of session rows", () => {
    programmeModules.mockReturnValue({ hasModule: () => true, loading: false });
    myCoachCardData.mockReturnValue({ data: { id: "coach-1", full_name: "Casey Coach", avatar_url: null, title: null }, loading: false });
    // Canonical row says 4/4 (Demo Learner); only one completed row is in the list.
    learnerCanonicalProgress.mockReturnValue({ progress: { coaching_completed_units: 4, coaching_required_units: 4 }, loading: false, error: null });
    enrollmentSessions.mockReturnValue({
      sessions: [
        { id: "coaching-s1", enrollmentId: "enrollment-1", type: "coaching", title: "Kick-off", startTime: "2026-01-01T10:00:00Z", status: "completed", sourceId: "s1", sourceType: "sessions", isProgrammeEvidence: true },
        { id: "peer-p1", enrollmentId: "enrollment-1", type: "peer_coaching", title: "Peer", startTime: "2026-01-02T10:00:00Z", status: "completed", sourceId: "p1", sourceType: "coachee_peer_sessions" },
      ],
      loading: false,
      error: null,
    });
    renderSection();
    expect(screen.getByTestId("module-progress-value")).toHaveTextContent("4 / 4");
    expect(screen.getByTestId("my-coach")).toHaveTextContent("4 / 4 sessions complete");
    // Only coaching rows — the peer row belongs to Peer coaching.
    expect(screen.getAllByTestId("session-row")).toHaveLength(1);
  });

  it("lists the goals and actions connected to coaching sessions, and the upcoming session card", () => {
    programmeModules.mockReturnValue({ hasModule: () => true, loading: false });
    myCoachCardData.mockReturnValue({ data: null, loading: false });
    linkedGoalsActions.mockReturnValue({
      actions: [
        { id: "a1", title: "Delegate the weekly report", status: "open", dueDate: "2099-01-01", sessionId: "s1" },
        { id: "a2", title: "Ask for feedback", status: "completed", dueDate: null, sessionId: "s0" },
      ],
      goals: [{ id: "g1", title: "Lead decisive meetings", status: "active", checkins: 2 }],
      loading: false,
      error: null,
    });
    renderSection();
    expect(screen.getByTestId("module-goals")).toHaveTextContent("Lead decisive meetings");
    expect(screen.getByTestId("module-goals")).toHaveTextContent("2 check-ins");
    const actions = screen.getAllByTestId("module-action");
    expect(actions).toHaveLength(2);
    expect(actions[0]).toHaveAttribute("data-status", "open");
    expect(screen.getByTestId("module-upcoming")).toBeInTheDocument();
    expect(screen.getByTestId("module-upcoming-none")).toBeInTheDocument();
  });

  it("shows a load error for coaching sessions instead of an empty state", () => {
    programmeModules.mockReturnValue({ hasModule: () => true, loading: false });
    myCoachCardData.mockReturnValue({ data: null, loading: false });
    enrollmentSessions.mockReturnValue({ sessions: [], loading: false, error: "boom" });
    renderSection();
    expect(screen.getByTestId("coaching-sessions")).toHaveTextContent("Your sessions could not be loaded.");
    expect(screen.getByTestId("coaching-sessions")).not.toHaveTextContent("No coaching sessions");
  });

  it("shows the real assigned coach's name and sessions, not a sample name", () => {
    programmeModules.mockReturnValue({ hasModule: () => true, loading: false });
    myCoachCardData.mockReturnValue({ data: { id: "coach-1", full_name: "Casey Coach", avatar_url: null, title: "PCC" }, loading: false });
    enrollmentSessions.mockReturnValue({
      sessions: [
        { id: "coaching-s1", enrollmentId: "enrollment-1", type: "coaching", title: "Leadership", startTime: "2027-01-01T10:00:00Z", status: "confirmed", sourceId: "s1", sourceType: "sessions" },
      ],
      loading: false,
    });
    renderSection();
    expect(screen.getByText("Casey Coach")).toBeInTheDocument();
    expect(screen.queryByText(/Anna Fan/i)).not.toBeInTheDocument();
  });
});
