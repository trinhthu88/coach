import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
let savedRows: unknown[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    then: (resolve: (v: unknown) => void) => resolve({ data: savedRows, error: null }),
  };
  return { supabase: { rpc: (...args: unknown[]) => rpc(...args), from: () => query } };
});

import "@/i18n/config";
import { useCohortRequirementSchedule } from "@/hooks/admin/useCohortRequirementSchedule";
import { CohortRequirementSchedule } from "../cohorts/CohortRequirementSchedule";

const P = "prog-1";
const proposal = [
  { programme_id: P, module: "coaching", ordinal: 1, due_on: "2026-02-19", units: 1, training_week_id: null, generation_method: "evenly_distributed" },
  { programme_id: P, module: "coaching", ordinal: 2, due_on: "2026-04-05", units: 1, training_week_id: null, generation_method: "evenly_distributed" },
  { programme_id: P, module: "coaching", ordinal: 3, due_on: "2026-05-20", units: 1, training_week_id: null, generation_method: "evenly_distributed" },
  { programme_id: P, module: "coaching", ordinal: 4, due_on: "2026-07-05", units: 1, training_week_id: null, generation_method: "evenly_distributed" },
  { programme_id: P, module: "peer_coaching", ordinal: 1, due_on: "2026-04-05", units: 1, training_week_id: null, generation_method: "evenly_distributed" },
  { programme_id: P, module: "peer_coaching", ordinal: 2, due_on: "2026-07-05", units: 1, training_week_id: null, generation_method: "evenly_distributed" },
];

function Harness({ cohortId, start = "2026-01-05", end = "2026-07-05", savedStart = "2026-01-05" }: { cohortId: string | null; start?: string; end?: string; savedStart?: string }) {
  const schedule = useCohortRequirementSchedule({ open: true, cohortId, programmeId: P, start, end });
  return (
    <>
      <CohortRequirementSchedule schedule={schedule} programmeNames={{ [P]: "Emerging Leaders" }} datesChanged={!!cohortId && savedStart !== start} canRegenerate />
      <button type="button" onClick={() => void schedule.save(cohortId ?? "new-cohort")}>save-harness</button>
    </>
  );
}

beforeEach(() => {
  rpc.mockReset();
  savedRows = [];
  rpc.mockImplementation((name: string) => {
    if (name === "cohort_requirement_schedule_proposal") return Promise.resolve({ data: proposal, error: null });
    if (name === "cohort_requirement_schedule_issues") return Promise.resolve({ data: [], error: null });
    if (name === "admin_save_cohort_requirement_dates") return Promise.resolve({ data: 1, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

describe("Admin cohort requirement schedule", () => {
  it("creating a cohort shows the programme policy's proposed dates per module", async () => {
    render(<Harness cohortId={null} />);
    const coaching = await screen.findByText(/Coaching — 4 required/);
    expect(coaching).toBeInTheDocument();
    expect(screen.getByText(/Peer coaching — 2 required/)).toBeInTheDocument();
    const inputs = screen.getAllByLabelText(/Coaching requirement \d due date/) as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(["2026-02-19", "2026-04-05", "2026-05-20", "2026-07-05"]);
    expect(rpc).toHaveBeenCalledWith("cohort_requirement_schedule_proposal", { p_programme_id: P, p_start: "2026-01-05", p_end: "2026-07-05" });
  });

  it("an Admin edit saves only that requirement unit", async () => {
    render(<Harness cohortId={null} />);
    const input = (await screen.findByLabelText("Coaching requirement 2 due date")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-04-12" } });
    expect(screen.getByText("Edited")).toBeInTheDocument();
    fireEvent.click(screen.getByText("save-harness"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("admin_save_cohort_requirement_dates", {
        p_cohort_id: "new-cohort",
        p_items: [{ programme_id: P, module: "coaching", ordinal: 2, due_on: "2026-04-12" }],
      })
    );
  });

  it("an existing cohort shows its SAVED dates; changing cohort dates does not re-derive them", async () => {
    savedRows = proposal.map((p) => ({ ...p, generated_due_on: p.due_on, is_overridden: p.module === "coaching" && p.ordinal === 2 ? true : false })).map((r) =>
      r.module === "coaching" && r.ordinal === 2 ? { ...r, due_on: "2026-04-12" } : r
    );
    render(<Harness cohortId="cohort-1" start="2026-02-01" savedStart="2026-01-05" />);
    const input = (await screen.findByLabelText("Coaching requirement 2 due date")) as HTMLInputElement;
    expect(input.value).toBe("2026-04-12");
    expect(screen.getByText("Edited")).toBeInTheDocument();
    expect(screen.getByTestId("schedule-dates-changed")).toBeInTheDocument();
    // No proposal was fetched just because the cohort dates changed.
    expect(rpc).not.toHaveBeenCalledWith("cohort_requirement_schedule_proposal", expect.anything());
  });

  it("Regenerate schedule shows the proposed changes for review and saves them only when confirmed", async () => {
    savedRows = proposal.map((p) => (p.module === "coaching" && p.ordinal === 2 ? { ...p, due_on: "2026-04-12", generated_due_on: "2026-04-05", is_overridden: true } : { ...p, generated_due_on: p.due_on, is_overridden: false }));
    render(<Harness cohortId="cohort-1" />);
    await screen.findByLabelText("Coaching requirement 2 due date");
    fireEvent.click(screen.getByRole("button", { name: /Regenerate schedule/ }));
    const review = await screen.findByTestId("schedule-regenerate-review");
    const changes = within(review).getAllByTestId("schedule-change");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toHaveTextContent("Coaching 2");
    expect(rpc).not.toHaveBeenCalledWith("admin_save_cohort_requirement_dates", expect.anything());

    fireEvent.click(within(review).getByRole("button", { name: "Use regenerated dates" }));
    fireEvent.click(screen.getByText("save-harness"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        "admin_save_cohort_requirement_dates",
        expect.objectContaining({ p_cohort_id: "cohort-1", p_regenerate: true })
      )
    );
  });
});
