import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc, invoke, toastError } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn(), toastError: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from,
    rpc,
    functions: { invoke },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://signed/x.pdf" }, error: null }) }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError } }));
// Radix Select does not run in jsdom; a native select keeps value / onValueChange.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {value === "" && <option value="" />}
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));

import "@/i18n/config";
import { AssessmentQueue } from "../AssessmentQueue";

function row(over: Record<string, unknown>) {
  return {
    submission_id: "s", enrollment_id: "e", learner_name: "L", programme_id: "p1", programme_name: "Leaders",
    cohort_id: "c1", cohort_name: "Cohort One", kind: "triad", requirement_ordinal: 1, attempt_no: 1,
    status: "awaiting_assignment", submitted_at: "2026-10-01T09:00:00Z", assessor_id: null, assessor_name: null,
    assigned_at: null, due_on: null, review_overdue: false, review_id: null, review_version: null, review_text: null,
    review_outcome: null, review_submitted_at: null, review_files: [], last_decision: null, last_reason: null,
    released_at: null, viewed_at: null,
    ...over,
  };
}

const QUEUE = [
  row({ submission_id: "s1", learner_name: "Learner One" }),
  row({
    submission_id: "s2", learner_name: "Learner Two", cohort_id: "c2", cohort_name: "Cohort Two", requirement_ordinal: 2,
    status: "with_assessor", assessor_id: "a", assessor_name: "Coach A", due_on: "2026-10-01", review_overdue: true,
  }),
  row({
    submission_id: "s3", learner_name: "Learner Three", kind: "final_assessment", requirement_ordinal: 1,
    status: "awaiting_validation", assessor_id: "b", assessor_name: "Coach B", due_on: "2026-10-12",
    review_id: "r3", review_version: 1, review_text: "Clear and specific.", review_outcome: "pass",
    review_submitted_at: "2026-10-05T10:00:00Z",
    review_files: [{ storage_path: "e/s3/feedback.pdf", mime: "application/pdf", size_bytes: 1000 }],
  }),
  row({ submission_id: "s4", learner_name: "Learner Four", status: "released", review_id: "r4", released_at: "2026-10-04T10:00:00Z" }),
  row({
    submission_id: "s5", learner_name: "Learner Five", status: "released", review_id: "r5",
    released_at: "2026-10-04T10:00:00Z", viewed_at: "2026-10-05T08:00:00Z",
  }),
];

const POOLS: Record<string, { coach_id: string; full_name: string; is_active: boolean }[]> = {
  c1: [
    { coach_id: "a", full_name: "Coach A", is_active: true },
    { coach_id: "b", full_name: "Coach B", is_active: true },
    { coach_id: "x", full_name: "Coach X", is_active: false },
  ],
  c2: [
    { coach_id: "b", full_name: "Coach B", is_active: true },
    { coach_id: "c", full_name: "Coach C", is_active: true },
  ],
};

let rpcResult: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown } | undefined = () => undefined;

function mockBackend() {
  rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    const override = rpcResult(name, args);
    if (override) return Promise.resolve(override);
    if (name === "admin_assessment_queue") return Promise.resolve({ data: QUEUE, error: null });
    if (name === "admin_cohort_assessors") return Promise.resolve({ data: POOLS[args.p_cohort_id as string] ?? [], error: null });
    if (name === "admin_assign_assessor") return Promise.resolve({ data: (args.p_submission_ids as string[]).length, error: null });
    if (name === "admin_validate_review") return Promise.resolve({ data: args.p_decision, error: null });
    throw new Error(`unexpected rpc ${name}`);
  });
  from.mockImplementation((table: string) => {
    const data =
      table === "programmes"
        ? [{ id: "p1", name: "Leaders" }]
        : table === "cohorts"
          ? [{ id: "c1", name: "Cohort One", programme_id: "p1" }, { id: "c2", name: "Cohort Two", programme_id: "p1" }]
          : null;
    if (!data) throw new Error(`unexpected table ${table}`);
    return { select: () => ({ order: () => Promise.resolve({ data, error: null }) }) };
  });
}

function renderQueue(props: Parameters<typeof AssessmentQueue>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AssessmentQueue {...props} />
    </QueryClientProvider>,
  );
}

const rowFor = async (name: string) =>
  (await screen.findAllByTestId("assessment-row")).find((r) => r.textContent?.includes(name))!;

