import { describe, expect, it } from "vitest";
import { deriveNextUp } from "../nextUp";
import type { LearnerJourneyPoint, LearnerLearningItem } from "@/hooks/useLearnerCanonicalProgress";
import type { EnrollmentActionRow } from "@/hooks/dashboard/useEnrollmentActionsSummary";

const checkpoint = (overrides: Partial<LearnerJourneyPoint>): LearnerJourneyPoint => ({
  checkpoint_number: 1,
  due_on: "2026-03-01",
  label: "Checkpoint 1",
  module_scope: ["training"],
  required_units: 1,
  completed_units: 0,
  state: "upcoming",
  ...overrides,
});

const learningItem = (overrides: Partial<LearnerLearningItem>): LearnerLearningItem => ({
  key: "quizzes",
  label: "Quizzes",
  required_units: 1,
  due_units: 1,
  completed_units: 0,
  progress_available: true,
  status: "upcoming",
  ...overrides,
});

const action = (overrides: Partial<EnrollmentActionRow>): EnrollmentActionRow => ({
  id: "a1",
  title: "Reflect on session 3",
  description: null,
  status: "open",
  due_date: "2026-01-01",
  goal_id: null,
  milestone_id: null,
  completed_at: null,
  ...overrides,
});

describe("deriveNextUp", () => {
  it("returns null when nothing is due, overdue, current, or booked", () => {
    const result = deriveNextUp({ journey: [], learningBreakdown: [], overdueActions: [], nextSessionAt: null });
    expect(result).toBeNull();
  });

  it("prioritizes an overdue programme checkpoint over everything else", () => {
    const result = deriveNextUp({
      journey: [checkpoint({ state: "current", label: "Current" }), checkpoint({ state: "overdue", label: "Overdue module" })],
      learningBreakdown: [learningItem({ status: "overdue", label: "Overdue quiz" })],
      overdueActions: [action({ title: "Overdue action" })],
      nextSessionAt: "2026-04-01T10:00:00Z",
    });
    expect(result).toEqual({ kind: "overdue_requirement", label: "Overdue module", dueOn: "2026-03-01" });
  });

  it("falls back to an overdue learning item when no journey checkpoint is overdue", () => {
    const result = deriveNextUp({
      journey: [checkpoint({ state: "current" })],
      learningBreakdown: [learningItem({ status: "overdue", label: "Overdue quiz" })],
      overdueActions: [],
      nextSessionAt: null,
    });
    expect(result).toEqual({ kind: "overdue_requirement", label: "Overdue quiz", dueOn: null });
  });

  it("surfaces an overdue action when nothing programme-required is overdue", () => {
    const result = deriveNextUp({
      journey: [checkpoint({ state: "current", label: "Current module" })],
      learningBreakdown: [],
      overdueActions: [action({ title: "Send follow-up email", due_date: "2026-02-01" })],
      nextSessionAt: "2026-04-01T10:00:00Z",
    });
    expect(result).toEqual({ kind: "overdue_action", label: "Send follow-up email", dueOn: "2026-02-01" });
  });

  it("surfaces the current requirement when nothing is overdue", () => {
    const result = deriveNextUp({
      journey: [checkpoint({ state: "current", label: "Current module" })],
      learningBreakdown: [],
      overdueActions: [],
      nextSessionAt: "2026-04-01T10:00:00Z",
    });
    expect(result).toEqual({ kind: "current_requirement", label: "Current module", dueOn: "2026-03-01" });
  });

  it("surfaces the next booked session when nothing is overdue or current", () => {
    const result = deriveNextUp({
      journey: [checkpoint({ state: "upcoming" })],
      learningBreakdown: [],
      overdueActions: [],
      nextSessionAt: "2026-04-01T10:00:00Z",
    });
    expect(result).toEqual({ kind: "upcoming_session", label: "Coaching session", dueOn: "2026-04-01T10:00:00Z" });
  });

  it("falls back to the next future requirement as the last resort", () => {
    const result = deriveNextUp({
      journey: [checkpoint({ state: "upcoming", label: "Future module" })],
      learningBreakdown: [],
      overdueActions: [],
      nextSessionAt: null,
    });
    expect(result).toEqual({ kind: "upcoming_requirement", label: "Future module", dueOn: "2026-03-01" });
  });
});
