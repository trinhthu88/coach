---
name: Historical ownership retirement
description: Safe handling of historical activity that cannot be assigned to one enrollment.
---

When production evidence cannot prove one enrollment, retain the original legacy row and record an explicit retirement decision with the record ID, domain, parent/source IDs, reason, evidence, timestamp, and migration identifier. Readiness views and repeatable backfills must ignore retired records without weakening enrollment validation.

**Why:** Some historical activity predates every valid enrollment or conflicts with stored participant/cohort relationships. Guessing ownership would create false programme history; deleting the source row would destroy auditability.

**How to apply:** Produce the evidence report before changes, retire only records that meet the documented criteria, verify original rows remain, rerun backfills to confirm zero re-imports, and require zero unresolved records before final enforcement.