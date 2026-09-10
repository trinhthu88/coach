# Enrollment Context and Conflict Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new administrator-created enrollment use the validated enrollment RPC, preserve ongoing enrollments unchanged on conflict, and provide an explicit enrollment selection context including history.

**Architecture:** A typed enrollment service owns database reads, RPC invocation, conflict parsing, and stable enrollment-specific query-key builders. Admin editors use that service instead of direct inserts or automatic status changes. The admin list presents the ongoing record and a review route/action rather than replacing it.

**Tech Stack:** React 18, TypeScript, TanStack Query, Supabase JS, Vitest, pgTAP.

**Spec:** User-approved Phase 2 scope in this conversation, based on the enrollment architecture audit.

## Global Constraints

- Work only on `feature/enrollment-scoped-foundation` with a clean starting tree.
- Do not change `20260910150000_enrollment_scoped_core.sql`.
- Do not attach activity validators, backfill activity, redesign sponsor reporting, modify goals/actions, or replace demo data.
- Preserve platform-admin and sponsor-organization behavior; do not add an organization-admin role.
- Never automatically complete, cancel, update, or delete an ongoing enrollment to make room for another.
- Every new application enrollment must call `create_programme_enrollment`.
- Query keys for enrollment-sensitive resources include `enrollment_id`.

---

### Task 1: Typed enrollment domain service

**Files:**
- Create: `src/lib/enrollments.ts`
- Test: `src/lib/__tests__/enrollments.test.ts`

**Interfaces:**
- Produces `Enrollment`, `OngoingEnrollmentConflict`, `parseOngoingEnrollmentConflict`, `isOngoingEnrollment`, `enrollmentQueryKey`, `createProgrammeEnrollment`, and read helpers.
- Consumes `supabase.rpc("create_programme_enrollment")` and `programme_enrollments` rows.

- [ ] **Step 1: Write failing tests** for active/at-risk/paused conflict parsing, completed-history selection, explicit historical selection persistence, and distinct enrollment query keys.
- [ ] **Step 2: Run focused test** with `npm run test -- src/lib/__tests__/enrollments.test.ts`; confirm missing exports fail.
- [ ] **Step 3: Implement the minimal typed service**. Parse only structured `ongoing_enrollment_exists` errors; return ordinary failures unchanged. Query ongoing statuses explicitly and never choose history by `latest` when an ID is supplied.
- [ ] **Step 4: Re-run focused tests** and confirm they pass.

### Task 2: RPC-only administrator enrollment changes

**Files:**
- Modify: `src/lib/enrollmentTransition.ts`
- Modify: `src/hooks/admin/useAdminCoacheeMutations.ts`
- Modify: `src/hooks/admin/useCoacheeProgrammeImport.ts`
- Modify: `src/pages/admin/AdminCoaches.tsx`
- Test: `src/lib/__tests__/enrollmentTransition.test.ts`

**Interfaces:**
- Consumes `createProgrammeEnrollment` from `src/lib/enrollments.ts`.
- Produces typed `EnrollmentCreationResult` including an optional `OngoingEnrollmentConflict`.

- [ ] **Step 1: Write failing tests** demonstrating active, at-risk, paused, and same-programme/new-cohort conflicts do not mutate the existing enrollment; a completed enrollment allows RPC creation; and no automatic completion occurs.
- [ ] **Step 2: Run focused tests** and confirm legacy direct-update/insert behavior fails their expectations.
- [ ] **Step 3: Replace direct frontend inserts and transition updates** with the RPC service. Make a selected existing enrollment immutable from these forms; return its conflict for presentation. Convert imports to individual RPC calls so each failure is accurately reported.
- [ ] **Step 4: Re-run focused tests** and confirm they pass.

### Task 3: Admin conflict presentation and enrollment review context

**Files:**
- Create: `src/hooks/useEnrollmentContext.ts`
- Modify: `src/hooks/admin/useAdminCoacheesData.ts`
- Modify: `src/pages/admin/coachees/CoacheeEditSheet.tsx`
- Modify: `src/pages/admin/AdminCoaches.tsx`
- Modify: `src/App.tsx` only if a dedicated enrollment-review route is required
- Modify: `src/locales/en/admin.json`
- Modify: `src/locales/vi/admin.json`
- Test: `src/hooks/__tests__/useEnrollmentContext.test.ts`
- Test: `src/pages/admin/coachees/__tests__/CoacheeEditSheet.test.tsx`

**Interfaces:**
- `useEnrollmentContext(userId, selectedEnrollmentId?)` returns ongoing and historical records, preserves explicit selection, and exposes enrollment-specific keys.
- Admin UI receives `OngoingEnrollmentConflict` and renders programme, cohort, status, start date, end date, and a review link/action.

- [ ] **Step 1: Write failing tests** for conflict details in the UI and an explicitly selected completed enrollment staying selected when an ongoing enrollment exists.
- [ ] **Step 2: Run focused tests** and confirm the current UI lacks the conflict content and selection behavior.
- [ ] **Step 3: Implement selection and conflict UI**. Review must navigate to an explicit enrollment ID or open an explicit history context; it must not offer replace/close.
- [ ] **Step 4: Re-run focused tests** and confirm they pass.

### Task 4: Database behavior coverage and non-application writers

**Files:**
- Modify: `supabase/tests/enrollment_scope_test.sql`
- Modify: `supabase/functions/seed-tasc-content/index.ts`
- Modify: `supabase/functions/seed-demo-data/index.ts`

**Interfaces:**
- Seed-only administrative callers use the same RPC-compatible semantics or are explicitly identified as no-longer-invoked fixtures without changing seed-data scope.

- [ ] **Step 1: Write failing pgTAP cases** proving all three ongoing statuses conflict, completed enrollment permits creation, and same-programme/new-cohort conflicts.
- [ ] **Step 2: Run local database tests when Docker is healthy**; otherwise retain the failing test evidence and document the Replit Docker limitation.
- [ ] **Step 3: Replace remaining application enrollment creation callers** while preserving seed behavior and no remote execution.
- [ ] **Step 4: Re-run focused database tests** and confirm behavior matches the partial unique index/RPC contract.

### Task 5: Full verification and delivery

**Files:**
- Modify: generated `src/integrations/supabase/types.ts` only if a forward migration is genuinely necessary.

- [ ] **Step 1: Run** `git diff --check`, `npm ci`, `npx tsc --noEmit`, `npm run lint`, `npm run test`, and `npm run build`.
- [ ] **Step 2: Run local DB validation only when Docker health permits it**; otherwise report GitHub database-validation reliance and the exact local limitation.
- [ ] **Step 3: Re-search for direct enrollment insert/update callers** and document any seed-only or intentionally deferred callers.
- [ ] **Step 4: Present exact changed files, tests, unresolved risks, and confirmations before committing.**
- [ ] **Step 5: Commit `feat: add enrollment context and conflict handling`, push the requested branch, and monitor both application and database workflows. Stop on either workflow failure.**
