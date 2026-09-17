---
name: Sponsor leader detail runtime
description: Runtime and UI handling for enrollment-scoped Sponsor leader detail requests.
---

Leader detail must verify that the Supabase client has a session before issuing Sponsor-only RPCs. If an authenticated request returns an authorization error, refresh the session once before surfacing the failure. The UI must keep RPC/transport failures separate from a legitimate zero-row, privacy-safe result and provide a retry action.

**Why:** The live enrollment-scoped RPCs can resolve correctly under Sponsor claims while a Replit preview browser silently sends the same request as `anon`, producing `42501` or `TypeError: Failed to fetch`. Treating that as “not found” hides the real cause.

**How to apply:** Keep the selected cohort ID in the metadata request, log request IDs and RPC errors without exposing private data, and never add a fallback row when the session or RPC is unavailable.