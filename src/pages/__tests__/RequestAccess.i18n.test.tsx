import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: vi.fn(async () => ({ error: null })) }) },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

import "@/i18n/config";
import i18n from "@/i18n/config";
import RequestAccess from "../RequestAccess";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("RequestAccess page i18n", () => {
  it("switches visible strings to Vietnamese via the language switcher", async () => {
    render(
      <MemoryRouter>
        <RequestAccess />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Request access" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Full name/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit application/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "VI" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Yêu cầu quyền truy cập" })).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/Họ và tên/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gửi đơn đăng ký/ })).toBeInTheDocument();
    expect(screen.queryByText("Request access", { selector: "h2" })).not.toBeInTheDocument();
  });
});
