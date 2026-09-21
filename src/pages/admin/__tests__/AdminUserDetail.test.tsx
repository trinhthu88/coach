import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin → user detail: full enrollment history, one expandable section per
 * enrollment, each loading its own canonical data (admin_* wrappers) only
 * when opened. The Supabase client is mocked at the RPC boundary so the real
 * hooks run.
 */

type Enrollment = Record<string, unknown>;
const state: { enrollments: Enrollment[] } = { enrollments: [] };
const rpc = vi.fn();

const CURRENT: Enrollment = {
  enrollment_id: "enr-current",
  programme_id: "prog-2",
  programme_name: "Emerging Leaders",
  cohort_id: "cohort-2",
  cohort_name: "Cohort B",
  organization_id: "org-1",
  organization_name: "Acme",
  start_date: "2026-01-05",
  end_date: "2026-07-05",
  stored_enrollment_status: "active",
  effective_enrollment_status: "at_risk",
  required_units: 10,
  completed_units: 4,
  overdue_units: 2,
  full_completion_pct: 40,
  progress_available: true,
  created_at: "2026-01-01T00:00:00Z",
};
const PAST: Enrollment = {
  ...CURRENT,
  enrollment_id: "enr-past",
  programme_id: "prog-1",
  programme_name: "Foundations",
  cohort_name: "Cohort A",
  start_date: "2025-01-05",
  end_date: "2025-07-05",
  stored_enrollment_status: "completed",
  effective_enrollment_status: "completed",
  full_completion_pct: 100,
};

function progressRow(enrollmentId: string) {
  return {
    enrollment_id: enrollmentId,
    learner_display_name: "Lan Nguyen",
    programme_label: "x",
    cohort_label: "x",
    enrollment_start_date: "2026-01-05",
    enrollment_end_date: null,
    programme_start_date: null,
    programme_end_date: null,
    enrollment_status: "active",
    stored_enrollment_status: "active",
    effective_enrollment_status: "active",
    required_units: 10,
    completed_units: enrollmentId === "enr-past" ? 10 : 4,
    due_units: 6,
    booked_units: 1,
    overdue_units: 2,
    full_completion_pct: enrollmentId === "enr-past" ? 100 : 40,
    due_adherence_pct: 50,
    pace_status: "behind",
    progress_available: true,
    coaching_required_units: 4, coaching_completed_units: 2, coaching_due_units: 3, coaching_booked_units: 1,
    training_required_units: 2, training_completed_units: 1, training_due_units: 1, training_booked_units: 0,
    peer_required_units: 2, peer_completed_units: 1, peer_due_units: 1, peer_booked_units: 0,
    mentoring_required_units: 1, mentoring_completed_units: 0, mentoring_due_units: 1, mentoring_booked_units: 0,
    triad_required_units: 1, triad_completed_units: 0, triad_due_units: 0, triad_booked_units: 0,
  };
}

