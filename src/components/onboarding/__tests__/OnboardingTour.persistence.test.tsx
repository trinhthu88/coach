import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Scripted responses for the profiles table: each update / read-back pops the
// next entry of its queue (defaulting to a successful write of one row).
const calls = vi.hoisted(() => ({
  update: [] as unknown[],
  filters: [] as unknown[][],
  refresh: vi.fn(),
  updates: [] as Array<{ data: unknown[] | null; error: { message: string } | null }>,
  reads: [] as Array<{ data: { onboarding_completed_at: string | null } | null; error: { message: string } | null }>,
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (values: unknown) => {
        calls.update.push(values);
        const chain = {
          eq: (...args: unknown[]) => (calls.filters.push(["eq", ...args]), chain),
          is: (...args: unknown[]) => (calls.filters.push(["is", ...args]), chain),
          select: () => Promise.resolve(calls.updates.shift() ?? { data: [{ id: "u1" }], error: null }),
        };
        return chain;
      },
      select: () => {
        const chain = {
          eq: () => chain,
          maybeSingle: () => Promise.resolve(calls.reads.shift() ?? { data: null, error: null }),
        };
        return chain;
      },
    }),
  },
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, refreshProfile: calls.refresh }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: calls.toastError } }));
vi.mock("../IntroCarousel", () => ({
  IntroCarousel: ({ onSkip, onFinish }: { onSkip: () => void; onFinish: () => void }) => (
    <div>
      <button onClick={onSkip}>close intro</button>
      <button onClick={onFinish}>finish intro</button>
    </div>
  ),
}));
vi.mock("../PointerTour", () => ({
  PointerTour: ({ onDismiss }: { onDismiss: () => void }) => <button onClick={onDismiss}>dismiss pointer</button>,
}));
vi.mock("../OnboardingDoneToast", () => ({ OnboardingDoneToast: () => null }));

import "@/i18n/config";
import { OnboardingTour } from "../OnboardingTour";
import { persistOnboardingCompletion } from "@/lib/onboarding/persistCompletion";

const noSleep = () => Promise.resolve();
const failure = (message: string) => ({ data: null, error: { message } });

beforeEach(() => {
  calls.update = [];
  calls.filters = [];
  calls.refresh.mockReset();
  calls.updates = [];
  calls.reads = [];
  calls.toastError.mockReset();
});

describe("OnboardingTour persistence", () => {
  it("records completion in profiles as soon as the intro is dismissed — not only at the end of the pointer tour", async () => {
    render(<OnboardingTour role="coachee" />);
    fireEvent.click(screen.getByText("close intro"));
    await waitFor(() => expect(calls.refresh).toHaveBeenCalledTimes(1));
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0]).toEqual({ onboarding_completed_at: expect.any(String) });
    expect(calls.filters).toEqual([["eq", "id", "u1"], ["is", "onboarding_completed_at", null]]);
  });

  it("writes the flag once even when the user then dismisses the pointer tour", async () => {
    render(<OnboardingTour role="sponsor" />);
    fireEvent.click(screen.getByText("finish intro"));
    fireEvent.click(await screen.findByText("dismiss pointer"));
    await waitFor(() => expect(calls.refresh).toHaveBeenCalled());
    expect(calls.update).toHaveLength(1);
  });

  it("tells the user when the flag still cannot be saved after retrying, and tries again on the next step", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      calls.updates = [failure("network"), failure("network"), failure("network")];
      render(<OnboardingTour role="coachee" />);
      fireEvent.click(screen.getByText("finish intro"));
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(calls.toastError).toHaveBeenCalledTimes(1));
      expect(calls.update).toHaveLength(3);
      expect(calls.refresh).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByText("dismiss pointer"));
      await waitFor(() => expect(calls.refresh).toHaveBeenCalledTimes(1));
      expect(calls.update).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("persistOnboardingCompletion", () => {
  it("retries a failed save by itself, so a failure on the final step is not left for the next login", async () => {
    calls.updates = [failure("network")];
    await expect(persistOnboardingCompletion("u1", { sleep: noSleep })).resolves.toEqual({ ok: true });
    expect(calls.update).toHaveLength(2);
  });

  it("reports the error once every attempt has failed", async () => {
    calls.updates = [failure("a"), failure("b"), failure("c")];
    await expect(persistOnboardingCompletion("u1", { sleep: noSleep })).resolves.toEqual({ ok: false, error: "c" });
  });

  it("accepts an update that matched no row only when the flag is already set (a replay)", async () => {
    calls.updates = [{ data: [], error: null }];
    calls.reads = [{ data: { onboarding_completed_at: "2026-09-01T00:00:00Z" }, error: null }];
    await expect(persistOnboardingCompletion("u1", { sleep: noSleep })).resolves.toEqual({ ok: true });
  });

  it("treats a silent no-op write (no row updated, flag still unset) as a failure, not success", async () => {
    calls.updates = [{ data: [], error: null }, { data: [], error: null }];
    calls.reads = [{ data: { onboarding_completed_at: null }, error: null }, { data: { onboarding_completed_at: null }, error: null }];
    const result = await persistOnboardingCompletion("u1", { sleep: noSleep, attempts: 2 });
    expect(result.ok).toBe(false);
  });
});
