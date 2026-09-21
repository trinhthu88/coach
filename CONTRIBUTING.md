# Contributing

## Branches and deployment

**`main` is the only deployment branch. All other branches are feature branches and are deleted after merge.**

- Work on a short-lived feature branch (`fix/…`, `feat/…`, `remediation/…`) and merge it into `main` through a pull request.
- Delete the branch (locally and on `origin`) once it is merged. Before deleting a branch whose history was squashed or rebased into `main`, keep its tip as an `archive/<branch>` tag so nothing is lost.
- Deploy only from `main`:
  - **Supabase:** apply migrations (`supabase/migrations/`) from a `main` checkout only.
  - **Replit Deployments** build whatever is checked out in the workspace, so switch the workspace to `main` before pressing Deploy.
  - Lovable / other hosts must not push to `origin` or deploy from another branch.

## Architecture rules

Every change must satisfy the rules in `docs/architecture/source-of-truth.md` (one source per number, enrollment-scoped activity, requirement attribution, sponsor isolation by `programme_enrollments.organization_id`, no fabricated values, one setup-link onboarding pattern, the canonical progress chain). The guard tests under `src/test/` and `supabase/tests/` enforce them.

## Before you push

```bash
npm test                                   # vitest
npx tsc -p tsconfig.app.json --noEmit      # typecheck
npx eslint .                               # no lint errors
```

Database changes: add a new migration (never edit an applied one), register it in `scripts/repo-migrations.txt` and the two manifests in `scripts/` (`ledger/full-ledger-audit.sql`, `triad-cutover-readiness.sql`), add or extend a pgTAP suite in `supabase/tests/`, then regenerate `src/integrations/supabase/types.ts`.
