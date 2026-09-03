import type { TFunction } from "i18next";

type KnownErrorCode = "23505" | "23503" | "42501";

interface FriendlyErrorOptions {
  /** Per-call, already-translated overrides for specific Postgres error codes (e.g. a booking-specific "that slot was just taken" message). */
  codes?: Partial<Record<KnownErrorCode, string>>;
  /** Already-translated fallback to use instead of the generic "something went wrong" copy. */
  fallback?: string;
}

function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Turns a Supabase/Postgres error into copy that's safe to show a user —
 * never the raw driver message (`error.message` can leak table/column/constraint
 * names). Always logs the original error to the console for debugging.
 *
 * `t` can be any react-i18next TFunction — this always reads from the shared
 * "common" namespace internally, regardless of the caller's default namespace.
 */
export function getFriendlyErrorMessage(
  error: unknown,
  t: TFunction,
  options: FriendlyErrorOptions = {}
): string {
  console.error(error);

  const code = getErrorCode(error);
  if (code && options.codes?.[code as KnownErrorCode]) {
    return options.codes[code as KnownErrorCode]!;
  }
  if (code === "23505") return t("errors.duplicate", { ns: "common" });
  if (code === "23503") return t("errors.foreignKeyViolation", { ns: "common" });
  if (code === "42501") return t("errors.permissionDenied", { ns: "common" });

  return options.fallback ?? t("errors.generic", { ns: "common" });
}

/**
 * supabase.functions.invoke() does not parse the JSON body into `data` on a non-2xx
 * response — the structured error an edge function returns only lives on
 * `error.context` (the raw Response). Without this, every edge-function error
 * collapses to a generic "Edge Function returned a non-2xx status code".
 */
export async function extractFunctionError(error: unknown): Promise<Error> {
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === "function") {
    const body = (await context.json().catch(() => null)) as { error?: string } | null;
    if (body?.error) return new Error(body.error);
  }
  return error instanceof Error ? error : new Error("Request failed");
}
