---
name: Sponsor leader detail runtime
description: Runtime and UI handling for enrollment-scoped Sponsor leader detail requests.
---

Leader detail must verify that the Supabase client has a session before issuing Sponsor-only RPCs. If an authenticated request returns an authorization error, refresh the session once before surfacing the failure. The UI must keep RPC/transport failures separate from a legitimate zero-row, privacy-safe result and provide a retry action.

**Why:** The live enrollment-scoped RPCs can resolve correctly under Sponsor claims while a Replit preview browser silently sends the same request as `anon`, producing `42501` or `TypeError: Failed to fetch`. Treating that as “not found” hides the real cause.

**How to apply:** Keep the selected cohort ID in the metadata request, log request IDs and RPC errors without exposing private data, and never add a fallback row when the session or RPC is unavailable.

Optional Leader Detail enrichment must not re-run the full canonical progress engine alongside the required metadata and checkpoint RPCs. Authorize the enrollment directly for configured learning counts and future booking data; use canonical metadata as the fallback source for coaching allocation and completion.

**Why:** The original experience query timed out under normal browser load because it duplicated progress/activity work and competed with the required enrollment-scoped RPCs, even though the same data completed in isolation.

**How to apply:** Keep experience enrichment bounded and privacy-safe. If it is unavailable, the drawer must still render canonical progress, checkpoint participation, and coaching counts rather than converting them to empty values.