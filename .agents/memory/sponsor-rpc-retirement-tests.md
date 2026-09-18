---
name: Sponsor RPC retirement tests
description: Durable testing rule for Sponsor reporting migrations that retire legacy RPCs.
---

When a Sponsor reporting migration intentionally drops legacy RPCs, live isolation tests must call the canonical replacement RPCs and preserve equivalent privacy, organisation-boundary, and anonymous-access assertions.

**Why:** A clean migration replay exposed a stale integration test only after the retirement migration removed the old function; frontend tests and static migration checks did not cover the live RPC caller.

**How to apply:** Whenever Sponsor RPCs are renamed or retired, search `supabase/tests` and live Node integration tests for the old names, then update the tests in the same change as the migration.