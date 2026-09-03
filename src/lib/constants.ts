/**
 * Last-resort fallback for a monthly/lifetime session cap when no personal
 * override AND no global-default row exists for the relevant limit table
 * (`session_limits`, `coach_session_limits`). Must stay in sync with the
 * hardcoded `4` at the end of the Postgres COALESCE chains in
 * `enforce_session_completion_limit()`, `enforce_coach_as_coachee_limit()`,
 * and `get_coach_peer_session_usage()` (see RULES.md §4) — this constant
 * exists so the frontend's display-only fallback can't silently drift from
 * what the database actually enforces.
 */
export const DEFAULT_SESSION_LIMIT = 4;
