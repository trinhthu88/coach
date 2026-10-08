import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { useCoachDeliveredSessions } from "../useCoachDeliveredSessions";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ROOT = join(__dirname, "../../../..");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Audit H3: the Coach directory shows held Coaching from SQL, never coach_profiles.sessions_completed. */
describe("Coach held sessions (coach_public_delivered_sessions)", () => {
  it("reads the Coach's count from the server", async () => {
    rpc.mockResolvedValueOnce({ data: [{ coach_id: "k", delivered_sessions: 7 }, { coach_id: "x", delivered_sessions: 2 }], error: null });
    const { result } = renderHook(() => useCoachDeliveredSessions("k"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.deliveredSessions).toBe(7));
    expect(rpc).toHaveBeenCalledWith("coach_public_delivered_sessions");
  });

  it("a Coach with no held Coaching has 0, not a guess", async () => {
    rpc.mockResolvedValueOnce({ data: [{ coach_id: "x", delivered_sessions: 2 }], error: null });
    const { result } = renderHook(() => useCoachDeliveredSessions("k"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.deliveredSessions).toBe(0));
  });

  it("a failed read is unknown (null), never 0", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    const { result } = renderHook(() => useCoachDeliveredSessions("k"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.deliveredSessions).toBeNull();
  });

  it("no app code reads coach_profiles.sessions_completed (dropped in 20261008200000)", () => {
    const offenders = sources(join(ROOT, "src"))
      .filter((path) => !path.endsWith(join("integrations", "supabase", "types.ts")))
      .filter((path) => readFileSync(path, "utf8").includes("sessions_completed"))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });

  it("the Coach profile and booking pages show the server count", () => {
    for (const page of ["src/pages/CoachDetail.tsx", "src/pages/BookSession.tsx"]) {
      expect(readFileSync(join(ROOT, page), "utf8"), page).toMatch(/useCoachDeliveredSessions\(/);
    }
  });
});
