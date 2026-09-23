import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useAdminPeerDyads, useCreatePeerDyad, mutate } = vi.hoisted(() => ({
  useAdminPeerDyads: vi.fn(),
  useCreatePeerDyad: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("@/hooks/peer/useAdminPeerDyads", () => ({
  useAdminPeerDyads,
  useCreatePeerDyad,
}));

import "@/i18n/config";
import { FixedPeerDyadPanel } from "../FixedPeerDyadPanel";

const data = {
  enrollments: [
    { id: "e1", userId: "u1", displayName: "Ada Learner", status: "active" },
    { id: "e2", userId: "u2", displayName: "Grace Learner", status: "at_risk" },
    { id: "e3", userId: "u3", displayName: "Alan Learner", status: "active" },
  ],
  dyads: [
    {
      id: "d1",
      status: "active" as const,
      members: [
        { id: "e1", userId: "u1", displayName: "Ada Learner", status: "active" },
        { id: "e2", userId: "u2", displayName: "Grace Learner", status: "at_risk" },
      ],
    },
    {
      id: "d2",
      status: "closed" as const,
      members: [
        { id: "e3", userId: "u3", displayName: "Alan Learner", status: "active" },
      ],
    },
  ],
};

function renderPanel(cohortId: string | undefined) {
  return render(<FixedPeerDyadPanel cohortId={cohortId} programmeId="programme-1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAdminPeerDyads.mockReturnValue({ data, isLoading: false, isError: false });
  useCreatePeerDyad.mockReturnValue({ mutate, isPending: false });
});

describe("FixedPeerDyadPanel", () => {
  it("renders nothing until an Admin is editing a cohort", () => {
    const { container } = renderPanel(undefined);
    expect(container).toBeEmptyDOMElement();
    expect(useAdminPeerDyads).toHaveBeenCalledWith(undefined);
  });

  it("shows a loading state while assigned dyads are loading", () => {
    useAdminPeerDyads.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPanel("cohort-1");
    expect(screen.getByTestId("fixed-peer-dyad-panel")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByTestId("peer-dyad-row")).not.toBeInTheDocument();
  });

  it("shows a database error instead of presenting an empty dyad list", () => {
    useAdminPeerDyads.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPanel("cohort-1");
    expect(screen.getByRole("alert")).toHaveTextContent("The Peer cohort list could not be loaded.");
  });

  it("counts only active dyads and preserves the historical closed row", () => {
    renderPanel("cohort-1");
    expect(screen.getByTestId("fixed-peer-dyad-panel")).toHaveTextContent("1");
    const rows = screen.getAllByTestId("peer-dyad-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Ada Learner · Grace Learner");
    expect(rows[1]).toHaveTextContent("Incomplete dyad");
    expect(rows[1]).toHaveTextContent("closed");
  });

  it("assigns two different enrollments through the Admin dyad mutation", () => {
    renderPanel("cohort-1");
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "e1" } });
    fireEvent.change(selects[1], { target: { value: "e3" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign dyad" }));
    expect(mutate).toHaveBeenCalledWith(
      { leftEnrollmentId: "e1", rightEnrollmentId: "e3" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("does not allow assigning the same enrollment twice", () => {
    renderPanel("cohort-1");
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "e1" } });
    fireEvent.change(selects[1], { target: { value: "e1" } });
    expect(screen.getByRole("button", { name: "Assign dyad" })).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not expose a cohort-permission grant control", () => {
    renderPanel("cohort-1");
    expect(screen.queryByText(/permission/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});