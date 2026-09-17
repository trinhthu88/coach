import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc },
}));

import { useLearnerCanonicalProgress } from "../useLearnerCanonicalProgress";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const progressRow = {
  enrollment_id: "enrollment-1",
  learner_display_name: "Leader One",
  programme_label: "Emerging Leaders",
  cohort_id: "cohort-1",
  cohort_label: "Emerging Leaders – Cohort C",
  programme_id: "programme-1",
  enrollment_start_date: "2026-03-01",
  enrollment_end_date: "2026-07-05",
  programme_start_date: "2026-03-01",
  programme_end_date: "2026-07-05",
  enrollment_status: "at_risk",
  stored_enrollment_status: "at_risk",
  effective_enrollment_status: "at_risk",
  required_units: 16,
  completed_units: 8,
  due_units: 10,
  booked_units: 0,
  overdue_units: 2,
  full_completion_pct: 50,
  due_adherence_pct: 80,
  pace_status: "behind",
  progress_available: true,
  coaching_required_units: 4,
  coaching_completed_units: 2,
  coaching_due_units: 3,
  coaching_booked_units: 0,
  training_required_units: 6,
  training_completed_units: 4,
  training_due_units: 4,
  training_booked_units: 0,
  peer_required_units: 2,
  peer_completed_units: 1,
  peer_due_units: 1,
  peer_booked_units: 0,
  mentoring_required_units: 2,
  mentoring_completed_units: 1,
  mentoring_due_units: 1,
  mentoring_booked_units: 0,
  triad_required_units: 2,
  triad_completed_units: 0,
  triad_due_units: 1,
  triad_booked_units: 0,
};

const moduleRows = [
  {
    module: "coaching",
    required_units: 4,
    completed_units: 2,
    due_units: 3,
    booked_units: 0,
    pace_status: "behind",
    full_completion_pct: 50,
    due_adherence_pct: 66.7,
  },
];

const journeyRows = [
  { checkpoint_number: 1, due_on: "2026-04-01", label: "Module 1", module_scope: ["coaching"], required_units: 1, completed_units: 1, state: "completed" },
];

const experiencePayload = {
  weekly_participation: [],
  learning_breakdown: [
    { key: "quizzes", label: "Quizzes", required_units: 6, due_units: 4, completed_units: 3, progress_available: true, status: "current" },
  ],
  coaching_utilisation: { required_units: 4, completed_units: 2, due_units: 3, booked_units: 0, utilisation_pct: 50 },
};

describe("useLearnerCanonicalProgress", () => {
  beforeEach(() => rpc.mockReset());

  it("does not fetch without an enrollment id", () => {
    const { result } = renderHook(() => useLearnerCanonicalProgress(undefined), { wrapper });

    expect(result.current.progress).toBeNull();
    expect(result.current.modules).toEqual([]);
    expect(result.current.journey).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls all four canonical learner RPCs for the enrollment and parses their results", async () => {
    rpc.mockImplementation((name?: string) => {
      if (name === "learner_canonical_progress") return Promise.resolve({ data: [progressRow], error: null });
      if (name === "learner_canonical_module_progress") return Promise.resolve({ data: moduleRows, error: null });
      if (name === "learner_canonical_journey") return Promise.resolve({ data: journeyRows, error: null });
      if (name === "learner_canonical_experience") return Promise.resolve({ data: experiencePayload, error: null });
      // Testing Library's post-test unmount can trigger one extra, argument-
      // less call into this mock as react-query tears the query down; it
      // happens after every assertion below has already run, so a harmless
      // empty response here (rather than throwing) keeps the test focused
      // on the real four-call contract instead of that unmount timing.
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useLearnerCanonicalProgress("enrollment-1"), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(rpc).toHaveBeenCalledWith("learner_canonical_progress", { p_enrollment_id: "enrollment-1" });
    expect(rpc).toHaveBeenCalledWith("learner_canonical_module_progress", { p_enrollment_id: "enrollment-1" });
    expect(rpc).toHaveBeenCalledWith("learner_canonical_journey", { p_enrollment_id: "enrollment-1" });
    expect(rpc).toHaveBeenCalledWith("learner_canonical_experience", { p_enrollment_id: "enrollment-1" });

    expect(result.current.progress).toEqual(progressRow);
    expect(result.current.modules).toEqual(moduleRows);
    expect(result.current.journey).toEqual([
      { checkpoint_number: 1, due_on: "2026-04-01", label: "Module 1", module_scope: ["coaching"], required_units: 1, completed_units: 1, state: "completed" },
    ]);
    expect(result.current.experience.learningBreakdown).toEqual([
      { key: "quizzes", label: "Quizzes", required_units: 6, due_units: 4, completed_units: 3, progress_available: true, status: "current" },
    ]);
    expect(result.current.experience.coachingUtilisation).toEqual({
      required_units: 4,
      completed_units: 2,
      due_units: 3,
      booked_units: 0,
      utilisation_pct: 50,
    });
    expect(result.current.error).toBeNull();
  });

  it("passes p_as_of through to every RPC when given", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    renderHook(() => useLearnerCanonicalProgress("enrollment-1", "2026-06-30"), { wrapper });

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("learner_canonical_progress", {
        p_enrollment_id: "enrollment-1",
        p_as_of: "2026-06-30",
      })
    );
  });

  it("surfaces an RPC error instead of silently returning empty data", async () => {
    const error = new Error("progress unavailable");
    rpc.mockImplementation((name: string) => {
      if (name === "learner_canonical_progress") return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHook(() => useLearnerCanonicalProgress("enrollment-1"), { wrapper });

    await waitFor(() => expect(result.current.error).toBe("progress unavailable"));
    expect(result.current.progress).toBeNull();
  });
});
