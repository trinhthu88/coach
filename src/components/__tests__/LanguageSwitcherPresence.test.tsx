import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, vi } from "vitest";

// Shared mocks covering every dependency touched by the pages under test.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: async () => ({ data: { session: null } }),
      updateUser: vi.fn(async () => ({ error: null })),
      getUser: vi.fn(async () => ({ data: { user: null } })),
    },
    from: () => ({
      insert: vi.fn(async () => ({ error: null })),
      update: () => ({ eq: vi.fn(async () => ({ error: null })) }),
      select: () => ({ eq: () => ({ in: async () => ({ data: [] }) }) }),
    }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: vi.fn(),
    rpc: vi.fn(async () => ({ data: false, error: null })),
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    profile: null,
    role: "admin",
    signOut: async () => {},
    refreshProfile: async () => {},
  }),
}));

import "@/i18n/config";
import Index from "@/pages/Index";
import RequestAccess from "@/pages/RequestAccess";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import SetNewPassword from "@/pages/SetNewPassword";
import AppLayout from "@/components/AppLayout";

afterEach(cleanup);

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("LanguageSwitcher is wired into every public page", () => {
  it.each([
    ["Index", Index],
    ["RequestAccess", RequestAccess],
    ["ForgotPassword", ForgotPassword],
    ["ResetPassword", ResetPassword],
    ["SetNewPassword", SetNewPassword],
  ] as const)("renders on %s", (_name, Page) => {
    renderWithRouter(<Page />);
    expect(screen.getAllByRole("group", { name: "Language" }).length).toBeGreaterThan(0);
  });

  it("renders inside the authenticated AppLayout shell", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<div>content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getAllByRole("group", { name: "Language" }).length).toBeGreaterThan(0);
  });
});
