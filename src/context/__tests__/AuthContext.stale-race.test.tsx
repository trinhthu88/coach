/**
 * Regression test: stale cross-account auth race.
 *
 * Scenario: user A signs in, their profile/role fetch is slow.
 * Before it resolves, user B signs in (different role).
 * A's fetch resolves AFTER B's transition.
 *
 * Expected: A's profile/role must never appear once B is the active session.
 */

import { render, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { ReactNode, useEffect, useRef } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";

// ─── Supabase mock ───────────────────────────────────────────────────────────

type AuthCallback = (event: string, session: unknown) => void;

let capturedAuthCallback: AuthCallback | null = null;
const mockUnsubscribe = vi.fn();

/** Holds a promise resolver per table per call order. */
const pendingProfileResolvers: Array<(v: unknown) => void> = [];
const pendingRoleResolvers: Array<(v: unknown) => void> = [];

/** Build the chainable Supabase mock for a given table. */
function makeChain(table: string): unknown {
  let resolver!: (v: unknown) => void;
  const p = new Promise((res) => { resolver = res; });

  if (table === "profiles") {
    pendingProfileResolvers.push(resolver);
  } else {
    pendingRoleResolvers.push(resolver);
  }

  const methods = ["select", "eq", "order", "limit", "in", "or"];

  function chain(): unknown {
    const obj: Record<string, unknown> = {};
    for (const m of methods) {
      obj[m] = () => chain();
    }
    // Terminal: maybeSingle returns the controlled promise
    obj["maybeSingle"] = () => p;
    // Make the chain itself thenable so `.then` on it works (for implicit await)
    obj["then"] = (
      onfulfilled: (v: unknown) => unknown,
      onrejected: (e: unknown) => unknown
    ) => p.then(onfulfilled, onrejected);
    return obj;
  }
  return chain();
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        capturedAuthCallback = cb;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      },
      getSession: () => Promise.resolve({ data: { session: null } }),
      signOut: vi.fn(),
    },
    from: (table: string) => makeChain(table),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(userId: string) {
  return { user: { id: userId } };
}

/** Flush the macrotask queue (setTimeout 0) without fake timers. */
const flushMacrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

type Snapshot = { role: string | null; name: string | null };

/**
 * Renders AuthProvider and exposes:
 * - `seen`: array of snapshots recorded on every CHANGE in role or name
 * - `current`: always reflects the LATEST rendered values (even if unchanged)
 */
function renderAuthConsumer() {
  const seen: Snapshot[] = [];
  // Holds the latest values even when they haven't changed from the previous render
  const current: Snapshot = { role: undefined as unknown as null, name: undefined as unknown as null };

  function Consumer() {
    const { role, profile } = useAuth();
    const name = (profile as { full_name?: string } | null)?.full_name ?? null;
    const snapRef = useRef<Snapshot>({ role, name });

    useEffect(() => {
      const entry: Snapshot = { role, name };
      // Always track latest
      current.role = role;
      current.name = name;
      // Only push to `seen` when values actually change
      if (entry.role !== snapRef.current.role || entry.name !== snapRef.current.name) {
        snapRef.current = entry;
        seen.push(entry);
      }
    });

    return null;
  }

  render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>
  );

  return { seen, current };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AuthContext – stale cross-account race prevention", () => {
  beforeEach(() => {
    capturedAuthCallback = null;
    pendingProfileResolvers.length = 0;
    pendingRoleResolvers.length = 0;
    mockUnsubscribe.mockClear();
  });

  it("discards account A profile/role when B signs in before A resolves", async () => {
    const { seen, current } = renderAuthConsumer();

    // 1. User A signs in — fetch is initiated but NOT resolved
    act(() => { capturedAuthCallback!("SIGNED_IN", makeSession("user-a")); });
    // Flush the setTimeout(0) that schedules A's load
    await act(flushMacrotasks);

    expect(pendingProfileResolvers).toHaveLength(1); // A's query pending

    // 2. User B signs in BEFORE A's queries resolve
    act(() => { capturedAuthCallback!("SIGNED_IN", makeSession("user-b")); });
    // Flush B's load timer
    await act(flushMacrotasks);

    expect(pendingProfileResolvers).toHaveLength(2); // A and B both pending

    // 3. Resolve A's query with admin data (A is superseded by B)
    await act(async () => {
      pendingProfileResolvers[0]({ data: { id: "user-a", full_name: "Alice Admin", status: "active" } });
      pendingRoleResolvers[0]({ data: [{ role: "admin" }] });
      await flushMacrotasks();
    });

    // 4. Resolve B's query with coachee data
    await act(async () => {
      pendingProfileResolvers[1]({ data: { id: "user-b", full_name: "Bob Coachee", status: "active" } });
      pendingRoleResolvers[1]({ data: [{ role: "coachee" }] });
      await flushMacrotasks();
    });

    // Wait for React to render B's state
    await waitFor(() => {
      expect(current.name).toBe("Bob Coachee");
    });

    // A's admin role/name must never have appeared in any recorded snapshot
    const aliceLeaked = seen.some((e) => e.name === "Alice Admin" || e.role === "admin");
    expect(aliceLeaked).toBe(false);

    // Final state: Bob Coachee
    expect(current.name).toBe("Bob Coachee");
    expect(current.role).toBe("coachee");
  });

  it("clears profile and role synchronously when a new authenticated session is detected", async () => {
    const { seen, current } = renderAuthConsumer();

    // 1. User A signs in and their data resolves
    act(() => { capturedAuthCallback!("SIGNED_IN", makeSession("user-a")); });
    await act(flushMacrotasks); // flush A's setTimeout

    await act(async () => {
      pendingProfileResolvers[0]({ data: { id: "user-a", full_name: "Alice Admin", status: "active" } });
      pendingRoleResolvers[0]({ data: [{ role: "admin" }] });
      await flushMacrotasks();
    });

    // Confirm A's data is visible
    await waitFor(() => { expect(current.role).toBe("admin"); });

    // 2. B signs in — but do NOT resolve B's fetch
    act(() => { capturedAuthCallback!("SIGNED_IN", makeSession("user-b")); });

    // After the synchronous part of the auth callback, profile/role must be
    // immediately cleared — the generation bump and state clear happen before
    // the deferred setTimeout fires.
    await act(flushMacrotasks); // let React commit the synchronous state update

    // Before B's fetch resolves, state must be null
    expect(current.role).toBeNull();
    expect(current.name).toBeNull();

    // A's data must not appear again after B's sign-in
    const postBIdx = seen.findIndex((e) => e.role === null && e.name === null && seen.indexOf(e) > 0);
    const afterClear = seen.slice(postBIdx > -1 ? postBIdx : seen.length);
    const aliceReappeared = afterClear.some((e) => e.name === "Alice Admin" || e.role === "admin");
    expect(aliceReappeared).toBe(false);
  });
});
