---
name: Hosted demo fixture alignment
description: Non-obvious constraints when validating hosted Sponsor and Learner flows against demo data.
---

For live verification, do not assume repository seed email aliases identify the hosted Sponsor or the requested Learners. Resolve the target cohort first, then select the Sponsor profile attached to that cohort's organization and the learner identities attached to the cohort's enrollments.

**Why:** Hosted demo data can come from a different fixture generation history than the current repository seed. A valid Sponsor session may own a different visible cohort, causing authorized leader RPCs to return empty results even while the database and functions are healthy.

**How to apply:** For authenticated smoke checks, use the current hosted cohort/enrollment relationships as the source of truth. Treat missing seed aliases as fixture drift to document, not as proof that the canonical RPC deployment failed.

Legacy hosted Training modules can also have a stored requirement that matches
the visible Skill Card count while omitting `training_week_ids`. The canonical
result is intentionally empty with a requirement mismatch until those children
are made explicit; only repair configurations where the counts match exactly.

**Why:** The child-derived denominator must not silently infer or overwrite
Admin configuration. The hosted partial fixture was valid once its six
existing visible children were explicitly associated with the six-unit module.

**How to apply:** Use an idempotent data migration that fills the missing child
selection only for an exact visible-child/parent-requirement match. Leave
ambiguous modules for Admin validation.