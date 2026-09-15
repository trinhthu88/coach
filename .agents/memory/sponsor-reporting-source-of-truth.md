---
name: Sponsor reporting source of truth
description: Canonical Admin-to-Sponsor rules for programme requirements, training schedules, and historical completion.
---

Sponsor denominators and entitlements must come from the current enabled Admin `programme_modules` configuration, specifically each module's `required_units`. Completion numerators and completed-session totals must come from historical activity/progress for the enrolled leaders without being capped; cap only percentages and remaining booked capacity against the configured requirement. Training-linked modules must use the selected `training_week_ids`, with exactly one selected week per required unit.

**Why:** Enrollment snapshots preserve historical schedule timing, but using them for current sponsor denominators lets stale configuration produce contradictory Admin and Sponsor totals. A separate legacy training-week count also caused the Admin “4 weeks” display to disagree with six actual content weeks and six required units.

**How to apply:** Keep snapshot data for due/expected timing, but join sponsor cohort, roster, and organization rollups to current enabled module configuration for requirements. Remove or ignore legacy standalone training-week fields; validate selected training content against the configured units.