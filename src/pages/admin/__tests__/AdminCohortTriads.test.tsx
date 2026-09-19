import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminTriadCandidate,
  AdminTriadGroup,
  AdminTriadLearner,
  AdminTriadRequirement,
  AdminTriadRequirementStats,
} from "@/hooks/triads/useAdminTriads";

const runAutoAssign = vi.fn();
const sendReminders = vi.fn();
const createGroup = vi.fn();
const requirementQuery = vi.fn();
const candidatesByRequirement = new Map<string, AdminTriadCandidate[]>();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "cohort-c", name: "Cohort C" }, error: null }) }) }) }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/triads/useAdminTriads", () => ({
  useAdminCohortTriadRequirement: () => requirementQuery(),
  useAdminCohortTriadRequirementStats: () => ({ requirements: STATS, loading: false, error: false, refetch: vi.fn() }),
  useAdminCohortTriadGroups: () => ({ groups: GROUPS, loading: false, error: false, refetch: vi.fn() }),
  useAdminCohortTriadLearners: () => ({ learners: LEARNERS, loading: false, error: false, refetch: vi.fn() }),
  useAdminTriadRequirementCandidates: (requirementId: string) => ({
    candidates: candidatesByRequirement.get(requirementId) ?? [],
    loading: false,
    error: false,
    refetch: vi.fn(),
  }),
  useAdminTriadMutations: () => ({
    runAutoAssign,
    sendReminders,
    createGroup,
    changeMember: vi.fn(),
    setGroupActive: vi.fn(),
    autoAssignRunning: false,
    remindersSending: false,
    isPending: false,
  }),
}));

import "@/i18n/config";
import AdminCohortTriads from "../AdminCohortTriads";

const REQUIREMENT: AdminTriadRequirement = {
  programmeId: "prog-c",
  programmeName: "Emerging Leaders",
  requiredUnits: 2,
  schedule: [
    { milestone: 1, dueOn: "2026-04-05" },
    { milestone: 2, dueOn: "2026-07-05" },
  ],
  scheduleState: "complete",
};

const stats = (unit: number, overrides: Partial<AdminTriadRequirementStats> = {}): AdminTriadRequirementStats => ({
  requirementId: `req-${unit}`,
  programmeId: "prog-c",
  unitNumber: unit,
  dueOn: unit === 1 ? "2026-04-05" : "2026-07-05",
  requiredUnits: 2,
  eligible: 6,
  assigned: 6,
  fulfilled: 0,
  overdue: 0,
  activeGroups: 2,
  reflectionsSubmitted: 0,
  reflectionsExpected: 0,
  ...overrides,
});
let STATS: AdminTriadRequirementStats[] = [];

const member = (id: string, name: string, order: number) => ({ enrollmentId: id, userId: `u-${id}`, fullName: name, memberOrder: order });
const group = (id: string, unit: number, members: ReturnType<typeof member>[], status: "completed" | "confirmed"): AdminTriadGroup => ({
  id,
  requirementId: `req-${unit}`,
  unitNumber: unit,
  assignedBy: "admin",
  groupLanguage: "en",
  isActive: true,
  createdAt: `2026-0${unit}-01T00:00:00Z`,
  closedAt: null,
  members,
  sessions: [{ id: `s-${id}`, sessionNumber: 1, status, scheduledStartTime: unit === 1 ? "2026-02-16T03:00:00Z" : "2026-04-20T03:00:00Z", scheduledEndTime: null, reflectionCount: 0 }],
});
// Triad 1: {Ann, Bao, Chi} {Dung, Em, Phuc}. Triad 2: {Ann, Dung} so far —
// nobody repeats a Triad 1 partner.
const GROUPS: AdminTriadGroup[] = [
  group("g1", 1, [member("ann", "Ann", 1), member("bao", "Bao", 2), member("chi", "Chi", 3)], "completed"),
  group("g2", 1, [member("dung", "Dung", 1), member("em", "Em", 2), member("phuc", "Phuc", 3)], "completed"),
  group("g3", 2, [member("ann", "Ann", 1), member("dung", "Dung", 2)], "confirmed"),
];

