import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "learner-1" }, role: "coachee" }) }));
vi.mock("@/hooks/useActiveEnrollment", () => ({
  useActiveEnrollment: () => ({ enrollmentId: "enrollment-1", loading: false, error: null }),
}));

import { useProgrammeModules } from "../useProgrammeModules";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const training = (components: string[]) => ({
  module: "training",
  enabled: true,
  config: { required: true, required_units: 4, learning_components: components },
});

async function modulesFor(rows: unknown[]) {
  rpc.mockResolvedValue({ data: rows, error: null });
  const { result } = renderHook(() => useProgrammeModules(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current;
}

describe("useProgrammeModules — a week's Quiz and Daily Prompts follow the Training checklist", () => {
  beforeEach(() => rpc.mockReset());

  it("grants Quiz and Daily Prompts when Training includes them, with no separate modules", async () => {
    const m = await modulesFor([training(["skill_cards", "quizzes", "reflections", "daily_prompts"])]);
    expect(m.hasModule("quiz")).toBe(true);
    expect(m.hasModule("daily_prompt")).toBe(true);
    expect(m.hasModule("training")).toBe(true);
  });

  it("withholds what the checklist leaves out, even if a legacy separate module is on", async () => {
    const m = await modulesFor([
      training(["skill_cards", "reflections"]),
      { module: "quiz", enabled: true, config: {} },
      { module: "daily_prompt", enabled: true, config: {} },
    ]);
    expect(m.hasModule("quiz")).toBe(false);
    expect(m.hasModule("daily_prompt")).toBe(false);
  });

  it("falls back to the separate modules for a programme without Training; other modules are unchanged", async () => {
    const m = await modulesFor([
      { module: "quiz", enabled: true, config: {} },
      { module: "coaching", enabled: true, config: {} },
    ]);
    expect(m.hasModule("quiz")).toBe(true);
    expect(m.hasModule("daily_prompt")).toBe(false);
    expect(m.hasModule("coaching")).toBe(true);
    expect(m.hasModule("mentoring")).toBe(false);
  });
});
