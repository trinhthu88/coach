---
name: Sponsor live RPC contract
description: Hosted Sponsor reporting exposes aggregate legacy metrics and canonical per-enrollment progress, but not module rollups or journey checkpoints.
---

The hosted Sponsor contract provides cohort and organisation aggregates, legacy category completion counts, dates, health/pace metrics, and enrollment totals. Module-level required/completed/due values come from the canonical per-enrollment progress function; hosted Sponsor summaries do not currently expose Training-specific rollups, stored enrollment status, or journey checkpoints.

**Why:** Local Sponsor migrations can make generated TypeScript appear richer than the deployed database. Rendering those undeployed fields produces blank or misleading Sponsor numbers.

**How to apply:** Treat hosted RPC signatures as authoritative. Use sponsor summaries for privacy-scoped metadata and aggregates, enrich visible roster rows from canonical enrollment progress when needed, and show an explicit unavailable state rather than infer weeks or checkpoints. Additive hosted fields must preserve existing RPCs and suppression thresholds.