# Clariva live demo operations

The live demo is a separate, production-safe subsystem. It is not the local
`supabase/seed.sql` fixture and must not be initialized with `supabase db reset`.

## Fixed manifest

- Organization: **Clariva Demo Organization**
- Registry slug: `clariva-demo-organization`
- Fixture version: `clariva-live-demo-v1`
- Programmes/cohorts: A 8 active, B 10 active, C 12 active, D 10 completed
- Fictional leaders: 40 total
- Prospect logins: two learners, one coach, one sponsor

The manifest is code-reviewed and versioned in
`supabase/functions/demo-admin/manifest.ts`. It contains no passwords or
credentials.

## Safety gates

1. Apply the registry migration without seeding an organization or Auth user.
2. Configure `DEMO_ORGANIZATION_ID` only for the exact target Supabase
   deployment/database. The value is never accepted from the browser for reset.
3. Provision dedicated Auth identities and fixture rows through the separate
   server-side provisioning operation. Existing email/name matches must abort;
   never adopt a real identity.
4. Record every organization/resource/account in the registry before enabling
   prospect access.
5. Enable reset only after the full dependency closure and sponsor privacy
   assertions pass in an isolated database containing non-demo sentinel data.

The current `demo-admin` function exposes authenticated admin status and the
reviewed manifest. Reset deliberately returns a fail-closed `501` until the
server-side fixture executor is enabled. It does not delete, truncate, or
repair any data.

## Reset contract

The eventual executor must use the registry, resource ownership ledger,
operation idempotency key, generation, and organization-scoped lock. It must
restore only registry-owned baseline rows, preserve the four Auth identities,
and abort before writes on any cross-organization reference or unknown
dependency. Sponsor views and exports must continue to use their existing
privacy contracts.