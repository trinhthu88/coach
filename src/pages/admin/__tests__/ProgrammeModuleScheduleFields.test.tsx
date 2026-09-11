import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import "@/i18n/config";
import i18n from "@/i18n/config";
import { ProgrammeModuleScheduleFields } from "../ProgrammeModuleScheduleFields";

const weeks = [
  { id: "week-1", weekNumber: 1, title: "Foundations" },
  { id: "week-2", weekNumber: 2, title: "Practice" },
];

function Harness({ initialConfig }: { initialConfig: Record<string, unknown> }) {
  const [config, setConfig] = useState(initialConfig);
  return (
    <>
      <ProgrammeModuleScheduleFields config={config} onChange={setConfig} trainingWeeks={weeks} />
      <output data-testid="config">{JSON.stringify(config)}</output>
    </>
  );
}

function currentConfig() {
  return JSON.parse(screen.getByTestId("config").textContent || "{}") as Record<string, unknown>;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("ProgrammeModuleScheduleFields", () => {
  it("updates common schedule fields while preserving unrelated configuration", () => {
    render(<Harness initialConfig={{ legacy_limit: 7, distribution_settings: { keep_me: true } }} />);

    fireEvent.click(screen.getByRole("switch", { name: "Required or optional" }));
    fireEvent.change(screen.getByLabelText("Required units"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Weight (optional)"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Schedule"), { target: { value: "monthly_frequency" } });
    fireEvent.change(screen.getByLabelText("Interval (months)"), { target: { value: "2" } });

    expect(currentConfig()).toEqual({
      legacy_limit: 7,
      required: true,
      required_units: 3,
      weight: 2.5,
      distribution_mode: "monthly_frequency",
      distribution_settings: { keep_me: true, interval_months: 2 },
    });
  });

  it("shows programme training weeks and requires one selection per required unit", () => {
    render(<Harness initialConfig={{
      required: true,
      required_units: 2,
      distribution_mode: "training_linked",
      distribution_settings: { training_week_ids: [], keep_me: true },
    }} />);

    expect(screen.getByText("Select exactly one training week for each required unit.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Week 1: Foundations" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Week 2: Practice" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Week 2: Practice" }));

    expect(currentConfig()).toMatchObject({
      distribution_settings: { training_week_ids: ["week-2"], keep_me: true },
    });
  });

  it("adds and edits custom milestone date, units, and window fields", () => {
    render(<Harness initialConfig={{
      required: true,
      required_units: 2,
      distribution_mode: "custom",
      distribution_settings: { milestones: [] },
    }} />);

    fireEvent.click(screen.getByRole("button", { name: "Add milestone" }));
    fireEvent.change(screen.getByLabelText("Due date 1"), { target: { value: "2026-10-15" } });
    fireEvent.change(screen.getByLabelText("Units 1"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Window end 1"), { target: { value: "2026-10-22" } });

    expect(currentConfig()).toMatchObject({
      distribution_settings: {
        milestones: [{ due_on: "2026-10-15", required_units: 2, window_end_on: "2026-10-22" }],
      },
    });
  });
});
