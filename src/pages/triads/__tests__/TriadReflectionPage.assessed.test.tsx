import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Decision 2 (assessment spec): when the Triad is assessed, the reflection form
 * tells the learner an assessor will read it. The flag comes from the server
 * (learner_triad_session_assessed, 20261006220000); nothing is derived here.
 */
const { assessedState } = vi.hoisted(() => ({ assessedState: { assessed: false } }));

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-a" } }) }));
vi.mock("../../session/SessionGoalRatings", () => ({ SessionGoalRatings: () => null }));
vi.mock("@/hooks/triads/useMyTriads", () => ({
  useTriadSessionEntry: () => ({
    loading: false,
    entry: {
      enrollmentId: "enrollment-a",
      session: { id: "t1", status: "completed" },
      members: [{ slot: 1, full_name: "Alex A" }],
    },
  }),
}));
vi.mock("@/hooks/triads/useTriadReflection", () => ({
  useTriadReflectionQuestions: () => ({ questions: [], loading: false }),
  useTriadSessionReflections: () => ({ reflections: [], loading: false }),
  useTriadReflection: () => ({ submitReflection: vi.fn(), submitting: false }),
  useTriadSessionAssessed: () => ({ assessed: assessedState.assessed, loading: false }),
}));

import i18n from "@/i18n/config";
import TriadReflectionPage from "../TriadReflectionPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/triads/t1/reflection"]}>
      <Routes>
        <Route path="/triads/:sessionId/reflection" element={<TriadReflectionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TriadReflectionPage — assessor notice", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows the notice when the server says this Triad is assessed", () => {
    assessedState.assessed = true;
    renderPage();
    expect(screen.getByTestId("triad-assessed-notice")).toHaveTextContent(/An assessor will read this reflection/);
  });

  it("shows it in Vietnamese", async () => {
    assessedState.assessed = true;
    await i18n.changeLanguage("vi");
    renderPage();
    expect(screen.getByTestId("triad-assessed-notice")).toHaveTextContent(/Người đánh giá sẽ đọc/);
  });

  it("shows no notice for a Triad that is not assessed", () => {
    assessedState.assessed = false;
    renderPage();
    expect(screen.queryByTestId("triad-assessed-notice")).toBeNull();
  });
});
