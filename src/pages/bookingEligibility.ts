/**
 * Booking-eligibility gate for the "Confirm Booking" button in BookSession.tsx.
 *
 * `isOverSessionLimit` is display-only now (drives the "X of Y sessions used"
 * banner) — the real limit + allowlist gate is `public.can_book_session()` in
 * supabase/migrations/20260810150000_can_book_session_rpc.sql, called via the
 * `check_can_book_session` RPC and passed in as `eligible`. That single DB
 * function is also what the `sessions` INSERT RLS policies call, so the
 * frontend no longer keeps its own copy of the allowlist/limit rule — it just
 * asks the DB whether booking is allowed and reflects the answer.
 */
export function isOverSessionLimit(usage: { monthly_limit: number | null; used_this_month: number } | null): boolean {
  if (!usage || usage.monthly_limit === null) return false; // null = unlimited
  return usage.used_this_month >= usage.monthly_limit;
}

export function canSubmitBooking(opts: {
  selectedDate: unknown;
  selectedStart: string | null;
  topic: string;
  eligible: boolean | null;
}): boolean {
  return (
    !!opts.selectedDate &&
    !!opts.selectedStart &&
    opts.topic.trim().length > 0 &&
    opts.eligible !== false
  );
}
