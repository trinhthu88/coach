---
name: Supabase CLI validation block
description: Environment-specific limitation affecting local migration and database test validation.
---

Local database validation can fail before Supabase starts because the package
firewall rejects downloading the pinned `supabase` npm package as blocked
content. This is distinct from a migration or database failure.

**Why:** The repository validation script obtains the CLI through `npx`; when
the download is denied, no migration, database test, or schema comparison has
run.

**How to apply:** Report the package-download failure separately from code
validation results. The presence of a local PostgreSQL port or client does not
prove the migration stack ran. Do not claim database validation passed, and do
not change the migration or dependency solely to work around the environment
restriction.