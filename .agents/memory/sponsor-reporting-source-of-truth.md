---
name: Sponsor reporting source of truth
description: Canonical Admin-to-Sponsor rules for programme requirements, training schedules, and historical completion.
---

Sponsor denominators and entitlements must come from the current enabled Admin `programme_modules` configuration, specifically each module's `required_units`. Completion numerators and completed-session totals must come from historical activity/progress for the enrolled leaders without being capped; cap only percentages and remaining booked capacity against the configured requirement. Training-linked modules must use the selected `training_week_ids`, with exactly one selected week per required unit.

**Why:** Enrollment snapshots preserve historical schedule timing, but using them for current sponsor denominators lets stale configuration produce contradictory Admin and Sponsor totals. A separate legacy training-week count also caused the Admin “4 weeks” display to disagree with six actual content weeks and six required units.

**How to apply:** Keep snapshot data for due/expected timing, but join sponsor cohort, roster, and organization rollups to current enabled module configuration for requirements. Remove or ignore legacy standalone training-week fields; validate selected training content against the configured units.

Sponsor cohort journeys should be returned as server-generated checkpoints from the current Admin schedule, with activity filtered to modules scheduled by each checkpoint. Client-side date math or distributing aggregate completion across weeks is not a valid substitute.

**Why:** A cohort-level completion total cannot identify which week or checkpoint it belongs to, and counting all activity after the first due checkpoint makes the timeline look complete before the configured programme milestones are due.

**How to apply:** Add checkpoint data to the sponsor-safe reporting contract and render only aggregate units/leaders per checkpoint; keep private activity content and goal wording out of the response.

Hosted-data audits must verify the live migration ledger and cohort identifiers before comparing reports; the working-tree seed and migration set can be ahead of the connected database.

**Why:** The live Clariva database used a different punctuation variant for the same cohort label and did not yet contain the newer source-of-truth migrations, while its independent completed activity still reconciled to the sponsor total.

**How to apply:** Resolve the actual live cohort and enrollment IDs first, derive completion from status-bearing source records, and treat attribution rows as evidence that still requires duplicate/status review rather than as automatically unique completions.