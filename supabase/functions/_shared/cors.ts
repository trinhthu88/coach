// Restricts Access-Control-Allow-Origin to known app origins instead of "*".
// These functions are auth-gated internally — this is defense in depth, not the auth boundary.
//
// Configure via the ALLOWED_ORIGIN env var (Supabase Dashboard -> Edge Functions -> Secrets):
// a comma-separated list of origins, entries may use "*" as a wildcard segment
// (e.g. "https://clariva.club,https://www.clariva.club,https://*.pike.replit.dev")
// to cover Replit's rotating preview subdomain during local/preview development.

const DEFAULT_ALLOWED_ORIGINS = "https://clariva.club,https://www.clariva.club";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGIN") ?? DEFAULT_ALLOWED_ORIGINS)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? c : `\\${c}`));
}

function matchesOrigin(origin: string, pattern: string): boolean {
  if (pattern === origin) return true;
  if (!pattern.includes("*")) return false;
  const regex = new RegExp(`^${escapeRegExp(pattern).replace(/\\\*/g, ".*")}$`);
  return regex.test(origin);
}

/**
 * Builds CORS response headers for a given request, echoing back the request's
 * Origin only if it matches an allowed origin/pattern; otherwise falls back to
 * the first configured allowed origin (so the header is never "*").
 */
export function buildCorsHeaders(
  req: Request,
  extra: Record<string, string> = {},
): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowOrigin = allowedOrigins.some((pattern) => matchesOrigin(origin, pattern))
    ? origin
    : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    ...extra,
  };
}
