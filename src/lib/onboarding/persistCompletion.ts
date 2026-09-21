import { supabase } from "@/integrations/supabase/client";

export type PersistResult = { ok: true } | { ok: false; error: string };

export interface PersistOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Delay before the 2nd attempt; doubles after each failure. */
  baseDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Records that the user has seen (finished OR dismissed) the onboarding
 * walkthrough: profiles.onboarding_completed_at, the only record of it.
 *
 * Retries on its own with backoff, independent of whether the tour is still
 * mounted (dismissing the last step unmounts it), so a transient failure on
 * the final step is not left for the next login to discover.
 *
 * An update that matches no row is NOT treated as success blindly: the flag
 * may already be set (a replay from "How it works") — fine — or the row was
 * not writable, which is a failure. The row is read back to tell them apart.
 */
export async function persistOnboardingCompletion(userId: string, opts: PersistOptions = {}): Promise<PersistResult> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  const sleep = opts.sleep ?? defaultSleep;
  let lastError = "Unknown error";

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));
    try {
      const { data, error } = await supabase
        .from("profiles")
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq("id", userId)
        .is("onboarding_completed_at", null)
        .select("id");
      if (error) {
        lastError = error.message;
        continue;
      }
      if (data && data.length > 0) return { ok: true };

      const { data: row, error: readError } = await supabase
        .from("profiles")
        .select("onboarding_completed_at")
        .eq("id", userId)
        .maybeSingle();
      if (!readError && row?.onboarding_completed_at) return { ok: true };
      lastError = readError?.message ?? "The walkthrough flag was not saved (no profile row was updated)";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: lastError };
}
