import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import "@/i18n/config";
import { DevelopmentSessionsList } from "../DevelopmentSessionsList";
import type { DevelopmentSessionItem } from "@/hooks/journey/developmentSessionTypes";

const baseItem: DevelopmentSessionItem = {
  id: "peer-p1",
  enrollmentId: "enrollment-1",
  type: "peer_coaching",
  title: "Peer practice",
  startTime: "2026-09-25T10:00:00Z",
  status: "completed",
  sourceId: "p1",
  sourceType: "peer_sessions",
};

describe("DevelopmentSessionsList", () => {
  // Regression test: SessionDetail resolves sessions vs peer_sessions from
  // the `?type=` query param. A peer-coaching item linking to `/sessions/:id`
  // with no type param makes it look up the id in the wrong table.
  it("links a peer-coaching item to /sessions/:id?type=peer, not the bare coaching path", () => {
    render(
      <MemoryRouter>
        <DevelopmentSessionsList sessions={[baseItem]} />
      </MemoryRouter>
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/sessions/p1?type=peer");
  });

  it("links a coaching item to the bare /sessions/:id path", () => {
    render(
      <MemoryRouter>
        <DevelopmentSessionsList sessions={[{ ...baseItem, id: "coaching-s1", type: "coaching", sourceId: "s1", sourceType: "sessions" }]} />
      </MemoryRouter>
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/sessions/s1");
  });

  it("shows programme and cohort context resolved from the selected enrollment, not inferred", () => {
    render(
      <MemoryRouter>
        <DevelopmentSessionsList sessions={[baseItem]} programmeName="Emerging Leaders Programme" cohortName="September 2026 Cohort" />
      </MemoryRouter>
    );
    expect(screen.getByText("Emerging Leaders Programme · September 2026 Cohort")).toBeInTheDocument();
  });

  it("omits the programme/cohort line when neither is available", () => {
    render(
      <MemoryRouter>
        <DevelopmentSessionsList sessions={[baseItem]} />
      </MemoryRouter>
    );
    expect(screen.queryByText("Emerging Leaders Programme · September 2026 Cohort")).not.toBeInTheDocument();
  });

  it("links a mentoring item to its dedicated mentoring detail route", () => {
    render(
      <MemoryRouter>
        <DevelopmentSessionsList
          sessions={[{ ...baseItem, id: "mentoring-m1", type: "mentoring", sourceId: "m1", sourceType: "mentoring_sessions" }]}
        />
      </MemoryRouter>
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/mentoring/sessions/m1");
  });
});
