import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

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
  },
}));

const mockAuth = vi.fn();
vi.mock("@/context/AuthContext", async () => {
  return {
    useAuth: () => mockAuth(),
  };
});

import { ProtectedRoute } from "../ProtectedRoute";

function renderAt(path: string, role?: "admin" | "coach" | "coachee") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={path}
          element={
            <ProtectedRoute role={role}>
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
});
