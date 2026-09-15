---
name: Supabase CLI package firewall
description: Environment limitation encountered when local database validation needs the Supabase CLI.
---

The local database validation script may fail before Supabase starts if the requested CLI archive is rejected by the package firewall. This is distinct from a migration or schema failure.

**Why:** The validation command depends on downloading a pinned CLI package, and the workspace firewall can deny that archive independently of the project code.

**How to apply:** Preserve the exact package-firewall error in the validation report, do not reinterpret it as a database failure, and rerun the same validation when an approved CLI binary or package path is available.