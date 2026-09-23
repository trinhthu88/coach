import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GoalDialog } from "../GoalDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("GoalDialog", () => {
  it("requires Start and Target before creating a goal", () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<GoalDialog onAdd={onAdd} />);

    fireEvent.click(screen.getByRole("button", { name: "goalDialog.newGoal" }));
    fireEvent.change(screen.getByPlaceholderText("goalDialog.titlePlaceholder"), {
      target: { value: "Lead better meetings" },
    });

    expect(screen.getByRole("button", { name: "goalDialog.saveGoal" })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("sends the required baseline ratings when creating a goal", () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<GoalDialog onAdd={onAdd} />);

    fireEvent.click(screen.getByRole("button", { name: "goalDialog.newGoal" }));
    fireEvent.change(screen.getByPlaceholderText("goalDialog.titlePlaceholder"), {
      target: { value: "Lead better meetings" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "goalDialog.startRatingLabel" }), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "goalDialog.targetRatingLabel" }), {
      target: { value: "75" },
    });

    fireEvent.click(screen.getByRole("button", { name: "goalDialog.saveGoal" }));

    expect(onAdd).toHaveBeenCalledWith({
      title: "Lead better meetings",
      description: null,
      target_date: null,
      start_rating: 25,
      target_rating: 75,
    });
  });
});