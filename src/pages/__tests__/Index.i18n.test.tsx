import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

import "@/i18n/config";
import i18n from "@/i18n/config";
import Index from "../Index";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Index (landing) page i18n", () => {
  it("switches hero and footer strings to Vietnamese via the language switcher", async () => {
    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>
    );

    const heroHeading = screen.getByRole("heading", { level: 1 });
    expect(heroHeading.textContent).toContain("The private");
    expect(heroHeading.textContent).toContain("elite coaching.");
    expect(screen.getByText("© 2026 Clariva. All rights reserved.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "VI" }));

    await waitFor(() => expect(heroHeading.textContent).toContain("Nền tảng riêng tư"));
    expect(heroHeading.textContent).toContain("chuyên biệt.");
    expect(screen.getByText("© 2026 Clariva. Bảo lưu mọi quyền.")).toBeInTheDocument();
    expect(heroHeading.textContent).not.toContain("The private");
  });
});