const DETAIL: Record<string, Record<string, unknown[]>> = {
  "enr-current": {
    admin_enrollment_module_progress: [
      { module: "coaching", required_units: 4, completed_units: 2, completed_activity_units: 2, due_units: 3, booked_units: 1, overdue_units: 1, pace_status: "behind" },
      { module: "peer_coaching", required_units: 2, completed_units: 1, completed_activity_units: 1, due_units: 1, booked_units: 0, overdue_units: 0, pace_status: "on_track" },
    ],
    admin_enrollment_engagement: [
      { goal_count: 1, goal_setup: true, goal_progress_pct: 50, open_action_count: 1, completed_action_count: 0, total_action_count: 1, action_completion_pct: 0, satisfaction_avg: 4.5, satisfaction_rated_count: 2 },
    ],
    admin_enrollment_goals: [
      { goal_id: "goal-1", title: "Delegate more", description: null, status: "active", target_date: null, sort_order: 0, has_rating: true, start_rating: 30, current_rating: 55, target_rating: 80, progress_pct: 50 },
    ],
    admin_enrollment_goal_checkins: [
      { checkin_id: "ck-1", goal_id: "goal-1", previous_rating: 30, new_rating: 55, note: "Handing over the weekly report", source_activity_type: "coaching", source_activity_id: "s-1", actor_user_id: "user-1", actor_name: "Lan Nguyen", created_at: "2026-02-01T10:00:00Z" },
    ],
    admin_enrollment_actions: [
      { action_id: "act-1", title: "Book a delegation 1:1", description: null, status: "open", due_date: "2026-03-01", completed_at: null, goal_id: "goal-1", goal_title: "Delegate more", source_activity_type: "coaching", source_activity_id: "s-1", created_at: "2026-02-01T10:00:00Z" },
    ],
    admin_learner_session_history: [
      { session_key: "coaching:sessions:s-1", session_type: "coaching", source_table: "sessions", source_id: "s-1", module: "coaching", participant_role: "coachee", title: "Kick-off coaching", start_time: "2026-01-20T10:00:00Z", status: "completed", counterpart_names: ["Coach Minh"], attributed_to_enrollment: true, is_programme_evidence: true, requirement_unit_number: 1 },
      { session_key: "triad:triad_sessions:t-1", session_type: "triad", source_table: "triad_sessions", source_id: "t-1", module: "triads", participant_role: "participant", title: null, start_time: "2026-02-20T10:00:00Z", status: "confirmed", counterpart_names: ["A", "B"], attributed_to_enrollment: false, is_programme_evidence: false, requirement_unit_number: 1 },
    ],
    admin_learner_reflection_feed: [],
  },
  "enr-past": {
    admin_enrollment_module_progress: [
      { module: "mentoring", required_units: 3, completed_units: 3, completed_activity_units: 3, due_units: 3, booked_units: 0, overdue_units: 0, pace_status: "complete" },
    ],
    admin_enrollment_engagement: [
      { goal_count: 0, goal_setup: false, goal_progress_pct: null, open_action_count: 0, completed_action_count: 0, total_action_count: 0, action_completion_pct: null, satisfaction_avg: null, satisfaction_rated_count: 0 },
    ],
    admin_enrollment_goals: [],
    admin_enrollment_goal_checkins: [],
    admin_enrollment_actions: [],
    admin_learner_session_history: [
      { session_key: "mentoring:mentoring_sessions:m-9", session_type: "mentoring", source_table: "mentoring_sessions", source_id: "m-9", module: "mentoring", participant_role: "mentee", title: "Past mentoring", start_time: "2025-03-01T10:00:00Z", status: "completed", counterpart_names: ["Mentor Hoa"], attributed_to_enrollment: true, is_programme_evidence: true, requirement_unit_number: 1 },
    ],
    admin_learner_reflection_feed: [],
  },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { id: "user-1", full_name: "Lan Nguyen", email: "lan@example.test", avatar_url: null }, error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/hooks/dashboard/useLearnerFeedback", () => ({
  useLearnerFeedback: (_userId: string, enrollmentId: string) => ({
    feedback:
      enrollmentId === "enr-current"
        ? [{ kind: "session_note", id: "n-1", source: "coaching", sessionId: "s-1", topic: "Kick-off coaching", fromName: "Coach Minh", submittedAt: "2026-01-20T10:00:00Z", note: "Great first session" }]
        : [],
    loading: false,
    error: null,
  }),
}));

import "@/i18n/config";
import AdminUserDetail from "../AdminUserDetail";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/coachees/:userId" element={<AdminUserDetail />} />
          <Route path="/admin/coachees/:userId/enrollments/:enrollmentId" element={<AdminUserDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const detailCallsFor = (enrollmentId: string) =>
  rpc.mock.calls.filter(([, args]) => (args as { p_enrollment_id?: string })?.p_enrollment_id === enrollmentId);

beforeEach(() => {
  rpc.mockReset();
  state.enrollments = [CURRENT, PAST];
  rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "admin_user_enrollments") return Promise.resolve({ data: state.enrollments, error: null });
    if (name === "admin_canonical_enrollment_progress") {
      return Promise.resolve({ data: (args.p_enrollment_ids as string[]).map(progressRow), error: null });
    }
    const rows = DETAIL[args.p_enrollment_id as string]?.[name];
    if (!rows) return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    return Promise.resolve({ data: rows, error: null });
  });
});

