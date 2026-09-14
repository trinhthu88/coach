---
name: Supabase Auth schema failure
description: Environment-specific failure where the database contains auth users but GoTrue cannot load or authenticate them.
---

If `/auth/v1/admin/users/{id}` and `/auth/v1/token?grant_type=password` both return HTTP 500 database schema errors with valid project credentials, inspect Auth logs before changing credentials. Direct SQL-provisioned users can leave token fields such as `confirmation_token` or `email_change` as `NULL`; GoTrue then fails scanning the whole user row. Normalize nullable Auth token fields to empty strings and missing metadata JSON to `{}` before retrying.

**Why:** SQL access through the Supabase database path and the GoTrue Auth service can fail independently. The Auth logs identify the exact scan column, and repeated password rotations do not repair malformed Auth rows.

**How to apply:** Verify with both anon and service credentials, preserve user IDs and linked data, repair all affected rows idempotently, then confirm zero remaining NULL token/meta fields, Admin API 200 responses, and a successful password-token session.