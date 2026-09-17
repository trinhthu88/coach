---
name: Supabase generated type parity
description: Exact behavior of the repository's generated Supabase TypeScript type check
---

The generated Supabase TypeScript file must match the schema generator's output exactly. The generator orders RPCs alphabetically and infers TypeScript nullability from the replayed database schema, which may differ from the nullability of values returned at runtime.

**Why:** A migration can pass every database test while CI still fails if the checked-in type file is hand-adjusted instead of regenerated from the replayed schema.

**How to apply:** After changing RPC signatures or return tables, regenerate types against the same replayed schema and commit the exact output, including ordering and nullability changes.