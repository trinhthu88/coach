---
name: Local Supabase health failure
description: Environment-specific blocker that prevents the clean database validation gate from reaching project migrations.
---

The local Supabase database container can accept PostgreSQL connections while the Supabase CLI still reports it as unhealthy because Docker cannot execute the container health check.

**Why:** Repeated clean-reset attempts stopped before project migrations with an unhealthy-container error; lower-level Docker diagnostics reported an OCI `setns` execution failure. Manually applying migrations against the partially started stack is not equivalent because required Supabase schemas and services may be absent.

**How to apply:** Treat `npm run validate:db` as blocked until the local container health check works in a Docker-capable environment. Do not substitute partial/manual migration application for the required clean reset, pgTAP, signed-client isolation, seed idempotency, type comparison, lint, tests, and build gate.