const learner = (id: string, name: string, t2Group: string | null): AdminTriadLearner => ({
  enrollmentId: id,
  userId: `u-${id}`,
  fullName: name,
  spokenLanguages: ["en"],
  programmeId: "prog-c",
  enrollmentStatus: "active",
  isEligible: true,
  requiredUnits: 2,
  rawCompletedSessions: 1,
  completedUnits: 1,
  dueUnits: 1,
  overdueUnits: 0,
  nextDueOn: "2026-07-05",
  requirements: [
    { milestone: 1, requirementId: "req-1", dueOn: "2026-04-05", isDue: true, fulfilled: true, fulfilledOn: "2026-02-16", overdue: false, triadGroupId: id === "ann" || id === "bao" || id === "chi" ? "g1" : "g2" },
    { milestone: 2, requirementId: "req-2", dueOn: "2026-07-05", isDue: false, fulfilled: false, fulfilledOn: null, overdue: false, triadGroupId: t2Group },
  ],
});
const LEARNERS = [learner("ann", "Ann", "g3"), learner("bao", "Bao", null), learner("dung", "Dung", "g3")];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/cohorts/cohort-c/triads"]}>
        <Routes>
          <Route path="/admin/cohorts/:cohortId/triads" element={<AdminCohortTriads />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const card = (unit: number) => screen.getAllByTestId("admin-triad-requirement").find((c) => c.getAttribute("data-unit") === String(unit))!;

beforeEach(() => {
  vi.clearAllMocks();
  requirementQuery.mockReturnValue({ requirements: [REQUIREMENT], loading: false, error: false, refetch: vi.fn() });
  STATS = [stats(1, { fulfilled: 6, reflectionsSubmitted: 5, reflectionsExpected: 6 }), stats(2, { assigned: 2, activeGroups: 1 })];
  candidatesByRequirement.clear();
  candidatesByRequirement.set("req-2", [
    { enrollmentId: "bao", userId: "u-bao", fullName: "Bao", spokenLanguages: ["en"], priorPartnerEnrollmentIds: ["ann", "chi"], priorPartnerNames: ["Ann", "Chi"] },
    { enrollmentId: "chi", userId: "u-chi", fullName: "Chi", spokenLanguages: ["en"], priorPartnerEnrollmentIds: ["ann", "bao"], priorPartnerNames: ["Ann", "Bao"] },
    { enrollmentId: "em", userId: "u-em", fullName: "Em", spokenLanguages: ["en"], priorPartnerEnrollmentIds: ["dung", "phuc"], priorPartnerNames: ["Dung", "Phuc"] },
    { enrollmentId: "phuc", userId: "u-phuc", fullName: "Phuc", spokenLanguages: ["en"], priorPartnerEnrollmentIds: ["dung", "em"], priorPartnerNames: ["Dung", "Em"] },
  ]);
  runAutoAssign.mockResolvedValue({ unit: 2, groups: 1, dyads: 0, flagged: 0, repeated_pairs: 0 });
  sendReminders.mockResolvedValue(undefined);
});

describe("Admin -> Cohort -> Triads (every required Triad has its own group assignment)", () => {
  it("renders one card per required Triad, each with its own deadline, stats, groups and actions", async () => {
    renderPage();
    const cards = await screen.findAllByTestId("admin-triad-requirement");
    expect(cards.map((c) => c.getAttribute("data-unit"))).toEqual(["1", "2"]);
    expect(within(card(1)).getByTestId("admin-triad-requirement-title")).toHaveTextContent("Triad 1");
    expect(card(1)).toHaveTextContent("Due 05 Apr 2026");
    expect(card(2)).toHaveTextContent("Due 05 Jul 2026");
    for (const unit of [1, 2]) {
      for (const action of ["Auto assign", "Create group manually", "Send reminder"]) {
        expect(within(card(unit)).getByRole("button", { name: action })).toBeInTheDocument();
      }
    }
    // Groups belong to their own Triad.
    expect(within(card(1)).getAllByTestId("admin-triad-group")).toHaveLength(2);
    expect(within(card(2)).getAllByTestId("admin-triad-group")).toHaveLength(1);
    expect(within(card(2)).getByTestId("admin-triad-sessions")).toHaveTextContent("Triad 2 session — confirmed");
    // Stats per requirement.
    expect(card(1)).toHaveTextContent("6 / 6");
    expect(card(1)).toHaveTextContent("5 / 6");
    expect(within(card(2)).getByTestId("admin-triad-ungrouped")).toHaveTextContent("Bao");
    // Triad 1's card never lists Triad 2 candidates.
    expect(within(card(1)).queryByTestId("admin-triad-ungrouped")).toBeNull();
  });

  it("auto assign and reminders act on THAT Triad requirement only", async () => {
    renderPage();
    await screen.findAllByTestId("admin-triad-requirement");
    fireEvent.click(within(card(2)).getByRole("button", { name: "Send reminder" }));
    await waitFor(() => expect(sendReminders).toHaveBeenCalledWith("req-2"));
    fireEvent.click(within(card(2)).getByRole("button", { name: "Auto assign" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Auto assign Triad 2?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Auto assign" }));
    await waitFor(() => expect(runAutoAssign).toHaveBeenCalledWith("req-2"));
  });

  it("the learner progress table shows each Triad's status per learner: fulfilled, its group, or assignment pending", async () => {
    renderPage();
    const rows = await screen.findAllByTestId("admin-triad-learner");
    const cells = (i: number) => within(rows[i]).getAllByTestId("admin-triad-learner-unit").map((c) => c.textContent);
    expect(cells(0)).toEqual([expect.stringContaining("✓ 16 Feb"), "Group A"]);
    expect(cells(1)).toEqual([expect.stringContaining("✓"), "Group assignment pending"]);
    expect(within(rows[0]).getByTestId("admin-triad-learner-completed")).toHaveTextContent("1 / 2");
  });

  it("a requirement load failure never shows a number; missing Triad dates are flagged", async () => {
    requirementQuery.mockReturnValue({ requirements: null, loading: false, error: true, refetch: vi.fn() });
    renderPage();
    expect(await screen.findByTestId("admin-triads-requirement-error")).toBeInTheDocument();
    expect(screen.queryAllByTestId("admin-triad-requirement")).toHaveLength(0);
  });

  it("flags a Triad without a cohort date", async () => {
    requirementQuery.mockReturnValue({
      requirements: [{ ...REQUIREMENT, schedule: [REQUIREMENT.schedule[0]] }],
      loading: false,
      error: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(await screen.findByTestId("admin-triad-schedule-missing")).toHaveTextContent("1 of 2");
  });
});
