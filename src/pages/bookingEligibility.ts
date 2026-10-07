/**
 * Booking-eligibility gate for the "Confirm Booking" button in BookSession.tsx.
 *
 * `eligible` is the server's answer (check_can_book_session /
 * can_book_peer_session): a free requirement + the cohort pool + the goal gate
 * (20261005130000). The frontend keeps no copy of that rule and no session
 * allowance of its own -- it reflects the answer.
 */
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
