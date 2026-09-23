import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/i18n/config";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => {
    const user = { id: "learner-1" };
    return { user, session: { user }, role: "coachee", profile: { status: "active" }, isLoading: false };
  },
}));
vi.mock("@/hooks/useActiveEnrollment", () => ({
  useActiveEnrollment: () => ({ enrollmentId: "enr-1", loading: false, error: null }),
}));

import { ProtectedRoute } from "../ProtectedRoute";

/**
 * "View results" on a Skill Card opens /training/:weekId/quiz/:id, guarded by
 * module="quiz". Demo programmes carry quizzes in the Training checklist, not
 * as a separate Quiz module, and the guard used to send the learner to
 * /dashboard -- the link looked dead.
 */
function openQuizRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/training/w1/quiz/q1"]}>
        <Routes>
          <Route
            path="/training/:weekId/quiz/:assignmentId"
            element={<ProtectedRoute roles={["coach", "coachee"]} module="quiz"><div>quiz review</div></ProtectedRoute>}
          />
          <Route path="/dashboard" element={<div>dashboard page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const training = (components: string[]) => [
  { module: "training", enabled: true, config: { required: true, required_units: 4, learning_components: components } },
];

describe("quiz review route", () => {
  beforeEach(() => rpc.mockReset());

  it("opens when the programme's Training includes quizzes (no separate Quiz module)", async () => {
    rpc.mockResolvedValue({ data: training(["skill_cards", "quizzes", "reflections"]), error: null });
    openQuizRoute();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_enrollment_programme_modules", { p_enrollment_id: "enr-1" }));
    // The guard lets children through while modules load; judge it once settled.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("dashboard page")).toBeNull();
    expect(screen.getByText("quiz review")).toBeInTheDocument();
  });

  it("stays closed when the Training checklist leaves quizzes out", async () => {
    rpc.mockResolvedValue({ data: training(["skill_cards", "reflections"]), error: null });
    openQuizRoute();
    await waitFor(() => expect(screen.getByText("dashboard page")).toBeInTheDocument());
  });
});
