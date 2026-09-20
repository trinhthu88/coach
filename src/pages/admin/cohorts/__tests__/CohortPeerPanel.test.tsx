import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, auth } = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, auth } }));

import "@/i18n/config";
import { CohortPeerPanel } from "../CohortPeerPanel";

const upsert = vi.fn().mockResolvedValue({ error: null });
const deleteEq2 = vi.fn().mockResolvedValue({ error: null });

/**
 * Cohort A belongs to programme P, alongside cohorts B, C and D.
 *
 *   A --> B    granted outbound
 *   C --> A    granted inbound only: A may NOT select C
 *   D          no grant either way
 *
 * The panel has to show those three as genuinely different states, because a
 * directional grant that renders like a symmetric one is exactly how an Admin
 * ends up believing a cohort can peer both ways when it cannot.
 */
function mockTables(
  grants = [
    { source_cohort_id: "A", allowed_peer_cohort_id: "B" },
    { source_cohort_id: "C", allowed_peer_cohort_id: "A" },
  ],
  siblings = [
    { id: "B", name: "Cohort B" },
    { id: "C", name: "Cohort C" },
    { id: "D", name: "Cohort D" },
  ],
  programmeId: string | null = "P"
) {
  from.mockImplementation((table: string) => {
    if (table === "cohorts") {
      return {
        select: () => ({
          eq: (_col: string, _v: string) => ({
            maybeSingle: () => Promise.resolve({ data: { id: "A", programme_id: programmeId }, error: null }),
            neq: () => ({ order: () => Promise.resolve({ data: siblings, error: null }) }),
          }),
        }),
      };
    }
    if (table === "peer_cohort_permissions") {
      return {
        select: () => ({ or: () => Promise.resolve({ data: grants, error: null }) }),
        upsert,
        delete: () => ({ eq: () => ({ eq: deleteEq2 }) }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CohortPeerPanel cohortId="A" />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ error: null });
  deleteEq2.mockResolvedValue({ error: null });
});

describe("CohortPeerPanel", () => {
  it("states that same-cohort peering is always on rather than offering it as a switch", async () => {
    mockTables();
    renderPanel();
    expect(await screen.findByTestId("cohort-peer-same-cohort")).toHaveTextContent(
      "Participants in this cohort can always peer together. No permission is needed."
    );
  });

  it("distinguishes an outbound grant from an inbound-only one", async () => {
    mockTables();
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-peer-row");
    expect(rows).toHaveLength(3);
    // B: this cohort may select it.
    expect(rows[0]).toHaveAttribute("data-granted", "true");
    expect(rows[0]).toHaveAttribute("data-inbound", "false");
    // C may select US, which grants us nothing: the box stays unchecked and
    // the direction that does exist is labelled.
    expect(rows[1]).toHaveAttribute("data-granted", "false");
    expect(rows[1]).toHaveAttribute("data-inbound", "true");
    expect(rows[1]).toHaveTextContent("can also select this cohort");
    expect(rows[2]).toHaveAttribute("data-granted", "false");
    expect(rows[2]).toHaveAttribute("data-inbound", "false");
    expect(screen.getByTestId("cohort-peer-granted-count")).toHaveTextContent("1 additional cohort(s)");
  });

  it("writes ONE row by default and TWO when matching both ways is asked for", async () => {
    mockTables();
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-peer-row");

    fireEvent.click(rows[2].querySelector("button")!);
    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert.mock.calls[0][0]).toEqual([
      { source_cohort_id: "A", allowed_peer_cohort_id: "D", created_by: "admin-1" },
    ]);

    fireEvent.click(screen.getByTestId("cohort-peer-both-ways").querySelector("button") ?? screen.getByTestId("cohort-peer-both-ways"));
    fireEvent.click(rows[2].querySelector("button")!);
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
    // Reciprocity is stored, never inferred.
    expect(upsert.mock.calls[1][0]).toEqual([
      { source_cohort_id: "A", allowed_peer_cohort_id: "D", created_by: "admin-1" },
      { source_cohort_id: "D", allowed_peer_cohort_id: "A", created_by: "admin-1" },
    ]);
  });

  it("withdrawing a grant deletes only that direction's row", async () => {
    mockTables();
    renderPanel();
    const rows = await screen.findAllByTestId("cohort-peer-row");
    fireEvent.click(rows[0].querySelector("button")!);
    await waitFor(() => expect(deleteEq2).toHaveBeenCalledTimes(1));
    expect(upsert).not.toHaveBeenCalled();
  });

  it("says the programme has no other cohort rather than showing an empty list", async () => {
    mockTables([], []);
    renderPanel();
    expect(await screen.findByText(/This programme has no other cohort to connect to/)).toBeInTheDocument();
  });

  it("offers nothing for a cohort with no programme: nothing is comparable to it", async () => {
    mockTables([], [], null);
    renderPanel();
    expect(await screen.findByText(/This programme has no other cohort to connect to/)).toBeInTheDocument();
  });
});
