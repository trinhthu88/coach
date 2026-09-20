---
name: Deployment 2 retirement hardening
description: Archive conflict and dependency rules for the staged Triad legacy retirement candidate.
---

Exact archive conflicts must stop the retirement: current-field projections require the Deployment 2 migration ID, while an exact pre-existing full-row snapshot for a round table may retain its earlier migration provenance. Any payload mismatch remains fatal.

**Why:** The round tables were already archived by the canonical cutover, so overwriting their provenance would lose historical ownership of the snapshot; silently accepting changed payloads would make destructive cleanup unsafe.

**How to apply:** Keep the candidate outside `supabase/migrations/` until separate isolated rehearsal, re-audit, and explicit approval. Treat indexes and constraints attached directly to retired columns/tables as expected auto-drops; all other dependencies must fail closed.