import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" } }) }));
// Partner eligibility is ONE server-side call now -- the page no longer
// queries `profiles` on the global opt-in flag -- so the only thing to stub is
// eligible_peer_partners().
const eligiblePartners = vi.fn(() => Promise.resolve({ data: [] as unknown[], error: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => eligiblePartners(...(args as [])) },
}));
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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CoacheePeerPractice from "../CoacheePeerPractice";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CoacheePeerPractice />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("CoacheePeerPractice", () => {
  it("'no partners available' is about availability only and never hides peer session history", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("No peer practice partners are available to book right now. This doesn't affect your peer practice history below.")).toBeInTheDocument()
    );
    const history = screen.getByTestId("peer-history");
    expect(within(history).getByText(/3 sessions in your history · 2 count as programme evidence · Peer coaching 2\/2/)).toBeInTheDocument();
    expect(within(history).getAllByTestId("session-row")).toHaveLength(3);
    expect(screen.getByTestId("peer-partners")).toHaveTextContent("Partners available to book now");
    // The pool is resolved for the SELECTED ENROLLMENT, not for the account.
    expect(eligiblePartners).toHaveBeenCalledWith("eligible_peer_partners", {
      p_enrollment_id: "enrollment-1",
    });
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
    renderPage();
    expect(await screen.findByText(/Strong listening\./)).toBeInTheDocument();
    expect(screen.queryByText(/Mentoring-only note/)).not.toBeInTheDocument();
  });
});

describe("CoacheePeerPractice partner pool", () => {
  it("lists eligible partners and says which cohort a cross-cohort partner is from", async () => {
    eligiblePartners.mockResolvedValueOnce({
      data: [
        { user_id: "u-own", enrollment_id: "e-own", display_name: "Mai Own", cohort_id: "c1", cohort_name: "Cohort A", programme_id: "p1", programme_name: "P", is_own_cohort: true },
        { user_id: "u-far", enrollment_id: "e-far", display_name: "Linh Far", cohort_id: "c2", cohort_name: "Cohort B", programme_id: "p1", programme_name: "P", is_own_cohort: false },
      ],
      error: null,
    });
    renderPage();
    const rows = await screen.findAllByTestId("peer-partner-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-own-cohort", "true");
    expect(rows[0]).toHaveTextContent("Your cohort");
    expect(rows[1]).toHaveAttribute("data-own-cohort", "false");
    // A partner reached through a cross-cohort grant is labelled with their
    // cohort, so a pool spanning several cohorts stays legible.
    expect(rows[1]).toHaveTextContent("Cohort B");
    // Booking links address the PERSON; their eligible enrollment is resolved
    // server-side when the session is created.
    expect(rows[1].querySelector("a")).toHaveAttribute("href", "/coachee/peer-practice/u-far/book");
  });
});
