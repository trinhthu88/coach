import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SponsorLeaderDetail from "../SponsorLeaderDetail";

const { useSponsorLeaderDataMock } = vi.hoisted(() => ({
  useSponsorLeaderDataMock: vi.fn(),
}));

vi.mock("@/hooks/sponsor/useSponsorLeaderData", () => ({
  useSponsorLeaderData: useSponsorLeaderDataMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "cohortDetail.header.title": "Back to cohort",
      "leaderDrawer.loadError": "Leader detail could not be loaded",
      "leaderDrawer.loadErrorDescription": "Please return to the roster and try again.",
      "leaderDrawer.retry": "Try again",
      "leaderDrawer.notFound": "Leader detail unavailable",
      "leaderDrawer.notFoundDescription": "This leader is not available.",
    }[key] ?? key),
  }),
}));

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/sponsor/cohorts/cohort-1/leaders/enrollment-1"]}>
      <Routes>
        <Route path="/sponsor/cohorts/:cohortId/leaders/:enrollmentId" element={<SponsorLeaderDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SponsorLeaderDetail", () => {
  beforeEach(() => {
    useSponsorLeaderDataMock.mockReset();
  });

  it("shows a load error instead of pretending an RPC failure is not found", () => {
    useSponsorLeaderDataMock.mockReturnValue({
      leader: null,
      journey: [],
      experience: { weeklyParticipation: [], learningBreakdown: [], coachingUtilisation: null },
      loading: false,
      error: "TypeError: Failed to fetch",
      retry: vi.fn(),
    });

    renderDetail();

    expect(screen.getByText("Leader detail could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("Leader detail unavailable")).not.toBeInTheDocument();
    expect(useSponsorLeaderDataMock).toHaveBeenCalledWith("enrollment-1", "cohort-1");
  });

  it("keeps a legitimate empty result as unavailable", () => {
    useSponsorLeaderDataMock.mockReturnValue({
      leader: null,
      journey: [],
      experience: { weeklyParticipation: [], learningBreakdown: [], coachingUtilisation: null },
      loading: false,
      error: null,
      retry: vi.fn(),
    });

    renderDetail();

    expect(screen.getByText("Leader detail unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Leader detail could not be loaded")).not.toBeInTheDocument();
  });
});