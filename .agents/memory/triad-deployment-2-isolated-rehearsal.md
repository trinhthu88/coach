---
name: Deployment 2 isolated rehearsal
description: Safe local validation approach for the standalone Triad retirement when the Supabase container health gate is unavailable.
---

The Deployment 2 rehearsal can use a purpose-built loopback PostgreSQL fixture to exercise the retirement transaction without touching a hosted project. The fixture must include the retiring tables and columns, intrinsic defaults, indexes, the known legacy-table trigger, the archive privacy boundary, and the canonical structures/functions required by post-verification.

**Why:** The Supabase CLI may stop before project migrations when Docker cannot execute its Postgres health probe, while a standalone PostgreSQL server remains available for deterministic transaction and catalog tests. This validates Deployment 2 behavior but is not a substitute for the full application database validation gate.

**How to apply:** Keep the rehearsal URL loopback-only, restore a clean pre-retirement dump before each case, require rollback fingerprints for every injected failure, and include a negative case proving an external dependency still fails closed.

Production catalog checks should match retired identifiers on token boundaries and verify canonical projection wrappers through their explicit call chain; broad substring checks misclassify live names such as `scheduled_start_time`, `table_name`, and transitive Sponsor summaries.

**Why:** The live PostgreSQL 17 schema exposed legitimate canonical triggers, constraints, demo reset functions, and Sponsor wrappers that a minimal fixture could not model. Boundary-safe scans preserved fail-closed behavior without treating unrelated runtime objects as retired dependencies.

**How to apply:** Use catalog dependencies for authoritative object references, boundary-safe expression scans for dynamic SQL, and an explicit direct/transitive projection chain for post-retirement verification.