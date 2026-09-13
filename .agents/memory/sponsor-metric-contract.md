---
name: Sponsor metric contract
description: Durable definitions for enrollment-grain Sponsor reporting and aggregation.
---

Sponsor reporting uses one enrollment-grain metric source for leader, cohort, and organization views. Full completion covers all required programme units; session counts cover only coaching, mentoring, peer coaching, and triad units. Goal setup is the existence of a non-cancelled goal, goal count is the number of goals, and goal progress is a separate rated-goal percentage.

Active and at-risk enrollments with nothing due are still `not_assessed`, but are assessable and `on_track = true` because no overdue obligation exists. Paused and completed enrollments keep `on_track = NULL`. Missing percentage denominators return `NULL`; the UI preserves that as an em dash.

Overall satisfaction combines completed numeric coachee ratings from regular coaching, peer/coachee-peer sessions, and triad reflections. Scores are normalized to five points, averaged per enrollment first, then averaged equally across enrollments; response counts remain additive. Qualitative mentoring feedback, coach-private quality ratings, and confidence/goal scales are excluded.

**Why:** Earlier Sponsor RPCs mixed programme units with sessions, treated nothing-due leaders as unassessable, weighted satisfaction by response volume, and duplicated aggregation formulas, so leader, cohort, and organization values could disagree.

**How to apply:** Add future Sponsor metrics to the canonical enrollment-grain function first, then aggregate from it. Keep the fixed demo scenario assertions and organization/cohort/leader reconciliation test passing.