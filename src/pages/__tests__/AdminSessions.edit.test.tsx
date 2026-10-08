import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The Admin edit dialog changes a session through the Admin-checked lifecycle
// endpoint (which calls the audited lifecycle RPC), never a table write.
const sessionRow = {
  id: "sess1",
  topic: "Leadership focus",
  start_time: new Date(Date.now() + 7 * 86400000).toISOString(),
  duration_minutes: 60,
  status: "confirmed",
  meeting_url: "https://meet.example/old",
  coach_notes: null,
  coachee_notes: null,
  coach_id: "coach1",
  coachee_id: "coachee1",
  created_at: new Date().toISOString(),
  coachee_rating: null,
};

const rpc = vi.fn(async (..._args: unknown[]) => ({ data: [], error: null }));
const update = vi.fn((..._args: unknown[]) => ({ eq: async () => ({ error: null }) }));
const invoke = vi.fn(async (..._args: unknown[]) => ({ data: { ok: true }, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        update: (...args: unknown[]) => update(...args),
        order: async () => ({ data: table === "sessions" ? [sessionRow] : [] }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: table === "profiles"
            ? [{ id: "coach1", full_name: "Elena Richter", email: "e@x.com" },
               { id: "coachee1", full_name: "Minh Tran", email: "m@x.com" }]
            : [] }),
      };
      return query;
    },
  },
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import "@/i18n/config";
import i18n from "@/i18n/config";
import AdminSessions from "../AdminSessions";
import { toast } from "@/hooks/use-toast";

beforeEach(async () => {
  rpc.mockClear();
  update.mockClear();
  invoke.mockClear();
  vi.mocked(toast).mockClear();
  await i18n.changeLanguage("en");
});

async function openEditDialog() {
  render(<MemoryRouter><AdminSessions /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /edit/i }));
  return screen.findByDisplayValue("Leadership focus");
}

describe("Admin session edit dialog", () => {
  it("reschedules through admin_reschedule_session with the reason, never a table update", async () => {
    fireEvent.change(await openEditDialog(), { target: { value: "Leadership, part two" } });
    fireEvent.change(screen.getByPlaceholderText(i18n.t("admin:sessions.changeReasonPlaceholder")),
      { target: { value: "Coach asked to retitle" } });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("admin:sessions.save") }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("admin-session-edit", {
      body: {
        function_name: "admin_reschedule_session",
        args: expect.objectContaining({
          p_kind: "coaching",
          p_session_id: "sess1",
          p_topic: "Leadership, part two",
          p_reason: "Coach asked to retitle",
          p_duration_minutes: 60,
        }),
      },
    }));
    expect(rpc).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("asks for a reason instead of saving without one", async () => {
    fireEvent.change(await openEditDialog(), { target: { value: "Leadership, part two" } });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("admin:sessions.save") }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: i18n.t("admin:sessions.errors.reasonRequired"),
    })));
    expect(invoke).not.toHaveBeenCalledWith("admin-session-edit", expect.anything());
    expect(rpc).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("shows participant notes read-only", async () => {
    await openEditDialog();
    expect(screen.getByText(i18n.t("admin:sessions.notesReadOnly"))).toBeInTheDocument();
  });
});
