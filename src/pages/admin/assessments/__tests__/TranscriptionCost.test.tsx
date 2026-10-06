import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import "@/i18n/config";
import { TranscriptionCost } from "../TranscriptionCost";

const now = new Date().toISOString();
const row = (over: Record<string, unknown>) => ({
  transcription_id: crypto.randomUUID(), enrollment_id: "enr-1", attempt_no: 1, learner_id: "u1",
  learner_name: "Lan Nguyen", status: "succeeded", audio_minutes: 30, started_at: now, finished_at: now,
  ...over,
});

beforeEach(() => rpc.mockReset());

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TranscriptionCost />
    </QueryClientProvider>,
  );
}

describe("Admin -> Assessments: automatic transcription cost", () => {
  it("totals calls, audio minutes and the estimated cost, this month and all time", async () => {
    rpc.mockResolvedValue({
      data: [
        row({}),
        row({ status: "failed", audio_minutes: null, learner_name: "Minh Tran", attempt_no: 2 }),
        row({ audio_minutes: 20, started_at: "2025-01-15T03:00:00Z" }),
      ],
      error: null,
    });
    renderCard();
    expect(await screen.findByTestId("admin-transcription-month")).toHaveTextContent("2 calls · 30.0 audio min · ≈ $0.18");
    expect(screen.getByTestId("admin-transcription-all")).toHaveTextContent("3 calls · 50.0 audio min · ≈ $0.30");
    expect(rpc).toHaveBeenCalledWith("admin_final_assessment_transcriptions", { p_since: undefined });
    const rows = screen.getAllByTestId("admin-transcription-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("Minh Tran")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Failed")).toBeInTheDocument();
  });
});
