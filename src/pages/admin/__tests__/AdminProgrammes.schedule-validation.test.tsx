import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n/config";
import i18n from "@/i18n/config";

const mocks = vi.hoisted(() => ({
  programmeUpdate: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
  moduleUpsert: vi.fn().mockResolvedValue({ error: null }),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "programmes") {
        return {
          select: () => ({
            order: vi.fn().mockResolvedValue({
              data: [{
                id: "programme-1",
                name: "Test programme",
                description: null,
                duration_months: 3,
                color: "cobalt",
                is_active: true,
                coachee_session_limit: 8,
                coach_session_limit: 8,
                peer_session_limit: 4,
                peer_given_limit: 4,
                mentoring_received_limit: null,
              }],
            }),
          }),
          update: mocks.programmeUpdate,
        };
      }
      if (table === "cohorts") {
        return { select: () => ({ order: vi.fn().mockResolvedValue({ data: [] }) }) };
      }
      if (table === "programme_enrollments") {
        return { select: vi.fn().mockResolvedValue({ data: [] }) };
      }
      if (table === "programme_modules") {
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({
              data: [{
                module: "coaching",
                enabled: true,
                config: {
                  give: true,
                  required: true,
                  required_units: 0,
                  distribution_mode: "flexible",
                  distribution_settings: {},
                },
              }],
            }),
          }),
          upsert: mocks.moduleUpsert,
        };
      }
      if (table === "training_weeks") {
        return {
          select: () => ({
            eq: () => ({ order: vi.fn().mockResolvedValue({ data: [] }) }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

import AdminProgrammes from "../AdminProgrammes";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mocks.programmeUpdate.mockClear();
  mocks.moduleUpsert.mockClear();
  mocks.toastError.mockClear();
});

describe("AdminProgrammes schedule validation", () => {
  it("rejects an invalid module schedule before updating the programme", async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AdminProgrammes /></MemoryRouter>);

    await screen.findByText("Test programme");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog", { name: "Edit programme" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "Coaching: Required modules must have at least one unit."
    ));
    expect(mocks.programmeUpdate).not.toHaveBeenCalled();
    expect(mocks.moduleUpsert).not.toHaveBeenCalled();
  });
});
