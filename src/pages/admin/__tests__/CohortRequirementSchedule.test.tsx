import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import "@/i18n/config";
import { useCohortRequirementSchedule } from "@/hooks/admin/useCohortRequirementSchedule";
import { CohortRequirementSchedule } from "../cohorts/CohortRequirementSchedule";

const P = "prog-1";
const proposal = [
  { programme_id: P, module: "coaching", required_units: 4, completion_deadline: "2026-07-05" },
  { programme_id: P, module: "peer_coaching", required_units: 2, completion_deadline: "2026-07-05" },
];
let savedDeadlines: unknown[] = [];

function Harness({ cohortId, start = "2026-01-05", end = "2026-07-05", savedStart = "2026-01-05" }: { cohortId: string | null; start?: string; end?: string; savedStart?: string }) {
  const schedule = useCohortRequirementSchedule({ open: true, cohortId, programmeId: P, start, end });
  return (
    <>
      <CohortRequirementSchedule
        schedule={schedule}
        programmeNames={{ [P]: "Emerging Leaders" }}
        datesChanged={!!cohortId && savedStart !== start}
      />
      <button type="button" onClick={() => void schedule.save(cohortId ?? "new-cohort")}>save-harness</button>
    </>
  );
}

beforeEach(() => {
  rpc.mockReset();
  savedDeadlines = [
    { programme_id: P, programme_name: "Emerging Leaders", module: "coaching", required_units: 4, scheduled_units: 4, completion_deadline: "2026-06-30", source: "admin" },
    { programme_id: P, programme_name: "Emerging Leaders", module: "peer_coaching", required_units: 2, scheduled_units: 2, completion_deadline: "2026-07-05", source: "cohort_end" },
  ];
  rpc.mockImplementation((name: string) => {
    if (name === "cohort_module_deadline_proposal") return Promise.resolve({ data: proposal, error: null });
    if (name === "admin_cohort_module_deadlines") return Promise.resolve({ data: savedDeadlines, error: null });
    if (name === "cohort_requirement_schedule_issues") return Promise.resolve({ data: [], error: null });
    if (name === "admin_set_cohort_module_deadlines") return Promise.resolve({ data: 1, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

describe("Admin cohort completion deadlines", () => {
  it("creating a cohort proposes the cohort end date for every required module", async () => {
    render(<Harness cohortId={null} />);
    expect(await screen.findByText(/4 required/)).toBeInTheDocument();
    expect(screen.getByText(/2 required/)).toBeInTheDocument();
    const inputs = screen.getAllByLabelText(/completion deadline/i) as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(["2026-07-05", "2026-07-05"]);
    expect(rpc).toHaveBeenCalledWith("cohort_module_deadline_proposal", { p_programme_id: P, p_end: "2026-07-05" });
  });

  it("there is one date per module, not one per required unit", async () => {
    render(<Harness cohortId={null} />);
    await screen.findByText(/4 required/);
    // Four required Coaching units, one Coaching date.
    expect(screen.getAllByLabelText(/completion deadline/i)).toHaveLength(2);
  });

  it("an Admin edit saves that module's deadline", async () => {
    render(<Harness cohortId={null} />);
    const input = (await screen.findByLabelText(/^Coaching completion deadline$/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-06-20" } });
    expect(screen.getByText("Edited")).toBeInTheDocument();
    fireEvent.click(screen.getByText("save-harness"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("admin_set_cohort_module_deadlines", {
        p_cohort_id: "new-cohort",
        p_items: [{ programme_id: P, module: "coaching", completion_deadline: "2026-06-20" }],
      })
    );
  });

  it("an existing cohort shows its SAVED deadlines; changing cohort dates does not re-derive them", async () => {
    render(<Harness cohortId="cohort-1" start="2026-02-01" savedStart="2026-01-05" />);
    const input = (await screen.findByLabelText(/^Coaching completion deadline$/i)) as HTMLInputElement;
    expect(input.value).toBe("2026-06-30");
    expect(screen.getByTestId("schedule-dates-changed")).toBeInTheDocument();
    // No proposal was fetched just because the cohort dates changed.
    expect(rpc).not.toHaveBeenCalledWith("cohort_module_deadline_proposal", expect.anything());
  });

  it("reports a module the cohort cannot schedule instead of hiding it", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "admin_cohort_module_deadlines") return Promise.resolve({ data: savedDeadlines, error: null });
      if (name === "cohort_requirement_schedule_issues") {
        return Promise.resolve({
          data: [{ programme_id: P, module: "mentoring", issue: "missing_deadline", required_units: 2, scheduled_units: 0 }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    render(<Harness cohortId="cohort-1" />);
    const issues = await screen.findByTestId("schedule-issues");
    expect(issues).toHaveTextContent(/no completion deadline is set/i);
  });
});
