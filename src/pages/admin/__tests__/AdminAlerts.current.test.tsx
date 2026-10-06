import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n/config";
import i18n from "@/i18n/config";
import type { CurrentAlert } from "../alertText";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  tables: [] as string[],
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: (table: string) => {
      mocks.tables.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: async () => ({ data: [], error: null }),
        update: () => query,
      };
      return query;
    },
  },
}));

import AdminAlerts from "../AdminAlerts";

const base: CurrentAlert = {
  alert_key: "", stored_alert_id: null, severity: "info", alert_type: "", related_enrollment_id: "e1",
  related_user_id: "u1", related_coach_id: null, subject_name: "Lan Pham", subject_email: "lan@example.test",
  coach_name: null, count_value: null, pct_value: null, occurred_on: null, note: null,
  stored_title: null, stored_message: null, created_at: null,
};

const rows: CurrentAlert[] = [
  { ...base, alert_key: "needs_attention:e1", severity: "warning", alert_type: "needs_attention", count_value: 2 },
  { ...base, alert_key: "reflection_outstanding:e1", alert_type: "reflection_outstanding", count_value: 3, occurred_on: "2026-10-01" },
  { ...base, alert_key: "prep_file_outstanding:e1", alert_type: "prep_file_outstanding", count_value: 1 },
  { ...base, alert_key: "stored:a1", stored_alert_id: "a1", severity: "warning", alert_type: "triad_admin_alert",
    stored_title: "Triad group needs a session", stored_message: "From an Edge Function", created_at: "2026-10-05T08:00:00Z" },
];

describe("AdminAlerts renders admin_alerts_current", () => {
  beforeEach(async () => {
    mocks.rpc.mockReset();
    mocks.tables.length = 0;
    mocks.rpc.mockResolvedValue({ data: rows, error: null });
    await i18n.changeLanguage("en");
  });

  it("words each canonical row, never claims completion is blocked, and resolves only stored alerts", async () => {
    render(<AdminAlerts />);
    expect(await screen.findByText("Lan Pham — needs attention")).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith("admin_alerts_current");
    // The overdue count is the row's own.
    expect(screen.getByText(/2 required activities are past their due date/)).toBeInTheDocument();
    // Evidence reminders say so; nothing claims completion waits on them.
    expect(screen.getByText(/The sessions already count; this is a reminder only/)).toBeInTheDocument();
    expect(screen.getByText(/It is optional and does not affect completion/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/can't mark|cannot mark|until it's submitted/i);

    const cards = screen.getAllByTestId("alert-row");
    const stored = cards.find((c) => within(c).queryByText("Triad group needs a session"))!;
    expect(within(stored).getByRole("button", { name: /resolve/i })).toBeInTheDocument();
    expect(cards.filter((c) => within(c).queryByRole("button", { name: /resolve/i }))).toHaveLength(1);

    // No raw table is read to build alerts: only resolved stored alerts.
    expect(mocks.tables).toEqual(["admin_alerts"]);
  });

  it("has Vietnamese wording for every live alert type", async () => {
    await i18n.changeLanguage("vi");
    render(<AdminAlerts />);
    expect(await screen.findByText("Lan Pham — cần chú ý")).toBeInTheDocument();
    expect(screen.getByText(/đây chỉ là nhắc nhở/)).toBeInTheDocument();
    await i18n.changeLanguage("en");
  });
});
