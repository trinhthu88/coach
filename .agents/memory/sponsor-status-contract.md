---
name: Sponsor stored and effective status
description: Sponsor reporting distinguishes the database enrollment status from the sponsor-visible lifecycle status derived from dates and progress.
---

The sponsor-safe enrollment contract should expose both the stored enrollment status and the effective sponsor status. Keep the legacy enrollment_status value aligned with the effective status while consumers migrate to the explicit fields.

**Why:** A stored active enrollment can belong to a programme whose end date has passed. Sponsors need a truthful lifecycle label without losing the underlying enrollment state used by operations and audits.

**How to apply:** Display effective status in sponsor-facing lists and attention logic, show stored status separately in leader detail, and derive cohort lifecycle from programme dates rather than aggregate pace.