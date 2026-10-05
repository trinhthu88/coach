import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The Coach opt-in pool is practice: only a session with the Admin-assigned
// Peer partner earns a Peer requirement (20261005140000).
vi.mock("@/hooks/coaches/useAllowedCoaches", () => ({
  useOptedInPeerCoaches: () => ({ coaches: [], loading: false, error: null, reload: () => undefined }),
}));

import "@/i18n/config";
import i18n from "@/i18n/config";
import CoachPeerCoaching from "../CoachPeerCoaching";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("CoachPeerCoaching", () => {
  it("says the pool is practice that does not count towards Peer requirements", () => {
    render(
      <MemoryRouter>
        <CoachPeerCoaching />
      </MemoryRouter>,
    );
    const notice = screen.getByTestId("peer-practice-notice");
    expect(notice).toHaveTextContent(/practice/i);
    expect(notice).toHaveTextContent(/don't count towards your programme's Peer requirements/);
  });

  it("has the notice in Vietnamese too", async () => {
    await i18n.changeLanguage("vi");
    render(
      <MemoryRouter>
        <CoachPeerCoaching />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("peer-practice-notice")).toHaveTextContent(/thực hành/);
  });
});