describe("AdminUserDetail", () => {
  it("lists every enrollment newest first and opens only the current one", async () => {
    renderAt("/admin/coachees/user-1");

    const sections = await screen.findAllByTestId("enrollment-section");
    expect(sections).toHaveLength(2);
    expect(within(sections[0]).getByText("Emerging Leaders")).toBeInTheDocument();
    expect(within(sections[1]).getByText("Foundations")).toBeInTheDocument();
    // Status is the canonical EFFECTIVE status, completion the canonical %.
    expect(within(sections[0]).getByText("At risk")).toBeInTheDocument();
    expect(within(sections[0]).getByTestId("enrollment-completion")).toHaveTextContent("40%");
    expect(rpc).toHaveBeenCalledWith("admin_user_enrollments", { p_user_id: "user-1" });

    const current = await screen.findByTestId("enrollment-detail-enr-current");
    expect(within(current).getByTestId("module-row-coaching")).toHaveTextContent(/4\s*2\s*3\s*1\s*1/);
    expect(within(current).getAllByTestId("session-row")).toHaveLength(2);
    expect(within(current).getByText("Kick-off coaching").closest("a")).toHaveAttribute("href", "/sessions/s-1");
    expect(within(current).getByText("Triad 1")).toBeInTheDocument();
    expect(within(current).getByText("Delegate more", { selector: "p" })).toBeInTheDocument();
    expect(within(current).getByTestId("goal-checkins")).toHaveTextContent("30 → 55");
    expect(within(current).getByText("Book a delegation 1:1")).toBeInTheDocument();
    expect(within(current).getAllByTestId("feedback-item")).toHaveLength(1);
    expect(within(current).getByTestId("satisfaction-value")).toHaveTextContent("4.5");

    // Lazy: the past enrollment's detail has not been requested.
    expect(detailCallsFor("enr-past")).toHaveLength(0);
    expect(screen.queryByTestId("enrollment-detail-enr-past")).not.toBeInTheDocument();
  });

  it("expanding a past enrollment loads and shows ITS OWN canonical data only", async () => {
    renderAt("/admin/coachees/user-1");
    await screen.findByTestId("enrollment-detail-enr-current");

    const past = screen.getAllByTestId("enrollment-section")[1];
    fireEvent.click(within(past).getByRole("button"));

    const detail = await screen.findByTestId("enrollment-detail-enr-past");
    await waitFor(() => expect(within(detail).getByTestId("module-row-mentoring")).toBeInTheDocument());
    expect(within(detail).queryByTestId("module-row-coaching")).not.toBeInTheDocument();
    expect(within(detail).getAllByTestId("session-row")).toHaveLength(1);
    expect(within(detail).getByText("Past mentoring").closest("a")).toHaveAttribute("href", "/mentoring/sessions/m-9");
    expect(within(detail).queryByText("Kick-off coaching")).not.toBeInTheDocument();
    expect(within(detail).queryByTestId("feedback-item")).not.toBeInTheDocument();
    expect(detailCallsFor("enr-past").map(([name]) => name).sort()).toEqual([
      "admin_enrollment_actions",
      "admin_enrollment_engagement",
      "admin_enrollment_goal_checkins",
      "admin_enrollment_goals",
      "admin_enrollment_module_progress",
      "admin_learner_reflection_feed",
      "admin_learner_session_history",
    ]);
  });

  it("the former enrollment review route opens that enrollment in the same page", async () => {
    renderAt("/admin/coachees/user-1/enrollments/enr-past");
    await screen.findByTestId("enrollment-detail-enr-past");
    expect(screen.queryByTestId("enrollment-detail-enr-current")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("enrollment-section")).toHaveLength(2);
  });

  it("works for a user with only past enrollments", async () => {
    state.enrollments = [PAST];
    renderAt("/admin/coachees/user-1");
    const [section] = await screen.findAllByTestId("enrollment-section");
    expect(screen.queryByTestId("enrollment-detail-enr-past")).not.toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button"));
    expect(await screen.findByTestId("enrollment-detail-enr-past")).toBeInTheDocument();
  });

  it("works for a user with no enrollments", async () => {
    state.enrollments = [];
    renderAt("/admin/coachees/user-1");
    expect(await screen.findByTestId("no-enrollments")).toBeInTheDocument();
    expect(screen.getByText("Lan Nguyen")).toBeInTheDocument();
  });
});
