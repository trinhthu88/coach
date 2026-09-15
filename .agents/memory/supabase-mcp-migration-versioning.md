---
name: Supabase MCP migration versioning
description: The supported Supabase MCP migration apply workflow may record a fresh current timestamp rather than the requested migration filename version.
---

Do not treat a successful Supabase MCP migration application as proof that the requested migration version was recorded. Verify the production migration ledger immediately afterward and stop if the recorded version differs from the intended filename.

**Why:** The apply workflow can execute the SQL successfully while assigning a new timestamp-based version, which breaks rollout gates that require exact historical migration versions and makes reapplying the same SQL unsafe.

**How to apply:** Use the supported workflow only, never manually edit `schema_migrations`, and resolve the version-preservation issue before retrying or smoke-testing a rollout whose exact versions are required.