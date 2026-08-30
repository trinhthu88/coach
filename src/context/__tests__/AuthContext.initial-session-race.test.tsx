/**
 * Regression test: onAuthStateChange's INITIAL_SESSION event arriving before
 * getSession()'s own callback resolves, on first mount with an existing
 * session in storage.
 *
 * Real-world trigger (found via live browser testing, not a unit-test-only
 * concern): ordering between the listener firing and getSession() resolving
 * isn't guaranteed. When the listener fires first, currentUserIdRef.current
 * is still null, so it's misread as a real account transition — it wipes
 * role/profile and schedules its own deferred loadProfileAndRole. That
 * leaves two concurrent loadProfileAndRole calls in flight for the SAME
 * user: the listener's deferred one, and getSession()'s direct one. The seq
 * mechanism ensures only the later call's role/profile actually apply, but
 * isLoading used to be cleared by getSession()'s own .finally() regardless
 * of which call "won" — so a render could observe isLoading:false with
 * role still null (the discarded call's wipe), which bounces a role-gated
 * route (ProtectedRoute) for a user who was never signed out. This is what
 * caused real, intermittent mis-redirects on direct/hard navigation to deep
 * routes (e.g. /admin/registrations, /sponsor) for already-authenticated
 * users.
 *
 * Expected: isLoading must never read false while role is still null for an
 * authenticated user mid-load — the two must resolve together.
 */

import { render, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useEffect, useRef } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";

type AuthCallback = (event: string, session: unknown) => void;
let capturedAuthCallback: AuthCallback | null = null;

/** Controlled resolvers so the test can order events precisely. */
let resolveGetSession!: (v: { data: { session: unknown } }) => void;
const pendingProfileResolvers: Array<(v: unknown) => void> = [];
const pendingRoleResolvers: Array<(v: unknown) => void> = [];

function makeChain(table: string): unknown {
  let resolver!: (v: unknown) => void;
  const p = new Promise((res) => { resolver = res; });
  if (table === "profiles") pendingProfileResolvers.push(resolver);
  else pendingRoleResolvers.push(resolver);

  const methods = ["select", "eq", "order", "limit", "in", "or"];
  function chain(): unknown {
    const obj: Record<string, unknown> = {};
    for (const m of methods) obj[m] = () => chain();
    obj["maybeSingle"] = () => p;
    obj["then"] = (onf: (v: unknown) => unknown, onr: (e: unknown) => unknown) => p.then(onf, onr);
    return obj;
  }
  return chain();
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        capturedAuthCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => new Promise((res) => { resolveGetSession = res; }),
      signOut: vi.fn(),
    },
    from: (table: string) => makeChain(table),
  },
}));

const flushMacrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

function makeSession(userId: string) {
  return { user: { id: userId } };
}

type Snapshot = { isLoading: boolean; role: string | null };

function renderProbe() {
  const seen: Snapshot[] = [];
  function Probe() {
    const { isLoading, role } = useAuth();
    const ref = useRef<Snapshot>({ isLoading, role });
    useEffect(() => {
      const entry = { isLoading, role };
      if (entry.isLoading !== ref.current.isLoading || entry.role !== ref.current.role) {
        ref.current = entry;
        seen.push(entry);
      }
    });
    return null;
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  return seen;
}

describe("AuthContext – INITIAL_SESSION arriving before getSession() resolves", () => {
  beforeEach(() => {
    capturedAuthCallback = null;
    pendingProfileResolvers.length = 0;
    pendingRoleResolvers.length = 0;
  });

  it("never reports isLoading:false with role still null for an authenticated user", async () => {
    const seen = renderProbe();

    // 1. The listener fires INITIAL_SESSION for an existing user BEFORE
    // getSession() has resolved — currentUserIdRef.current is still null at
    // this point, so this is (mis)read as a real transition: it wipes
    // role/profile synchronously and schedules a DEFERRED loadProfileAndRole
    // (setTimeout(0), "to avoid deadlock inside the auth callback").
    act(() => { capturedAuthCallback!("INITIAL_SESSION", makeSession("user-a")); });

    // 2. Resolve getSession() for the SAME user BEFORE flushing that deferred
    // timer. Its .then() runs as a microtask — which the JS event loop
    // always drains before the next macrotask — so getSession()'s own
    // (non-deferred) loadProfileAndRole call is invoked FIRST, ahead of the
    // listener's deferred one, even though the listener fired first. This is
    // the real interleaving: whichever call the old code attached
    // `.finally(() => setIsLoading(false))` to (getSession()'s) gets the
    // LOWER seq, not the higher one.
    await act(async () => {
      resolveGetSession({ data: { session: makeSession("user-a") } });
      await Promise.resolve(); // let the microtask (getSession's .then) run
    });
    expect(pendingProfileResolvers).toHaveLength(1); // getSession()'s call, seq 1

    // 3. Now let the deferred timer fire — the listener's call, seq 2.
    await act(flushMacrotasks);
    expect(pendingProfileResolvers).toHaveLength(2); // both calls in flight

    // 4. Resolve the FIRST-invoked call (seq 1, getSession()'s — the one the
    // old code's .finally() was attached to) while the second (seq 2, still
    // the latest) is left pending. In the old code this call's seq check
    // fails (a later call already superseded it) so it skips setRole — but
    // its .finally() still fires unconditionally, clearing isLoading while
    // role is still null. That's the exact bad window that bounced
    // ProtectedRoute for a real, already-authenticated user.
    await act(async () => {
      pendingProfileResolvers[0]({ data: { id: "user-a", full_name: "Alice", status: "active" } });
      pendingRoleResolvers[0]({ data: [{ role: "admin" }] });
      await flushMacrotasks();
    });

    // 5. Finally resolve the second (latest) call, which actually applies.
    await act(async () => {
      pendingProfileResolvers[1]({ data: { id: "user-a", full_name: "Alice", status: "active" } });
      pendingRoleResolvers[1]({ data: [{ role: "admin" }] });
      await flushMacrotasks();
    });

    await waitFor(() => {
      expect(seen.some((s) => s.role === "admin" && !s.isLoading)).toBe(true);
    });

    // The critical invariant: at no point should a snapshot show
    // isLoading:false with role still null while an authenticated load was
    // in progress — that's exactly the state that bounces ProtectedRoute.
    const badWindow = seen.some((s) => s.isLoading === false && s.role === null);
    expect(badWindow).toBe(false);
  });
});
