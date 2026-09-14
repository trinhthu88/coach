---
name: Supabase Auth schema failure
description: Environment-specific failure where the database contains auth users but GoTrue cannot load or authenticate them.
---

If `/auth/v1/admin/users/{id}` and `/auth/v1/token?grant_type=password` both return HTTP 500 database schema errors with valid project credentials, treat the issue as a managed Supabase Auth service/database problem, not as a bad password or app role. A direct `auth.users.encrypted_password` update may succeed but does not restore login while GoTrue cannot query its schema.

**Why:** SQL access through the Supabase database path and the GoTrue Auth service can fail independently; repeated password rotations do not repair an Auth service that cannot issue sessions.

**How to apply:** Verify with both anon and service credentials, stop repeated credential changes, preserve the account, and escalate/repair the Supabase Auth service before testing app routing again.