describe("AssessmentQueue", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    toastError.mockReset();
    invoke.mockReset().mockResolvedValue({ data: { sent: true }, error: null });
    rpcResult = () => undefined;
    mockBackend();
  });

  it("shows the assessor due date, overdue flag and whether the learner viewed released feedback", async () => {
    renderQueue();
    const two = await rowFor("Learner Two");
    expect(within(two).getByTestId("assessment-due")).toHaveTextContent("1 Oct 2026");
    expect(within(two).getByTestId("assessment-due")).toHaveTextContent("Overdue");
    expect(within(two).getByTestId("assessment-viewed")).toHaveTextContent("—");
    expect(within(await rowFor("Learner Four")).getByTestId("assessment-viewed")).toHaveTextContent("Not yet");
    expect(within(await rowFor("Learner Five")).getByTestId("assessment-viewed")).toHaveTextContent("5 Oct 2026");
    expect(within(await rowFor("Learner Three")).getByText("Final Assessment")).toBeInTheDocument();
  });

  it("passes every filter to admin_assessment_queue", async () => {
    renderQueue();
    await screen.findAllByTestId("assessment-row");
    const [programme, cohort, kind, status] = screen.getAllByRole("combobox");
    fireEvent.change(programme, { target: { value: "p1" } });
    fireEvent.change(cohort, { target: { value: "c2" } });
    fireEvent.change(kind, { target: { value: "final_assessment" } });
    fireEvent.change(status, { target: { value: "returned" } });
    await waitFor(() =>
      expect(rpc).toHaveBeenLastCalledWith("admin_assessment_queue", {
        p_programme_id: "p1",
        p_cohort_id: "c2",
        p_kind: "final_assessment",
        p_status: "returned",
      }),
    );
  });

  it("locks the kind to Triad on the Triads -> Submissions tab", async () => {
    renderQueue({ lockedKind: "triad" });
    await screen.findAllByTestId("assessment-row");
    expect(rpc).toHaveBeenCalledWith("admin_assessment_queue", expect.objectContaining({ p_kind: "triad" }));
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("bulk-assigns across cohorts, offering only a Coach in every selected cohort's pool", async () => {
    renderQueue();
    fireEvent.click(within(await rowFor("Learner One")).getByRole("checkbox"));
    fireEvent.click(within(await rowFor("Learner Two")).getByRole("checkbox"));
    // A submission awaiting validation or released cannot be (re)assigned.
    expect(within(await rowFor("Learner Three")).getByRole("checkbox")).toBeDisabled();
    fireEvent.click(screen.getByTestId("assessment-bulk-assign"));

    const dialog = await screen.findByTestId("assessment-assign-dialog");
    const picker = await within(dialog).findByRole("combobox");
    expect(within(picker).getAllByRole("option").map((o) => o.textContent).filter(Boolean)).toEqual(["Coach B"]);
    fireEvent.change(picker, { target: { value: "b" } });
    fireEvent.click(within(dialog).getByTestId("assessment-assign-confirm"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("admin_assign_assessor", { p_submission_ids: ["s1", "s2"], p_assessor_id: "b" }),
    );
  });

  it("explains a refusal to assign the learner's own programme coach", async () => {
    rpcResult = (name) =>
      name === "admin_assign_assessor"
        ? { data: null, error: { code: "42501", message: "An assessor cannot be the learner's own programme coach" } }
        : undefined;
    renderQueue();
    fireEvent.click(within(await rowFor("Learner One")).getByTestId("assessment-assign"));
    const dialog = await screen.findByTestId("assessment-assign-dialog");
    fireEvent.change(await within(dialog).findByRole("combobox"), { target: { value: "a" } });
    fireEvent.click(within(dialog).getByTestId("assessment-assign-confirm"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("That Coach is the learner's own programme coach and cannot assess them."),
    );
  });

  it("approves a review, which releases it and emails the learner", async () => {
    renderQueue();
    fireEvent.click(within(await rowFor("Learner Three")).getByTestId("assessment-open-review"));
    const dialog = await screen.findByTestId("assessment-review-dialog");
    expect(within(dialog).getByTestId("assessment-review-text")).toHaveTextContent("Clear and specific.");
    expect(within(dialog).getByText("Pass")).toBeInTheDocument();
    expect(await within(dialog).findByRole("link", { name: "feedback.pdf" })).toHaveAttribute("href", "https://signed/x.pdf");
    fireEvent.click(within(dialog).getByTestId("assessment-approve"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("admin_validate_review", { p_review_id: "r3", p_decision: "approved", p_reason: undefined }),
    );
    // The release email (Resend) is sent once the release has committed.
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("send-assessment-feedback-email", { body: { submission_id: "s3" } }),
    );
  });

  it("returns a review only with a reason", async () => {
    renderQueue();
    fireEvent.click(within(await rowFor("Learner Three")).getByTestId("assessment-open-review"));
    const dialog = await screen.findByTestId("assessment-review-dialog");
    fireEvent.click(within(dialog).getByTestId("assessment-return"));
    const confirm = within(dialog).getByTestId("assessment-return-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByTestId("assessment-return-reason"), { target: { value: "   " } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByTestId("assessment-return-reason"), { target: { value: " Name one behaviour. " } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("admin_validate_review", {
        p_review_id: "r3",
        p_decision: "returned",
        p_reason: "Name one behaviour.",
      }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("only reads a released review: no approve or return", async () => {
    renderQueue();
    fireEvent.click(within(await rowFor("Learner Five")).getByTestId("assessment-open-review"));
    const dialog = await screen.findByTestId("assessment-review-dialog");
    expect(within(dialog).queryByTestId("assessment-approve")).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("assessment-return")).not.toBeInTheDocument();
  });
});
