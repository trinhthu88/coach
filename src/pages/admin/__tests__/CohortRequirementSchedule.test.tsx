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
let requirementRows: unknown[] = [];
const req = (id: string, module: string, index: number, label: string, due: string, overridden = false, dflt = "2026-06-30") => ({
  requirement_id: id, programme_id: P, programme_name: "Emerging Leaders", module, requirement_index: index,
  requirement_label: label, training_week_id: module === "training" ? `w-${index}` : null,
  week_number: module === "training" ? index : null, due_on: due, default_due_on: dflt,
  is_overridden: overridden, has_activity: false,
});

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
  requirementRows = [
    req("c1", "coaching", 1, "Coaching Session 1", "2026-02-15", true),
    req("c2", "coaching", 2, "Coaching Session 2", "2026-06-30"),
    req("c3", "coaching", 3, "Coaching Session 3", "2026-06-30"),
    req("c4", "coaching", 4, "Coaching Session 4", "2026-06-30"),
    req("p1", "peer_coaching", 1, "Peer Practice 1", "2026-07-05", false, "2026-07-05"),
    req("p2", "peer_coaching", 2, "Peer Practice 2", "2026-07-05", false, "2026-07-05"),
    req("t1", "training", 1, "Week 1: Self-Awareness", "2026-01-05", false, "2026-01-05"),
    req("t2", "training", 2, "Week 2: Communication", "2026-01-12", false, "2026-01-12"),
  ];
  rpc.mockImplementation((name: string) => {
    if (name === "cohort_module_deadline_proposal") return Promise.resolve({ data: proposal, error: null });
    if (name === "admin_cohort_module_deadlines") return Promise.resolve({ data: savedDeadlines, error: null });
    if (name === "cohort_requirement_schedule_issues") return Promise.resolve({ data: [], error: null });
    if (name === "admin_set_cohort_module_deadlines") return Promise.resolve({ data: 1, error: null });
    if (name === "admin_cohort_requirement_schedule") return Promise.resolve({ data: requirementRows, error: null });
    if (name === "admin_requirement_integrity_issues") return Promise.resolve({ data: [], error: null });
    if (name === "admin_set_cohort_requirement_dates") return Promise.resolve({ data: 1, error: null });
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

  it("a new cohort sets one default per module; its requirements are dated once saved", async () => {
    render(<Harness cohortId={null} />);
    await screen.findByText(/4 required/);
    expect(screen.getAllByLabelText(/completion deadline/i)).toHaveLength(2);
    expect(screen.queryAllByTestId("schedule-requirement")).toHaveLength(0);
    expect(screen.getByText(/can be edited once the cohort is saved/i)).toBeInTheDocument();
  });

  it("an existing cohort shows one date per required unit, and one per selected Training week", async () => {
    render(<Harness cohortId="cohort-1" />);
    await screen.findByLabelText(/^Coaching Session 4 date$/);
    expect(screen.getAllByTestId("schedule-requirement").filter((r) => r.dataset.module === "coaching")).toHaveLength(4);
    expect(screen.getAllByTestId("schedule-requirement").filter((r) => r.dataset.module === "peer_coaching")).toHaveLength(2);
    expect(screen.getAllByTestId("schedule-requirement").filter((r) => r.dataset.module === "training")).toHaveLength(2);
    expect((screen.getByLabelText(/^Week 2: Communication date$/) as HTMLInputElement).value).toBe("2026-01-12");
    expect((screen.getByLabelText(/^Coaching Session 1 date$/) as HTMLInputElement).value).toBe("2026-02-15");
    // Training groups come first and have no module default.
    expect(screen.getAllByTestId("schedule-module")[0].dataset.module).toBe("training");
  });

  it("editing one requirement saves only that requirement's date", async () => {
    render(<Harness cohortId="cohort-1" />);
    const week2 = (await screen.findByLabelText(/^Week 2: Communication date$/)) as HTMLInputElement;
    fireEvent.change(week2, { target: { value: "2026-01-20" } });
    fireEvent.click(screen.getByText("save-harness"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("admin_set_cohort_requirement_dates", {
        p_cohort_id: "cohort-1",
        p_items: [{ requirement_id: "t2", due_on: "2026-01-20" }],
      })
    );
    expect(rpc).not.toHaveBeenCalledWith("admin_set_cohort_module_deadlines", expect.anything());
  });

  it("'apply to all' returns every requirement of the module to the default; only own dates change", async () => {
    render(<Harness cohortId="cohort-1" />);
    await screen.findByLabelText(/^Coaching Session 1 date$/);
    fireEvent.click(screen.getAllByRole("button", { name: /apply to all requirements/i })[0]);
    expect((screen.getByLabelText(/^Coaching Session 1 date$/) as HTMLInputElement).value).toBe("2026-06-30");
    fireEvent.click(screen.getByText("save-harness"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("admin_set_cohort_requirement_dates", {
        p_cohort_id: "cohort-1",
        p_items: [{ requirement_id: "c1", due_on: null }],
      })
    );
  });

  it("a requirement count that differs from the programme is flagged, never filled in", async () => {
    requirementRows = requirementRows.filter((r) => (r as { requirement_id: string }).requirement_id !== "c4");
    render(<Harness cohortId="cohort-1" />);
    expect(await screen.findByTestId("schedule-count-mismatch")).toHaveTextContent(/4 units are required but 3 requirements exist/);
    expect(screen.getAllByTestId("schedule-requirement").filter((r) => r.dataset.module === "coaching")).toHaveLength(3);
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
