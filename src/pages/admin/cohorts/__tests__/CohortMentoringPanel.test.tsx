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
 * Mentor A: assigned, active profile.
 * Mentor B: assigned, but INACTIVE profile — assigned yet unbookable.
 * Mentor C: active profile, unassigned candidate.
 */
function mockTables(assignments = [
  { mentor_user_id: "a", is_active: true, assigned_at: "2026-01-01" },
  { mentor_user_id: "b", is_active: true, assigned_at: "2026-01-01" },
]) {
  from.mockImplementation((table: string) => {
    if (table === "cohort_mentors") {
      return {
        select: () => ({ eq: () => Promise.resolve({ data: assignments, error: null }) }),
        upsert,
      };
    }
    if (table === "mentor_profiles") {
      return {
        select: () =>
          Promise.resolve({
            data: [
              { coach_user_id: "a", is_active: true },
              { coach_user_id: "b", is_active: false },
              { coach_user_id: "c", is_active: true },
            ],
            error: null,
          }),
      };
    }
    if (table === "profiles") {
      return {
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [
                { id: "a", full_name: "Mentor A" },
                { id: "b", full_name: "Mentor B" },
                { id: "c", full_name: "Mentor C" },
              ],
            }),
        }),
      };
    }
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

  it("flags an assigned mentor whose provider profile is inactive", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-mentor-row");
    const b = rows.find((r) => r.textContent?.includes("Mentor B"))!;
    // Assigned to the cohort, but unbookable — the cohort looks staffed and is not.
    expect(b).toHaveAttribute("data-assigned", "true");
    expect(b).toHaveAttribute("data-profile-active", "false");
    expect(screen.getByTestId("cohort-mentoring-inactive-warning")).toBeInTheDocument();
  });

  it("assigns a candidate mentor to the cohort", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-mentor-row");
    const c = rows.find((r) => r.textContent?.includes("Mentor C"))!;
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
    const a = rows.find((r) => r.textContent?.includes("Mentor A"))!;
    fireEvent.click(a.querySelector("button, input")!);
    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert.mock.calls[0][0]).toMatchObject({ mentor_user_id: "a", is_active: false });
  });

  it("warns when the cohort has no mentor, because nobody could book", async () => {
    mockTables([]);
    renderPanel();
    expect(await screen.findByTestId("cohort-mentoring-warning")).toBeInTheDocument();
  });
});
