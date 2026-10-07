import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@/i18n/config";

const rpc = vi.hoisted(() => vi.fn());
const TABLES: Record<string, unknown[]> = {
  user_roles: [{ user_id: "learner-1", role: "coachee" }, { user_id: "coach-1", role: "coach" }],
  profiles: [{ id: "learner-1", full_name: "Nguyen An", email: "an@example.test", status: "active" },
             { id: "coach-1", full_name: "Coach Hoa", email: "hoa@example.test", status: "active" }],
  coach_profiles: [{ id: "coach-1", approval_status: "active" }],
  // prog-1 runs Coaching only (an engagement can use it); prog-2 does not.
  programme_modules: [{ programme_id: "prog-1", module: "coaching" }, { programme_id: "prog-2", module: "coaching" },
                      { programme_id: "prog-2", module: "training" }],
  programmes: [{ id: "prog-1", name: "Executive Coaching" }, { id: "prog-2", name: "Leadership Journey" }],
  organizations: [],
};
function query(table: string) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq", "order"]) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: TABLES[table] ?? [], error: null }).then(resolve);
  return q;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => query(t), rpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NewCoachingEngagementDialog } from "../NewCoachingEngagementDialog";

async function createWith(initial: { learnerId?: string; coachId?: string; programmeId?: string }) {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: "cohort-1", error: null });
  render(<NewCoachingEngagementDialog open onOpenChange={() => {}} onCreated={() => {}} initial={initial} />);
  fireEvent.change(await screen.findByLabelText("Start"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("End"), { target: { value: "2027-03-01" } });
}

describe("New coaching engagement from a starting point (a referral)", () => {
  it("creates the engagement for the given learner, Coach and programme", async () => {
    await createWith({ learnerId: "learner-1", coachId: "coach-1", programmeId: "prog-1" });
    const create = screen.getByRole("button", { name: "Create engagement" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("admin_create_coaching_engagement", expect.objectContaining({
      p_learner_id: "learner-1", p_coach_id: "coach-1", p_programme_id: "prog-1",
      p_start: "2026-11-01", p_end: "2027-03-01",
    }));
  });

  it("leaves a suggested programme that cannot run as an engagement for the Admin to choose", async () => {
    await createWith({ learnerId: "learner-1", coachId: "coach-1", programmeId: "prog-2" });
    // Learner and Coach are set, the dates are set, but no programme: nothing can be created yet.
    await waitFor(() => expect(screen.getByRole("button", { name: "Create engagement" })).toBeDisabled());
  });
});
