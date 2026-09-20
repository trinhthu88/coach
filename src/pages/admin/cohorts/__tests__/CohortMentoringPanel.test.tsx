import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, auth } = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, auth } }));

import "@/i18n/config";
import { CohortMentoringPanel } from "../CohortMentoringPanel";

const upsert = vi.fn().mockResolvedValue({ error: null });

/**
 * A Mentor is a Coach with a cohort Mentoring assignment, so the candidates
 * come from the Coach population -- NOT from mentor_profiles, which is what
 * made this panel show "no mentors exist yet" on a system full of Coaches.
 *
 * Coach A: assigned, active account.
 * Coach B: assigned, but the account is inactive -- assigned yet unbookable.
 * Coach C: active Coach, unassigned candidate.
 */
function mockTables(assignments = [
  { mentor_user_id: "a", is_active: true, assigned_at: "2026-01-01" },
  { mentor_user_id: "b", is_active: true, assigned_at: "2026-01-01" },
], coachIds = ["a", "b", "c", "d"]) {
  from.mockImplementation((table: string) => {
    if (table === "cohort_mentors") {
      return {
        select: () => ({ eq: () => Promise.resolve({ data: assignments, error: null }) }),
        upsert,
      };
    }
    if (table === "user_roles") {
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: coachIds.map((id) => ({ user_id: id })),
              error: null,
            }),
        }),
      };
    }
    if (table === "profiles") {
      return {
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [
                { id: "a", full_name: "Coach A", status: "active" },
                { id: "b", full_name: "Coach B", status: "inactive" },
                { id: "c", full_name: "Coach C", status: "active" },
                { id: "d", full_name: "Coach D", status: "inactive" },
              ],
            }),
        }),
      };
    }
    if (table === "coach_profiles") {
      return {
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [{ id: "a", title: "Executive Coach" }],
            }),
        }),
      };
    }
    // mentor_profiles must never be consulted for eligibility.
    if (table === "mentor_profiles") throw new Error("mentor_profiles must not decide Mentor eligibility");
    return { select: () => ({ in: () => Promise.resolve({ data: [] }) }) };
  });
}

function renderPanel(cohortId: string | undefined = "cohort-1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CohortMentoringPanel cohortId={cohortId} />
    </QueryClientProvider>,
  );
}

describe("CohortMentoringPanel", () => {
  beforeEach(() => {
    from.mockReset();
    upsert.mockClear();
    mockTables();
  });

  it("lists assigned mentors and unassigned candidates together", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-mentor-row");
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.getAttribute("data-assigned") === "true")).toHaveLength(2);
  });

  // The flag is the COACH ACCOUNT's state. There is no mentor profile to be
  // inactive: a Mentor is a Coach with an assignment.
  it("flags an assigned Coach whose account is inactive", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-mentor-row");
    const b = rows.find((r) => r.textContent?.includes("Coach B"))!;
    // Assigned to the cohort, but unbookable — the cohort looks staffed and is not.
    expect(b).toHaveAttribute("data-assigned", "true");
    expect(b).toHaveAttribute("data-account-active", "false");
    expect(screen.getByTestId("cohort-mentoring-inactive-warning")).toBeInTheDocument();
  });

  it("does not offer an inactive Coach who is not already assigned", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-mentor-row");
    expect(rows).toHaveLength(3);
    expect(screen.queryByText("Coach D")).not.toBeInTheDocument();
  });

  it("assigns a candidate mentor to the cohort", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-mentor-row");
    const c = rows.find((r) => r.textContent?.includes("Coach C"))!;
    fireEvent.click(c.querySelector("button, input")!);
    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert.mock.calls[0][0]).toMatchObject({
      cohort_id: "cohort-1",
      mentor_user_id: "c",
      is_active: true,
    });
  });

  it("unassigns by deactivating, so delivery history survives", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-mentor-row");
    const a = rows.find((r) => r.textContent?.includes("Coach A"))!;
    fireEvent.click(a.querySelector("button, input")!);
    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert.mock.calls[0][0]).toMatchObject({ mentor_user_id: "a", is_active: false });
  });

  it("warns when the cohort has no mentor, because nobody could book", async () => {
    mockTables([]);
    renderPanel();
    expect(await screen.findByTestId("cohort-mentoring-warning")).toBeInTheDocument();
  });

  // The candidate population is Coach identity. No mentor_profiles row is
  // required: mockTables throws if that table is touched at all.
  it("offers a Coach with no mentor profile as a candidate", async () => {
    mockTables([], ["c"]);
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-mentor-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Coach C");
    expect(rows[0]).toHaveAttribute("data-assigned", "false");
  });

  // Mentoring assignment is independent of Coaching assignment: this panel
  // reads cohort_mentors only, and never cohort_coach_assignments.
  it("never consults the Coaching assignment table", async () => {
    mockTables();
    renderPanel();
    await screen.findAllByTestId("cohort-mentor-row");
    const tables = from.mock.calls.map((c) => c[0]);
    expect(tables).toContain("cohort_mentors");
    expect(tables).not.toContain("cohort_coach_assignments");
  });

  it("says no Coaches are available rather than implying Mentor is an account type", async () => {
    mockTables([], []);
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/No Coaches are available to assign as Mentors/i)).toBeInTheDocument(),
    );
  });

  it("shows a load error instead of misreporting a failed query as zero Coaches", async () => {
    from.mockImplementation((table: string) => {
      if (table === "cohort_mentors") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: null, error: { message: "relation does not exist" } }),
          }),
          upsert,
        };
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    });
    renderPanel();
    expect(await screen.findByTestId("cohort-mentoring-error")).toBeInTheDocument();
    expect(screen.queryByTestId("cohort-mentoring-warning")).not.toBeInTheDocument();
    expect(screen.queryByText(/No Coaches are available to assign as Mentors/i)).not.toBeInTheDocument();
  });
});
