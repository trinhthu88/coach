import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signUp: vi.fn(async () => ({ error: null })),
    },
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

import "@/i18n/config";
import i18n from "@/i18n/config";
import Auth from "../Auth";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Auth page i18n", () => {
  it("switches every visible string to Vietnamese via the language switcher", async () => {
    render(
      <MemoryRouter>
        <Auth />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Sign in to Clariva" })).toBeInTheDocument();
    expect(screen.getByText("Enter your credentials to access your dashboard.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("name@company.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in/ })).toBeInTheDocument();
    expect(screen.getByText("Forgot password?")).toBeInTheDocument();
    expect(screen.getByText("Request access")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "VI" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Đăng nhập vào Clariva" })).toBeInTheDocument()
    );
    expect(
      screen.getByText("Nhập thông tin đăng nhập để truy cập bảng điều khiển của bạn.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Địa chỉ email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("name@company.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Đăng nhập/ })).toBeInTheDocument();
    expect(screen.getByText("Quên mật khẩu?")).toBeInTheDocument();
    expect(screen.getByText("Yêu cầu quyền truy cập")).toBeInTheDocument();

    // No leftover English strings from the pre-switch render.
    expect(screen.queryByText("Sign in to Clariva")).not.toBeInTheDocument();
    expect(screen.queryByText("Forgot password?")).not.toBeInTheDocument();
  });
});
