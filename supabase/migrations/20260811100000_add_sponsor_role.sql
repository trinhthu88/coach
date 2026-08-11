-- Adds the 'sponsor' value to app_role. Split into its own migration/transaction
-- because Postgres does not allow a newly added enum value to be referenced
-- within the same transaction that added it.
--
-- NOTE: this is not reversible via a simple down-migration. Removing an enum
-- value requires rebuilding the type (rename, recreate without the value,
-- migrate columns, drop old type) — there is no ALTER TYPE ... DROP VALUE.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sponsor';
