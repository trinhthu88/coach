---
name: Local Supabase health failure
description: Environment-specific blocker that prevents the clean database validation gate from reaching project migrations.
---

The local Supabase database container can accept PostgreSQL connections while the Supabase CLI still reports it as unhealthy because Docker cannot execute the container health check. In this environment the OCI `setns` failure occurs specifically once the Supabase Postgres process is running; shell-only probes and Alpine containers can still be exec'd.

**Why:** Repeated clean-reset attempts stopped before project migrations with an unhealthy-container error; lower-level Docker diagnostics reported an OCI `setns` execution failure. A shell-supervised Postgres process can pass Docker health checks, but changing the generated command altered startup behavior and Auth then failed its schema migration, so it is not a validated workaround. An older CLI release used the same Postgres image and reproduced the issue.

**How to apply:** Treat `npm run validate:db` as blocked until the local container health check works in a Docker-capable environment. Do not use `db reset --db-url` or partial/manual migration application as a workaround: a failed health-gated reset can leave the local database without the project or storage schema. Do not substitute this for the required clean reset, pgTAP, signed-client isolation, seed idempotency, type comparison, lint, tests, and build gate. Leave the local stack stopped after an unsuccessful attempt.