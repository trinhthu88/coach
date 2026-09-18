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
  learnerCanonicalProgress.mockReturnValue({ progress: null });
  enrollmentSessions.mockReturnValue({ sessions: [], loading: false });
});

describe("MyCoachSection", () => {
  it("renders nothing when the coaching module isn't configured for receiving", () => {
    programmeModules.mockReturnValue({ hasDirection: () => false, loading: false });
    myCoachCardData.mockReturnValue({ data: null, loading: false });
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the module is configured but no coach is assigned yet — never a fabricated coach", () => {
    programmeModules.mockReturnValue({ hasDirection: () => true, loading: false });
    myCoachCardData.mockReturnValue({ data: null, loading: false });
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the real assigned coach's name and sessions, not a sample name", () => {
    programmeModules.mockReturnValue({ hasDirection: () => true, loading: false });
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
