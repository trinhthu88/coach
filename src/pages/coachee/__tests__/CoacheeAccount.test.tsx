import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const profileEditorSpy = vi.fn();
const availabilitySpy = vi.fn();

vi.mock("@/pages/CoacheeProfileEditor", () => ({
  default: (props: { embedded?: boolean }) => {
    profileEditorSpy(props);
    return <div>Profile form content</div>;
  },
}));
vi.mock("@/pages/CoacheeAvailability", () => ({
  default: (props: { embedded?: boolean }) => {
    availabilitySpy(props);
    return <div>Availability calendar content</div>;
  },
}));

import "@/i18n/config";
import CoacheeAccount from "../CoacheeAccount";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CoacheeAccount />
    </MemoryRouter>
  );
}

describe("CoacheeAccount", () => {
  it("renders the Profile tab by default, embedded (no duplicate page header)", () => {
    renderAt("/coachee/profile");
    expect(screen.getByText("Profile form content")).toBeInTheDocument();
    expect(profileEditorSpy).toHaveBeenCalledWith({ embedded: true });
  });

  it("renders the Availability tab when ?tab=availability is present — the redirect target from the old standalone route", () => {
    renderAt("/coachee/profile?tab=availability");
    expect(screen.getByText("Availability calendar content")).toBeInTheDocument();
    expect(availabilitySpy).toHaveBeenCalledWith({ embedded: true });
  });

  it("switches tabs on click without navigating away from the combined workspace", async () => {
    renderAt("/coachee/profile");
    expect(screen.getByText("Profile form content")).toBeInTheDocument();
    const trigger = screen.getByRole("tab", { name: "Availability" });
    // Radix Tabs' default activationMode fires on focus, not plain click —
    // fireEvent.click alone doesn't dispatch the preceding focus Radix
    // listens for, so focus explicitly first (mirrors real pointer
    // interaction, which focuses the element before the click completes).
    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText("Availability calendar content")).toBeInTheDocument());
  });
});
