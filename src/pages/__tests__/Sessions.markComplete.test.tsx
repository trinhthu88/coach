import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// A Coaching session the Coach held yesterday: "Mark complete" must go through
// complete_coaching_session(). transition_session_status() only confirms
// Coaching (20261005100000_session_write_lockdown).
const sessionRow = {
  id: "sess1",
  coach_id: "coach1",
  coachee_id: "coachee1",
  enrollment_id: "enrol1",
  topic: "Leadership focus",
  start_time: new Date(Date.now() - 86400000).toISOString(),
  duration_minutes: 45,
  status: "confirmed",
  action_items: [],
  coachee_rating: null,
  coachee_rating_comment: null,
};

const rpc = vi.fn(async (..._args: unknown[]) => ({ data: null, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        in: () => table === "profiles"
          ? Promise.resolve({ data: [{ id: "coachee1", full_name: "Minh Tran", email: "m@x.com", avatar_url: null }] })
          : query,
        update: () => ({ eq: async () => ({ error: null }) }),
        order: async () => (table === "sessions" ? { data: [sessionRow] } : { data: [] }),
      };
      return query;
    },
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "coach1" }, role: "coach" as const }),
}));

vi.mock("@/hooks/useActiveEnrollment", () => ({
  useActiveEnrollment: () => ({ enrollmentId: null, ownEnrollmentIds: [], loading: false, error: null }),
}));

import "@/i18n/config";
import i18n from "@/i18n/config";
import Sessions from "../Sessions";

beforeEach(async () => {
  rpc.mockClear();
  await i18n.changeLanguage("en");
});

describe("Sessions list: Mark complete", () => {
  it("completes a Coaching session through complete_coaching_session", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Sessions />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // A held session is listed under Past (Radix Tabs activate on mousedown).
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /^Past/ }), { button: 0 });
    const button = await screen.findByRole("button", { name: i18n.t("sessions:list.markComplete") });
    fireEvent.click(button);

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("complete_coaching_session", { p_session_id: "sess1" });
    expect(rpc).not.toHaveBeenCalledWith("transition_session_status", expect.anything());
  });
});
