import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc } }));

import "@/i18n/config";
import { CohortAssessorPanel } from "../CohortAssessorPanel";

/**
 * Coach A: in the pool. Coach B: in the pool, account inactive.
 * Coach C: active Coach, candidate. Coach D: inactive, not in the pool.
 */
function mockBackend() {
  rpc.mockImplementation((name: string) => {
    if (name === "admin_cohort_assessors") {
      return Promise.resolve({
        data: [
          { coach_id: "a", full_name: "Coach A", email: "a@x", is_active: true, assigned_at: "2026-10-01" },
          { coach_id: "b", full_name: "Coach B", email: "b@x", is_active: true, assigned_at: "2026-10-01" },
        ],
        error: null,
      });
    }
    if (name === "admin_set_cohort_assessor") return Promise.resolve({ data: "row-id", error: null });
    throw new Error(`unexpected rpc ${name}`);
  });
  from.mockImplementation((table: string) => {
    if (table === "user_roles") {
      return { select: () => ({ eq: () => Promise.resolve({ data: ["a", "b", "c", "d"].map((user_id) => ({ user_id })), error: null }) }) };
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
              error: null,
            }),
        }),
      };
    }
    // The app holds no privilege on cohort_assessors: reads and writes are functions.
    throw new Error(`unexpected table ${table}`);
  });
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CohortAssessorPanel cohortId="cohort-1" />
    </QueryClientProvider>,
  );
}

describe("CohortAssessorPanel", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    mockBackend();
  });

  it("lists the pool and the active Coaches who could join it", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-assessor-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Coach A"),
      expect.stringContaining("Coach B"),
      expect.stringContaining("Coach C"),
    ]);
    expect(rows.filter((r) => r.getAttribute("data-assigned") === "true")).toHaveLength(2);
    expect(screen.getByTestId("cohort-assessor-inactive-warning")).toBeInTheDocument();
    expect(screen.queryByText("Coach D")).not.toBeInTheDocument();
  });

  it("adds a Coach through admin_set_cohort_assessor", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-assessor-row");
    fireEvent.click(rows.find((r) => r.textContent?.includes("Coach C"))!.querySelector("button")!);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("admin_set_cohort_assessor", { p_cohort_id: "cohort-1", p_coach_id: "c", p_active: true }),
    );
  });

  it("removes a Coach by deactivating them", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-assessor-row");
    fireEvent.click(rows.find((r) => r.textContent?.includes("Coach A"))!.querySelector("button")!);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("admin_set_cohort_assessor", { p_cohort_id: "cohort-1", p_coach_id: "a", p_active: false }),
    );
  });
});
