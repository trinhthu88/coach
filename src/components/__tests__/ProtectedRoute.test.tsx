import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "@/i18n/config";

// Controls what get_my_programme_modules() resolves to for the "module" gate
// tests below — the shape useProgrammeModules() (and useModuleAccess, which
// now delegates to it) expects back from that RPC.
let mockModuleAccess: { module: string; enabled: boolean; config: Record<string, unknown> }[] = [];

// Mock the supabase client so nothing hits the network.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
    rpc: async () => ({ data: mockModuleAccess, error: null }),
  },
}));

const mockAuth = vi.fn();
vi.mock("@/context/AuthContext", async () => {
  return {
    useAuth: () => mockAuth(),
  };
});

import { ProtectedRoute } from "../ProtectedRoute";

function renderAt(
  path: string,
  role?: "admin" | "coach" | "coachee",
  opts?: { roles?: ("admin" | "coach" | "coachee")[]; module?: string }
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={path}
            element={
              <ProtectedRoute role={role} roles={opts?.roles} module={opts?.module}>
                <div>protected content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/auth" element={<div>auth page</div>} />
          <Route path="/pending" element={<div>pending page</div>} />
          <Route path="/set-new-password" element={<div>set password page</div>} />
          <Route path="/dashboard" element={<div>dashboard page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const baseProfile = {
  id: "u1",
  full_name: "Test",
  email: "t@example.com",
  avatar_url: null,
  bio: null,
  status: "active",
  must_change_password: false,
};

beforeEach(() => {
  mockAuth.mockReset();
  mockModuleAccess = [];
});

describe("ProtectedRoute", () => {
  it("shows a loader while auth is resolving", () => {
    mockAuth.mockReturnValue({ user: null, role: null, profile: null, isLoading: true });
    renderAt("/private");
    expect(screen.getByText(/loading platform/i)).toBeInTheDocument();
  });

  it("redirects unauthenticated users to /auth", () => {
    mockAuth.mockReturnValue({ user: null, role: null, profile: null, isLoading: false });
    renderAt("/private");
    expect(screen.getByText("auth page")).toBeInTheDocument();
  });

  it("redirects users flagged must_change_password to /set-new-password", () => {
    mockAuth.mockReturnValue({
      user: { id: "u1" },
      role: "coachee",
      profile: { ...baseProfile, must_change_password: true },
      isLoading: false,
    });
    renderAt("/private");
    expect(screen.getByText("set password page")).toBeInTheDocument();
  });

  it("redirects non-active users to /pending", () => {
    mockAuth.mockReturnValue({
      user: { id: "u1" },
      role: "coach",
      profile: { ...baseProfile, status: "pending_approval" },
      isLoading: false,
    });
    renderAt("/private");
    expect(screen.getByText("pending page")).toBeInTheDocument();
  });

  // Every value of the DB `user_status` enum (see supabase/migrations
  // 20260430130143_*), so a new/renamed status value breaks this test
  // instead of silently falling through to the wrong branch.
  describe.each([
    { status: "inactive", expectPending: true },
    { status: "pending_approval", expectPending: true },
    { status: "active", expectPending: false },
    { status: "suspended", expectPending: true },
    { status: "rejected", expectPending: true },
    // 'reach_limit' must NOT redirect to /pending — it only blocks new
    // bookings (enforced separately in BookSession.tsx), per the comment
    // in ProtectedRoute.tsx above the status check.
    { status: "reach_limit", expectPending: false },
  ])("profile.status = $status", ({ status, expectPending }) => {
    it(expectPending ? "redirects to /pending" : "renders children", () => {
      mockAuth.mockReturnValue({
        user: { id: "u1" },
        role: "coachee",
        profile: { ...baseProfile, status },
        isLoading: false,
      });
      renderAt("/private");
      if (expectPending) {
        expect(screen.getByText("pending page")).toBeInTheDocument();
      } else {
        expect(screen.getByText("protected content")).toBeInTheDocument();
      }
    });
  });

  it("lets admins through even when their status is not active", () => {
    mockAuth.mockReturnValue({
      user: { id: "u1" },
      role: "admin",
      profile: { ...baseProfile, status: "suspended" },
      isLoading: false,
    });
    renderAt("/private");
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("blocks a role mismatch by redirecting to /dashboard", () => {
    mockAuth.mockReturnValue({
      user: { id: "u1" },
      role: "coachee",
      profile: baseProfile,
      isLoading: false,
    });
    renderAt("/private", "coach");
    expect(screen.getByText("dashboard page")).toBeInTheDocument();
  });

  it("allows admins into role-restricted routes", () => {
    mockAuth.mockReturnValue({
      user: { id: "u1" },
      role: "admin",
      profile: baseProfile,
      isLoading: false,
    });
    renderAt("/private", "coach");
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("renders children for a matching role", () => {
    mockAuth.mockReturnValue({
      user: { id: "u1" },
      role: "coach",
      profile: baseProfile,
      isLoading: false,
    });
    renderAt("/private", "coach");
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  // `roles` (plural) lets a route accept more than one role — e.g. mentoring is
  // available to both coach and coachee, unlike the single-`role` routes above.
  describe.each([
    { role: "coachee", matches: true },
    { role: "coach", matches: true },
    { role: "admin", matches: true }, // admin always bypasses
  ] as const)("roles=[coach,coachee], actual role=$role", ({ role, matches }) => {
    it(matches ? "renders children" : "redirects to /dashboard", () => {
      mockAuth.mockReturnValue({ user: { id: "u1" }, role, profile: baseProfile, isLoading: false });
      renderAt("/private", undefined, { roles: ["coach", "coachee"] });
      expect(screen.getByText(matches ? "protected content" : "dashboard page")).toBeInTheDocument();
    });
  });

  it("blocks a roles-array mismatch by redirecting to /dashboard", () => {
    mockAuth.mockReturnValue({ user: { id: "u1" }, role: "coachee", profile: baseProfile, isLoading: false });
    renderAt("/private", undefined, { roles: ["coach"] });
    expect(screen.getByText("dashboard page")).toBeInTheDocument();
  });

  // `module` gates on the active programme's modules via get_my_programme_modules()
  // — mocked above through mockModuleAccess, which stands in for the RPC result.
  it("redirects to /dashboard when the module is disabled", async () => {
    mockModuleAccess = [];
    mockAuth.mockReturnValue({ user: { id: "u1" }, role: "coachee", profile: baseProfile, isLoading: false });
    renderAt("/private", undefined, { module: "mentoring" });
    await waitFor(() => expect(screen.getByText("dashboard page")).toBeInTheDocument());
  });

  it("renders children when the module is enabled", async () => {
    mockModuleAccess = [{ module: "mentoring", enabled: true, config: {} }];
    mockAuth.mockReturnValue({ user: { id: "u1" }, role: "coachee", profile: baseProfile, isLoading: false });
    renderAt("/private", undefined, { module: "mentoring" });
    await waitFor(() => expect(screen.getByText("protected content")).toBeInTheDocument());
  });

  it("lets admins through a disabled module gate", async () => {
    mockModuleAccess = [];
    mockAuth.mockReturnValue({ user: { id: "u1" }, role: "admin", profile: baseProfile, isLoading: false });
    renderAt("/private", undefined, { module: "mentoring" });
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });
});
