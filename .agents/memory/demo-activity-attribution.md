---
name: Demo activity attribution
description: Pre-trigger demo activity needs an ownership-safe cadence attribution backfill before progress metrics can consume it.
---

The canonical progress calculation intentionally consumes only immutable activity-attribution rows. Demo sessions and training activity created before those triggers exist will appear in source tables but contribute zero completed or booked units until they are backfilled through the existing attribution function.

**Why:** This preserves historical ownership and privacy boundaries; directly changing progress totals or restoring legacy activity unions would make sponsor reporting inconsistent with the production contract.

**How to apply:** For the fixed demo organization only, use a guarded forward-only migration that calls the existing attribution function for each owned source activity. Never infer ownership from a person’s history or backfill customer organizations.