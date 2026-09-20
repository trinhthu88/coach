---
name: Sponsor live RPC contract
description: Hosted Sponsor reporting keeps legacy summaries and now exposes additive canonical module rollups, enrollment progress, and configured journey checkpoints.
---

The hosted Sponsor contract keeps the existing cohort and organisation summaries for privacy-scoped metadata, legacy category counts, dates, health/pace metrics, and enrollment totals. The forward-only canonical contract now also provides Sponsor-authorized enrollment progress, five-module cohort rollups including Training, organisation rollups, stored/effective status, and configured programme journey checkpoints.

**Why:** Local Sponsor migrations can make generated TypeScript appear richer than the deployed database. The additive hosted contract is now the authoritative source for module and journey fields while preserving existing RPC behavior.

**How to apply:** Use canonical enrollment, cohort, and organisation RPC results for all progress denominators and numerators; merge legacy summaries only for supporting metadata such as goals or satisfaction. Keep journey rendering date/checkpoint driven, preserve existing RPCs, and keep suppressed cohorts detail-free.