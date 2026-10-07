import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Only an Admin-assigned dyad session earns a Peer requirement; a session
// booked from the Coach opt-in pool is practice (20261005140000). The
// Sessions hub says so on the row, and only on that row.
const inAWeek = new Date(Date.now() + 7 * 86400000).toISOString();

const practiceRow = {
  id: "practice1",
  peer_coach_id: "coach2",
  peer_coachee_id: "me",
  enrollment_id: "enrol1",
  topic: "Practice with a Coach",
  start_time: inAWeek,
  duration_minutes: 45,
  status: "confirmed",
  action_items: [],
  coachee_rating: null,
  coachee_rating_comment: null,
};

const dyadRow = {
  id: "dyad1",
  peer_provider_id: "partner1",
  peer_receiver_id: "me",
  enrollment_id: "enrol1",
  topic: "Session with my Peer partner",
  start_time: inAWeek,
  duration_minutes: 45,
  status: "confirmed",
  action_items: [],
  provider_notes: null,
  receiver_notes: null,
  receiver_rating: null,
  receiver_rating_comment: null,
};

const auth = { role: "coach" as "coach" | "coachee" };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => ({
      data:
        name === "learner_session_history"
          ? [
              // The enrollment's history holds both: the dyad session (Peer 1)
              // and the practice session, which holds no requirement.
              { source_id: "dyad1", requirement_unit_number: 1, requirement_due_on: "2026-11-20" },
              { source_id: "practice1", requirement_unit_number: null, requirement_due_on: null },
            ]
          : name === "learner_next_session_by_module"
            ? [{ module: "peer_coaching", next_session_at: "2026-11-10T03:00:00Z", session_key: "k" }]
            : null,
      error: null,
    }),
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        in: () => query,
        order: async () => ({
          data: table === "peer_sessions" ? [practiceRow] : table === "coachee_peer_sessions" ? [dyadRow] : [],
        }),
        // The viewer's own participations file each Peer row under their enrollment.
        then: (resolve: (value: { data: unknown[]; error: null }) => void) =>
          resolve({
            data: table === "peer_session_participants"
              ? [
                  { session_kind: "peer", peer_session_id: "practice1", enrollment_id: "enrol1" },
                  { session_kind: "coachee_peer", peer_session_id: "dyad1", enrollment_id: "enrol1" },
                ]
              : [],
            error: null,
          }),
      };
      return query;
    },
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "me" }, role: auth.role }),
}));

vi.mock("@/hooks/useActiveEnrollment", () => ({
  useActiveEnrollment: () => ({ enrollmentId: "enrol1", ownEnrollmentIds: ["enrol1"], loading: false, error: null }),
}));

import "@/i18n/config";
import i18n from "@/i18n/config";
import Sessions from "../Sessions";

function renderSessions() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sessions />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Sessions hub: Peer practice", () => {
  it("labels a Coach opt-in pool session as practice that earns no Peer requirement", async () => {
    auth.role = "coach";
    renderSessions();
    expect(await screen.findByText("Practice with a Coach")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("sessions:list.peerPracticeNoCredit"))).toBeInTheDocument();
    expect(i18n.t("sessions:list.peerPracticeNoCredit")).toMatch(/earns no Peer requirement/);
  });

  it("labels a dyad session with its Peer requirement and shows the next session per module (Prompt 9b)", async () => {
    auth.role = "coachee";
    renderSessions();
    expect(await screen.findByText("Session with my Peer partner")).toBeInTheDocument();
    expect(screen.getByText(/Peer 1/)).toBeInTheDocument();
    expect(screen.getByTestId("next-sessions")).toHaveTextContent("Peer");
  });

  it("does not label a dyad session as practice", async () => {
    auth.role = "coachee";
    renderSessions();
    expect(await screen.findByText("Session with my Peer partner")).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("sessions:list.peerPracticeNoCredit"))).not.toBeInTheDocument();
  });
});
