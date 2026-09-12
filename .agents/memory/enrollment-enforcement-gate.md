---
name: Enrollment enforcement gate
description: Production-safety rule for final enrollment constraints after staged backfills.
---

Do not apply destructive cleanup or final enrollment constraints until every enrollment backfill audit reports zero unresolved rows and the user explicitly approves the production migration. When retained retired rows still have null ownership, use validated retirement-ledger exceptions for those rows; apply physical `NOT NULL` only where no retained exception exists.

**Why:** Historical enrollment ownership and schedule data can be ambiguous or invalid. Silently guessing or enforcing constraints before remediation could corrupt or strand production records.

**How to apply:** Run the admin readiness checks and review retained audit rows first. Keep migrations additive and forward-only until all unresolved records are corrected; then propose the final enforcement migration separately for approval. Preserve retired source rows and make the database reject all new unowned writes through triggers plus validated constraints.