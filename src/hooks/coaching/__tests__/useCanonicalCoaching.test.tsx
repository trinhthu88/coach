import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from } }));

import {
  useCohortCoachPool,
  useNextCoachingRequirement,
  useBookCoachingSession,
  useCanonicalCoachingProgress,
} from "../useCanonicalCoaching";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Anna and Paul are in the cohort pool; Xavier is not. */
function mockPool() {
  rpc.mockImplementation((fn: string) => {
    if (fn === "enrollment_coaching_coach_pool") {
      return Promise.resolve({ data: [{ coach_id: "anna" }, { coach_id: "paul" }], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  from.mockImplementation(() => ({
    select: () => ({
      in: () =>
        Promise.resolve({
          data: [
            { id: "anna", full_name: "Anna", avatar_url: null },
            { id: "paul", full_name: "Paul", avatar_url: null },
            { id: "xavier", full_name: "Xavier", avatar_url: null },
          ],
          error: null,
        }),
    }),
  }));
}

describe("canonical Coaching hooks", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  describe("Coach eligibility", () => {
    it("returns exactly the Coaches the backend put in the cohort pool", async () => {
      mockPool();
      const { result } = renderHook(() => useCohortCoachPool("enr-1"), { wrapper });
      await waitFor(() => expect(result.current.data).toBeDefined());
      expect(result.current.data!.map((c) => c.id)).toEqual(["anna", "paul"]);
    });

    it("does not include a Coach outside the pool even when their profile loads", async () => {
      mockPool();
      const { result } = renderHook(() => useCohortCoachPool("enr-1"), { wrapper });
      await waitFor(() => expect(result.current.data).toBeDefined());
      // Xavier is in the profile response but not in the pool: membership is
      // the backend's answer, never the profile query's.
      expect(result.current.data!.some((c) => c.id === "xavier")).toBe(false);
    });

    it("asks the backend for the pool rather than filtering locally", async () => {
      mockPool();
      renderHook(() => useCohortCoachPool("enr-1"), { wrapper });
      await waitFor(() => expect(rpc).toHaveBeenCalled());
      expect(rpc).toHaveBeenCalledWith("enrollment_coaching_coach_pool", {
        p_enrollment_id: "enr-1",
      });
    });
  });

  describe("next requirement", () => {
    it("reports the next unbooked requirement with its deadline", async () => {
      rpc.mockResolvedValue({
        data: [{ requirement_id: "req-2", ordinal: 2, due_on: "2026-07-05" }],
        error: null,
      });
      const { result } = renderHook(() => useNextCoachingRequirement("enr-1"), { wrapper });
      await waitFor(() => expect(result.current.data).toBeTruthy());
      expect(result.current.data).toEqual({
        requirementId: "req-2",
        ordinal: 2,
        dueOn: "2026-07-05",
      });
    });

    it("returns null when every requirement is already taken", async () => {
      rpc.mockResolvedValue({ data: [], error: null });
      const { result } = renderHook(() => useNextCoachingRequirement("enr-1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeNull();
    });
  });

  describe("booking", () => {
    it("books through the canonical RPC, never a direct insert", async () => {
      rpc.mockResolvedValue({ data: "sess-1", error: null });
      const { result } = renderHook(() => useBookCoachingSession(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({
          enrollmentId: "enr-1",
          coachId: "anna",
          slotId: "slot-1",
          requirementId: "req-1",
          topic: "Delegation",
        });
      });
      expect(rpc).toHaveBeenCalledWith("book_coaching_session", expect.objectContaining({
        p_enrollment_id: "enr-1",
        p_coach_id: "anna",
        p_slot_id: "slot-1",
        p_requirement_id: "req-1",
      }));
      expect(from).not.toHaveBeenCalled();
    });

    it("surfaces a duplicate booking as an error rather than silently succeeding", async () => {
      // 23505 is what the slot / requirement partial unique indexes raise.
      rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate" } });
      const { result } = renderHook(() => useBookCoachingSession(), { wrapper });
      await expect(
        result.current.mutateAsync({
          enrollmentId: "enr-1",
          coachId: "anna",
          slotId: "slot-1",
          requirementId: "req-1",
          topic: "x",
        }),
      ).rejects.toMatchObject({ code: "23505" });
    });

    it("rejects an ineligible Coach with the backend's authorisation error", async () => {
      rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not assigned" } });
      const { result } = renderHook(() => useBookCoachingSession(), { wrapper });
      await expect(
        result.current.mutateAsync({
          enrollmentId: "enr-1",
          coachId: "xavier",
          slotId: "slot-1",
          requirementId: "req-1",
          topic: "x",
        }),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  describe("canonical progress", () => {
    it("reads the coaching row from canonical_module_progress, not raw sessions", async () => {
      rpc.mockImplementation((fn: string) => {
        if (fn === "learner_module_progress") {
          return Promise.resolve({
            data: [
              { module: "triads", required_units: 2, completed_units: 2 },
              {
                module: "coaching",
                required_units: 2,
                completed_units: 1,
                booked_units: 1,
                due_units: 1,
                overdue_units: 0,
                pace_status: "on_track",
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [{ unit_complete: false }], error: null });
      });
      const { result } = renderHook(() => useCanonicalCoachingProgress("enr-1"), { wrapper });
      await waitFor(() => expect(result.current.data).toBeTruthy());
      expect(result.current.data).toMatchObject({
        requiredUnits: 2,
        completedUnits: 1,
        bookedUnits: 1,
        postSessionPending: 1,
      });
    });

    it("returns null when Coaching is not a scheduled module for the enrollment", async () => {
      rpc.mockImplementation((fn: string) =>
        fn === "learner_module_progress"
          ? Promise.resolve({ data: [{ module: "triads", required_units: 2 }], error: null })
          : Promise.resolve({ data: [], error: null }),
      );
      const { result } = renderHook(() => useCanonicalCoachingProgress("enr-1"), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeNull();
    });
  });
});
