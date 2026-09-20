---
name: Sponsor aggregation population
description: How organization-level Sponsor Dashboard counts must align with cohort summaries without weakening privacy suppression.
---

Organization-level sponsor counts must use the sponsor-visible cohort-size population, including below-threshold cohorts as suppressed aggregate rows. Detailed organization metrics must continue to aggregate only threshold-eligible metric rows, and zero required-unit totals must remain numeric zero when the cohort summary exposes zero.

**Why:** Separate lifecycle and privacy-threshold filters caused production organization counts to disagree with the cohort summaries. Removing suppression or exposing enrollment-level data would change the sponsor privacy contract.

**How to apply:** When changing Sponsor Dashboard aggregation, derive cohort and enrollment counts from the same sponsor-scoped cohort list used by cohort summaries; keep detailed metrics on the threshold-aware metric-row path and compare nullable aggregates with the cohort-summary contract.