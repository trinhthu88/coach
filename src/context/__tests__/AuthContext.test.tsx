import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

type RoleRow = { role: string };

const state: { roles: RoleRow[] } = { roles: [] };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: async () => ({
        data: { session: { user: { id: "u1" } } },
      }),
      signOut: async () => ({ error: null }),
    },
    from: (table: string) => ({
      select: () => {
        if (table === "user_roles") {
          return {
            eq: async () => ({ data: state.roles, error: null }),
          };
        }
        return {
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "u1",
                full_name: "Test",
                email: "t@example.com",
                avatar_url: null,
                bio: null,
                status: "active",
                must_change_password: false,
              },
              error: null,
            }),
          }),
        };
      },
    }),
  },
}));

import { AuthProvider, useAuth } from "../AuthContext";

function RoleProbe() {
  const { role } = useAuth();
  return <div data-testid="role">{role ?? "none"}</div>;
}

async function renderWithRoles(roles: string[]) {
  state.roles = roles.map((role) => ({ role }));
  render(
    <AuthProvider>
      <RoleProbe />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("role").textContent).not.toBe(""));
  return screen.getByTestId("role");
}

beforeEach(() => {
  state.roles = [];
});

describe("AuthContext role priority", () => {
  it("prefers admin over coach and coachee", async () => {
    const el = await renderWithRoles(["coachee", "coach", "admin"]);
    await waitFor(() => expect(el.textContent).toBe("admin"));
  });

  it("prefers coach over coachee", async () => {
    const el = await renderWithRoles(["coachee", "coach"]);
    await waitFor(() => expect(el.textContent).toBe("coach"));
  });

  it("falls back to coachee when it is the only role", async () => {
    const el = await renderWithRoles(["coachee"]);
    await waitFor(() => expect(el.textContent).toBe("coachee"));
  });

  it("has no role when the user has none assigned", async () => {
    const el = await renderWithRoles([]);
    await waitFor(() => expect(el.textContent).toBe("none"));
  });
});
