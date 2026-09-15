import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n/config";
import i18n from "@/i18n/config";

const mocks = vi.hoisted(() => ({
  programmeUpdate: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
  programmeInsert: vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { id: "programme-new" }, error: null }),
    })),
  })),
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
          insert: mocks.programmeInsert,
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

import ProgrammeBuilder from "../ProgrammeBuilder";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mocks.programmeUpdate.mockClear();
  mocks.programmeInsert.mockClear();
  mocks.moduleUpsert.mockClear();
  mocks.toastError.mockClear();
});

describe("ProgrammeBuilder schedule validation", () => {
  it("rejects an invalid module schedule before creating the programme", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/programmes/new"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/admin/programmes/new" element={<ProgrammeBuilder />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Invalid programme" } });
    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByRole("switch", { name: "Required or optional" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      "Fix the validation errors before saving."
    ));
    expect(mocks.programmeInsert).not.toHaveBeenCalled();
    expect(mocks.moduleUpsert).not.toHaveBeenCalled();
  });
});
