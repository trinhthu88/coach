import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: async () => ({ data: [] }),
          }),
          order: undefined,
        }),
      }),
    }),
  },
}));

import "@/i18n/config";
import i18n from "@/i18n/config";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SessionGoalRatings } from "../SessionGoalRatings";

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("SessionGoalRatings i18n", () => {
  it("switches the empty-state copy to Vietnamese", async () => {
    render(
      <>
        <LanguageSwitcher />
        <SessionGoalRatings sessionId="s1" coacheeId="c1" canEdit={false} sessionStatus="completed" />
      </>
    );

    await waitFor(() => expect(screen.getByText("Goal reflection")).toBeInTheDocument());
    expect(screen.getByText(/No active goals yet/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "VI" }));

    await waitFor(() => expect(screen.getByText("Suy ngẫm về mục tiêu")).toBeInTheDocument());
    expect(screen.getByText(/Chưa có mục tiêu nào đang hoạt động/)).toBeInTheDocument();
    expect(screen.queryByText("Goal reflection")).not.toBeInTheDocument();
  });
});
