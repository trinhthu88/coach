import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const sessionRow = {
  id: "sess1",
  coach_id: "coach1",
  coachee_id: "coachee1",
  topic: "Leadership focus",
  start_time: new Date(Date.now() + 86400000).toISOString(),
  duration_minutes: 45,
  status: "confirmed",
  action_items: [],
  coachee_rating: null,
  coachee_rating_comment: null,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: async () => (table === "sessions" ? { data: [sessionRow] } : { data: [] }),
        }),
        in: async () => ({ data: [{ id: "coach1", full_name: "Elena Richter", email: "e@x.com", avatar_url: null }] }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));

const authValue = { user: { id: "coachee1" }, role: "coachee" as const };
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => authValue,
}));

import "@/i18n/config";
import i18n from "@/i18n/config";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import Sessions from "../Sessions";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Sessions list page i18n", () => {
  it("switches the status badge and page header to Vietnamese", async () => {
    render(
      <MemoryRouter>
        <LanguageSwitcher />
        <Sessions />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Confirmed")).toBeInTheDocument());
    expect(screen.getByText(/Upcoming \(/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "VI" }));

    await waitFor(() => expect(screen.getByText("Đã xác nhận")).toBeInTheDocument());
    expect(screen.getByText(/Sắp tới \(/)).toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
  });
});
