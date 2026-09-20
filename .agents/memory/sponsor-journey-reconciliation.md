---
name: Sponsor journey reconciliation
description: Rules for keeping Sponsor timeline checkpoints aligned with canonical progress.
---

Sponsor journey checkpoints must use the same status-bearing attributed activity source as enrollment progress, with source-table joins scoped by activity type. Cap completed activity per leader and module before aggregating checkpoint totals; aggregate-only caps can let one module inflate another module's scope.

**Why:** A later journey implementation reintroduced peer-coaching double counting and aggregate caps, causing a real journey total of 138 to exceed the canonical cohort total of 114.

**How to apply:** Build checkpoint requirements from configured milestones/training weeks, use checkpoint-date as-of activity for chronological points, and expose actual module scope when Admin provides no explicit checkpoint label. Never render a generic checkpoint label.