---
name: Enrollment enforcement gate
description: Production-safety rule for final enrollment constraints after staged backfills.
---

Do not apply destructive cleanup or final enrollment `NOT NULL` constraints until every enrollment backfill audit reports zero unresolved rows and the user explicitly approves the production migration.

**Why:** Historical enrollment ownership and schedule data can be ambiguous or invalid. Silently guessing or enforcing constraints before remediation could corrupt or strand production records.

**How to apply:** Run the admin readiness checks and review retained audit rows first. Keep migrations additive and forward-only until all unresolved records are corrected; then propose the final enforcement migration separately for approval.