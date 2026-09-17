---
name: Sponsor RPC authenticated smoke tests
description: Sponsor reporting RPCs require an authenticated sponsor context, so raw SQL row counts are not valid app-behavior checks.
---

Sponsor reporting RPCs can legitimately return zero rows when called through an admin/service SQL session without the requesting sponsor's JWT context.

**Why:** The reporting functions scope data through the authenticated sponsor profile, and direct MCP SQL does not automatically carry the browser's auth claims.

**How to apply:** After a Sponsor schema rollout, verify the migration ledger and function signatures with SQL, then validate returned rows through an authenticated Sponsor browser/API session rather than treating an unauthenticated SQL count as evidence that data is missing.