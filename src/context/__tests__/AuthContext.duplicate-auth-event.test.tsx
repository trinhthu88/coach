/**
 * Regression test: a duplicate onAuthStateChange event for the SAME user must not
 * flash role/profile to null once isLoading has already resolved via getSession().
 *
 * Real-world trigger: Supabase fires an INITIAL_SESSION event on mount when a
 * session already exists in storage, independently of getSession() resolving —
 * ordering between the two isn't guaranteed. If that event lands after
 * getSession()'s own loadProfileAndRole has already set role and flipped
 * isLoading to false, the old code unconditionally wiped role/profile to null,
 * which could bounce a role-gated route (ProtectedRoute) for a user who was never
 * actually signed out.
 */

import { render, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { AuthProvider, useAuth } from "@/context/AuthContext";

type AuthCallback = (event: string, session: unknown) => void;
let capturedAuthCallback: AuthCallback | null = null;

const PROFILE = { id: "user-a", full_name: "Alice Admin", status: "active" };
const ROLES = [{ role: "admin" }];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        capturedAuthCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: () => Promise.resolve({ data: { session: { user: { id: "user-a" } } } }),
      signOut: vi.fn(),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          if (table === "user_roles") return Promise.resolve({ data: ROLES });
          return { maybeSingle: () => Promise.resolve({ data: PROFILE }) };
        },
      }),
    }),
  },
}));

function RoleProbe() {
  const { role, isLoading } = useAuth();
  return <div data-testid="role">{isLoading ? "loading" : role ?? "none"}</div>;
}

describe("AuthContext – duplicate auth event for the same user", () => {
  it("keeps role stable when onAuthStateChange fires for the same user after getSession has already resolved", async () => {
    capturedAuthCallback = null;
    const { getByTestId } = render(
      <AuthProvider>
        <RoleProbe />
      </AuthProvider>
    );

    // getSession() resolves and loads role='admin', isLoading -> false.
    await waitFor(() => expect(getByTestId("role").textContent).toBe("admin"));

    // A redundant event for the SAME user (e.g. INITIAL_SESSION) fires after the
    // fact — this must not wipe role/profile.
    act(() => {
      capturedAuthCallback!("INITIAL_SESSION", { user: { id: "user-a" } });
    });

    expect(getByTestId("role").textContent).toBe("admin");

    // Also stable a tick later — nothing async should re-null it either.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(getByTestId("role").textContent).toBe("admin");
  });

  it("still wipes role when a genuinely different user signs in", async () => {
    capturedAuthCallback = null;
    const { getByTestId } = render(
      <AuthProvider>
        <RoleProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId("role").textContent).toBe("admin"));

    act(() => {
      capturedAuthCallback!("SIGNED_IN", { user: { id: "user-b" } });
    });

    // Real account transition — profile/role must clear immediately.
    expect(getByTestId("role").textContent).toBe("none");
  });
});
