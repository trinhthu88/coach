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

function Harness({ module = "coaching", initialConfig }: { module?: string; initialConfig: Record<string, unknown> }) {
  const [config, setConfig] = useState(initialConfig);
  return (
    <>
      <ProgrammeModuleScheduleFields module={module} config={config} onChange={setConfig} trainingWeeks={weeks} />
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
  it("sets what the module requires while preserving unrelated configuration", () => {
    render(<Harness initialConfig={{ legacy_limit: 7, distribution_settings: { keep_me: true } }} />);

    fireEvent.click(screen.getByRole("switch", { name: "Required or optional" }));
    fireEvent.change(screen.getByLabelText("Required units"), { target: { value: "3" } });

    expect(currentConfig()).toEqual({
      legacy_limit: 7,
      required: true,
      required_units: 3,
      distribution_settings: { keep_me: true },
    });
  });

  it("offers no schedule: the deadline belongs to the cohort", () => {
    render(<Harness initialConfig={{ required: true, required_units: 3 }} />);

    expect(screen.queryByLabelText("Schedule")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Interval (months)")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add milestone" })).not.toBeInTheDocument();
    expect(screen.getByTestId("module-deadline-note")).toHaveTextContent(/cohort/i);
  });

  it("shows training weeks for Training only, one per required unit", () => {
    render(<Harness module="training" initialConfig={{
      required: true,
      required_units: 2,
      distribution_settings: { training_week_ids: [], keep_me: true },
    }} />);

    expect(screen.getByText("Select exactly one training week for each required unit.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Week 1: Foundations" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Week 2: Practice" }));

    expect(currentConfig()).toMatchObject({
      distribution_settings: { training_week_ids: ["week-2"], keep_me: true },
    });
  });

  it("does not offer training weeks on a session module", () => {
    render(<Harness module="coaching" initialConfig={{ required: true, required_units: 2 }} />);
    expect(screen.queryByRole("checkbox", { name: "Week 1: Foundations" })).not.toBeInTheDocument();
  });
});
