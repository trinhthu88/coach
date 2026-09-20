import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, auth } = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, auth } }));

import "@/i18n/config";
import { CohortCoachingPanel } from "../CohortCoachingPanel";

const upsert = vi.fn().mockResolvedValue({ error: null });

/** Assignments: Anna active, Paul inactive. Hương is a candidate with no row. */
function mockTables() {
  from.mockImplementation((table: string) => {
    if (table === "cohort_coach_assignments") {
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                { coach_id: "anna", is_active: true, assigned_at: "2026-01-01" },
                { coach_id: "paul", is_active: false, assigned_at: "2026-01-01" },
              ],
              error: null,
            }),
        }),
        upsert,
      };
    }
    if (table === "user_roles") {
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [{ user_id: "anna" }, { user_id: "paul" }, { user_id: "huong" }],
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
                { id: "anna", full_name: "Anna", status: "active" },
                { id: "paul", full_name: "Paul", status: "active" },
                { id: "huong", full_name: "Huong", status: "active" },
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
      <CohortCoachingPanel cohortId={cohortId} />
    </QueryClientProvider>,
  );
}

describe("CohortCoachingPanel", () => {
  beforeEach(() => {
    from.mockReset();
    upsert.mockClear();
    mockTables();
  });

  it("lists every Coach and marks only the active assignment as assigned", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-coach-row");
    expect(rows).toHaveLength(3);
    const assigned = rows.filter((r) => r.getAttribute("data-assigned") === "true");
    expect(assigned).toHaveLength(1);
    expect(assigned[0]).toHaveTextContent("Anna");
  });

  it("counts only active assignments", async () => {
    renderPanel();
    // The badge renders immediately, so wait for the loaded rows before
    // asserting on it -- otherwise this reads the pre-fetch zero.
    await screen.findAllByTestId("cohort-coach-row");
    // Paul has a row but is_active = false, so he is not in the pool.
    expect(screen.getByTestId("cohort-coaching-assigned-count")).toHaveTextContent("1");
  });

  it("assigns a candidate Coach through the cohort pool", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-coach-row");
    const huong = rows.find((r) => r.textContent?.includes("Huong"))!;
    fireEvent.click(huong.querySelector("button, input")!);
    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert.mock.calls[0][0]).toMatchObject({
      cohort_id: "cohort-1",
      coach_id: "huong",
      is_active: true,
    });
  });

  it("unassigns by deactivating rather than deleting, so delivery history survives", async () => {
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-coach-row");
    const anna = rows.find((r) => r.textContent?.includes("Anna"))!;
    fireEvent.click(anna.querySelector("button, input")!);
    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert.mock.calls[0][0]).toMatchObject({ coach_id: "anna", is_active: false });
  });

  it("warns when no Coach is assigned, because nobody in the cohort could book", async () => {
    from.mockImplementation((table: string) => {
      if (table === "cohort_coach_assignments") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }), upsert };
      }
      if (table === "user_roles") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [{ user_id: "anna" }], error: null }) }) };
      }
      if (table === "profiles") {
        return { select: () => ({ in: () => Promise.resolve({ data: [{ id: "anna", full_name: "Anna" }] }) }) };
      }
      return { select: () => ({ in: () => Promise.resolve({ data: [] }) }) };
    });
    renderPanel();
    expect(await screen.findByTestId("cohort-coaching-warning")).toBeInTheDocument();
  });

  // Coaching and Mentoring draw the same Coach population, so an inactive
  // Coach account has to read the same way in both panels: the cohort looks
  // staffed while nobody can actually be booked.
  it("flags an assigned Coach whose account is inactive", async () => {
    from.mockImplementation((table: string) => {
      if (table === "cohort_coach_assignments") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [{ coach_id: "anna", is_active: true, assigned_at: "2026-01-01" }],
                error: null,
              }),
          }),
          upsert,
        };
      }
      if (table === "user_roles") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [{ user_id: "anna" }], error: null }) }) };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({ data: [{ id: "anna", full_name: "Anna", status: "inactive" }] }),
          }),
        };
      }
      return { select: () => ({ in: () => Promise.resolve({ data: [] }) }) };
    });
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-coach-row");
    const anna = rows.find((r) => r.textContent?.includes("Anna"))!;
    expect(anna).toHaveAttribute("data-assigned", "true");
    expect(anna).toHaveAttribute("data-account-active", "false");
    expect(screen.getByTestId("cohort-coaching-inactive-warning")).toBeInTheDocument();
  });

  // The candidate population is Coach identity. Nothing about Mentoring is
  // read here, and nothing is copied between the two assignments.
  it("never consults the Mentoring assignment table", async () => {
    renderPanel();
    await screen.findAllByTestId("cohort-coach-row");
    const tables = from.mock.calls.map((c) => c[0]);
    expect(tables).toContain("cohort_coach_assignments");
    expect(tables).toContain("user_roles");
    expect(tables).not.toContain("cohort_mentors");
    expect(tables).not.toContain("mentor_profiles");
  });
});
