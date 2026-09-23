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

function renderPanel(cohortId: string | undefined = "cohort-1") {
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
    expect(useAdminPeerDyads).not.toHaveBeenCalled();
  });

  it("shows a loading state while assigned dyads are loading", () => {
    useAdminPeerDyads.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderPanel();
    expect(screen.getByTestId("fixed-peer-dyad-panel")).toBeInTheDocument();
    expect(screen.getByRole("status", { hidden: true })).toBeInTheDocument();
  });

  it("shows a database error instead of presenting an empty dyad list", () => {
    useAdminPeerDyads.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPanel();
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load peer configuration.");
  });

  it("counts only active dyads and preserves the historical closed row", () => {
    renderPanel();
    expect(screen.getByTestId("fixed-peer-dyad-panel")).toHaveTextContent("1");
    const rows = screen.getAllByTestId("peer-dyad-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Ada Learner · Grace Learner");
    expect(rows[1]).toHaveTextContent("Alan Learner");
    expect(rows[1]).toHaveTextContent("closed");
  });

  it("assigns two different enrollments through the Admin dyad mutation", () => {
    renderPanel();
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
    renderPanel();
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "e1" } });
    fireEvent.change(selects[1], { target: { value: "e1" } });
    expect(screen.getByRole("button", { name: "Assign dyad" })).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not expose a cohort-permission grant control", () => {
    renderPanel();
    expect(screen.queryByText(/permission/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});