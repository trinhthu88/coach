import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  // No partner is currently opted in / available.
  q.neq = () => Promise.resolve({ data: [], error: null });
  return { supabase: { from: () => q } };
});
vi.mock("@/hooks/useEnrollmentContext", () => ({
  useEnrollmentContext: () => ({ selectedEnrollment: { id: "enrollment-1" }, loading: false }),
}));
vi.mock("@/hooks/useLearnerCanonicalProgress", () => ({
  useLearnerCanonicalProgress: () => ({ progress: { peer_completed_units: 2, peer_required_units: 2, programme_label: "P", cohort_label: "C" } }),
}));
const learnerFeedback = vi.fn(() => ({ feedback: [] as unknown[], loading: false, error: null as string | null }));
vi.mock("@/hooks/dashboard/useLearnerFeedback", () => ({ useLearnerFeedback: () => learnerFeedback() }));
vi.mock("@/hooks/journey/useEnrollmentSessions", () => ({
  useEnrollmentSessions: () => ({
    sessions: [
      { id: "a", enrollmentId: "enrollment-1", type: "peer_coaching", title: "Practice", startTime: "2026-02-02T08:00:00Z", status: "completed", sourceId: "p1", sourceType: "coachee_peer_sessions", participantRole: "receiver", isProgrammeEvidence: true },
      { id: "b", enrollmentId: "enrollment-1", type: "peer_coaching", title: "Practice", startTime: "2026-03-02T08:00:00Z", status: "completed", sourceId: "p2", sourceType: "coachee_peer_sessions", participantRole: "receiver", isProgrammeEvidence: true },
      { id: "c", enrollmentId: "enrollment-1", type: "peer_coaching", title: "Given", startTime: "2026-02-03T08:00:00Z", status: "completed", sourceId: "g1", sourceType: "coachee_peer_sessions", participantRole: "provider", isProgrammeEvidence: false },
    ],
    loading: false,
    error: null,
  }),
}));

import "@/i18n/config";
import CoacheePeerPractice from "../CoacheePeerPractice";

describe("CoacheePeerPractice", () => {
  it("'no partners available' is about availability only and never hides peer session history", async () => {
    render(
      <MemoryRouter>
        <CoacheePeerPractice />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByText("No peer practice partners are available to book right now. This doesn't affect your peer practice history below.")).toBeInTheDocument()
    );
    const history = screen.getByTestId("peer-history");
    expect(within(history).getByText(/3 sessions in your history · 2 count as programme evidence · Peer coaching 2\/2/)).toBeInTheDocument();
    expect(within(history).getAllByTestId("session-row")).toHaveLength(3);
    expect(screen.getByTestId("peer-partners")).toHaveTextContent("Partners available to book now");
    // Module progress is the canonical peer ratio (2/2), not the 3 history rows.
    expect(screen.getByTestId("module-progress-value")).toHaveTextContent("2 / 2");
  });

  it("quotes only real received peer feedback, never mentoring feedback", async () => {
    learnerFeedback.mockReturnValue({
      feedback: [
        { kind: "mentoring", id: "f2", fromName: "Minh Anh", submittedAt: "2026-09-11T00:00:00Z", overallNotes: "Mentoring-only note", competencies: [] },
        { kind: "peer_competency", id: "f1", fromName: "Linh Tran", submittedAt: "2026-09-10T00:00:00Z", note: "Strong listening.", scores: [] },
      ],
      loading: false,
      error: null,
    });
    render(
      <MemoryRouter>
        <CoacheePeerPractice />
      </MemoryRouter>
    );
    expect(await screen.findByText(/Strong listening\./)).toBeInTheDocument();
    expect(screen.queryByText(/Mentoring-only note/)).not.toBeInTheDocument();
  });
});
