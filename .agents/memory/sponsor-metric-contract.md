---
name: Sponsor metric contract
description: Durable definitions for enrollment-grain Sponsor reporting and aggregation.
---

Sponsor reporting uses one enrollment-grain metric source for leader, cohort, and organization views. Full completion covers all required programme units; session counts cover only coaching, mentoring, peer coaching, and triad units. Goal setup is the existence of a non-cancelled goal, goal count is the number of goals, and goal progress is a separate rated-goal percentage.

Not-yet-due enrollments are `not_assessed`, have no on-track value, and are excluded from the on-track denominator. On-track counts include only currently assessable active/at-risk enrollments whose completed pace is on-track or ahead. Missing percentage denominators return `NULL`; the UI preserves that as an em dash.

**Why:** Earlier Sponsor RPCs mixed programme units with sessions, counted not-yet-due leaders in on-track percentages, and duplicated aggregation formulas, so leader, cohort, and organization values could disagree.

**How to apply:** Add future Sponsor metrics to the canonical enrollment-grain function first, then aggregate from it. Keep the fixed demo scenario assertions and organization/cohort/leader reconciliation test passing.