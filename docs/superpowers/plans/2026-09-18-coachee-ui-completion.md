# Clariva Coachee UI Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **Correction (2026-09-18, later same day):** every checkbox below had been marked `[x]` without matching implementation for Tasks 5-7. Re-verified against `git log --oneline -- <path>` for every file each task claims to modify, not just diff stats or task-completion prose. Checkboxes below are corrected to match actual code state. Task 1's `coacheeSourceTruth.ts` was never created. Do not treat a checked box as proof of work without confirming the cited file's git history yourself.

**Goal:** Complete the approved Clariva Coachee prototype across the remaining real learner screens while keeping canonical application data, privacy boundaries, and enrollment isolation authoritative.

**Architecture:** Preserve the existing enrollment-scoped read models and session source adapters, then finish the UI through focused learner components. The dashboard and My Journey remain projections of `useLearnerCanonicalProgress`, `useEnrollmentDevelopmentJourney`, existing goals/actions/reflections hooks, and the selected enrollment; no prototype fixture data or second persistence model is introduced. Shared visual tokens and reusable cards provide the prototype hierarchy across desktop, tablet, and mobile while existing coach, sponsor, booking, messaging, and onboarding behavior remains intact.

**Tech Stack:** React 18, TypeScript, React Router, TanStack Query, Supabase, Tailwind CSS, Radix UI, Vitest, Testing Library, ESLint, Vite.

**Spec:** User-provided approved prototype requirements and `Clariva Coachee Prototype standalone-src.dc.html` at prototype commit `c3cce25d68f88b0949c00e676481a1eb04f2b47c`.

## Global Constraints

- The prototype controls presentation; canonical Clariva tables, RPCs, and existing read models control truth.
- Never copy prototype sample values into production constants, fallbacks, fixtures, calculations, or default cards.
- One learner plus one enrollment is one truth; all programme-specific UI resolves session or activity to enrollment, programme, and cohort.
- Preserve the four session sources and their source-specific fields, including `peer_sessions` field mapping and `?type=peer` routing.
- Preserve the five reflection sources and expose only learner-visible mentoring and peer feedback.
- Preserve the single `useEnrollmentDevelopmentJourney(enrollmentId, learnerId)` projection and canonical training progress.
- Hide absent modules and use honest empty states instead of `0 / 0` or illustrative content.
- Add new learner-facing copy to both `src/locales/en` and `src/locales/vi`.
- Do not alter sponsor or coach behavior except where a shared component requires a compatible non-breaking change.

---

### Task 1: Establish the source-of-truth regression contract

**Files:**
- Modify: `src/hooks/dashboard/__tests__/useLearnerFeedback.test.ts`
- Modify: `src/hooks/journey/__tests__/useEnrollmentSessions.test.ts`
- Modify: `src/hooks/journey/__tests__/useJourneyReflections.test.tsx`
- Modify: `src/hooks/__tests__/useLearnerCanonicalProgress.test.tsx`
- Modify: `src/lib/__tests__/nextUp.test.ts`
- Create: `src/lib/coacheeSourceTruth.ts`
- Test: the listed Vitest files

**Interfaces:**
- Consumes: existing Supabase query adapters and canonical progress types.
- Produces: small pure helpers for selected-enrollment filtering, empty-state decisions, and next-up priority that can be used by learner presentation components.

- [x] **Step 1: Write failing tests** for feedback query scoping to enrollment A, absence of feedback from enrollment B, empty next-up results, dynamic checkpoint counts, and no module row when a module is absent. (Done — `src/hooks/dashboard/__tests__/useLearnerFeedback.test.tsx`, `src/lib/__tests__/nextUp.test.ts`.)
- [x] **Step 2: Run the targeted tests** and verify each new assertion fails for the intended reason. (Done as part of the same work.)
- [ ] **Step 3: Implement only the smallest pure filtering/empty-state helpers.** `src/lib/coacheeSourceTruth.ts` was never created. The actual isolation fix landed directly inside `useLearnerFeedback.ts` (join through `mentoring_sessions.enrollment_id` / `peer_sessions.enrollment_id`) rather than as a separate pure-helper module — functionally equivalent and tested, but this file does not exist. Leaving unchecked so nobody goes looking for it.
- [x] **Step 4: Re-run the targeted tests.** (Passing — see current `npx vitest run` output.)
- [x] **Step 5: Commit.** (Landed across the Phase 1-4 commits on `remediation-p0-p1-retimestamp`, not as an isolated `test(coachee): ...` commit — the isolation fix and its test were part of the Dashboard phase commit.)

### Task 2: Finish the shared learner visual system and responsive shell

**Files:**
- Modify: `src/index.css`
- ~~Modify: `src/App.css`~~ (never touched — file exists but wasn't part of this work; listed here in error)
- Modify: `src/components/AppLayout.tsx`
- Modify: `src/locales/en/common.json`
- Modify: `src/locales/vi/common.json`
- Modify: `src/components/__tests__/AppLayout.test.tsx`

**Interfaces:**
- Consumes: existing `AppLayout`, language switcher, unread count, onboarding/help, sign-out, and mobile drawer behavior.
- Produces: centralized Clariva prototype tokens, focus-visible styles, responsive sidebar/drawer/mobile-nav treatment, and stable learner navigation labels.

- [x] **Step 1: Add failing layout assertions** for the learner menu order, absent module links, mobile primary destinations, keyboard focus visibility, and preserved unread/help/sign-out controls.
- [x] **Step 2: Run `npx vitest run src/components/__tests__/AppLayout.test.tsx`** and confirm the new behavior is red.
- [x] **Step 3: Move learner colors and surfaces to centralized CSS variables**, align desktop sidebar width/background and ivory content shell with the prototype, and make the existing drawer collapse into Dashboard, Journey, Sessions, Messages, and More on small screens.
- [x] **Step 4: Update only translated labels needed by the shell and run the layout tests plus `npx tsc --noEmit`**.
- [x] **Step 5: Commit** with `feat(coachee): align learner shell and responsive navigation`.

### Task 3: Complete dashboard projections and honest empty states

**Files:**
- Modify: `src/pages/dashboard/coachee/CoacheeDashboard.tsx`
- Modify: `src/pages/dashboard/coachee/CoacheeNextUpCard.tsx`
- Modify: `src/pages/dashboard/coachee/CoacheeProgrammeProgressCard.tsx`
- Modify: `src/pages/dashboard/coachee/CoacheeModuleProgressCard.tsx`
- Modify: `src/pages/dashboard/coachee/CoacheeGoalsActionsCard.tsx`
- Modify: `src/pages/dashboard/coachee/CoacheeFeedbackDevelopmentCard.tsx`
- Modify: `src/pages/dashboard/coachee/CoacheeUpcomingSessionsCard.tsx`
- Modify: `src/pages/dashboard/cards/RecentDevelopmentCard.tsx`
- Modify: `src/locales/en/dashboard.json`
- Modify: `src/locales/vi/dashboard.json`
- Modify: `src/pages/dashboard/coachee/__tests__/CoacheeDashboard.test.tsx`

**Interfaces:**
- Consumes: `useLearnerCanonicalProgress`, `useEnrollmentDevelopmentJourney`, enrollment actions, learner feedback, and `useEnrollmentSessions`.
- Produces: the specified dashboard order with live hero, prioritized derived Next Up, dynamic checkpoint preview, configured module progress, goals/actions, feedback/development, and upcoming sessions.

- [x] **Step 1: Add failing behavior tests** for all empty states, absent modules, canonical Training counts, and Next Up ordering.
- [x] **Step 2: Run the dashboard test file and confirm the new assertions fail.**
- [x] **Step 3: Implement the smallest component changes**, removing any fallback sample text and ensuring every count has a configured source before rendering.
- [x] **Step 4: Run `npx vitest run src/pages/dashboard/coachee/__tests__/CoacheeDashboard.test.tsx src/pages/dashboard/cards/__tests__/RecentDevelopmentCard.test.tsx` and `npx tsc --noEmit`.**
- [x] **Step 5: Commit** with `feat(coachee): complete canonical learner dashboard`.

### Task 4: Complete My Journey detail tabs and practice analytics integration

**Files:**
- Modify: `src/pages/CoacheeJourney.tsx`
- Modify: `src/pages/journey/EnrollmentActionGroups.tsx`
- Modify: `src/pages/journey/PracticeAnalyticsTab.tsx`
- Modify: `src/components/journey/ProgrammeJourneyTimeline.tsx`
- Modify: `src/components/journey/DevelopmentJourneyList.tsx`
- Modify: `src/locales/en/journey.json`
- Modify: `src/locales/vi/journey.json`
- Modify: `src/pages/journey/__tests__/EnrollmentActionGroups.test.tsx`
- Modify: `src/pages/journey/__tests__/PracticeAnalyticsTab.test.tsx`
- Modify: `src/components/journey/__tests__/ProgrammeJourneyTimeline.test.tsx`
- Modify: `src/components/journey/__tests__/DevelopmentJourneyList.test.tsx`

**Interfaces:**
- Consumes: existing goals, milestones, ratings/check-ins, actions, reflections, feedback, canonical progress, and the single development journey event list.
- Produces: prototype hierarchy with Overview, Goals, Actions, Sessions, Reflections, Feedback, and Practice & Competency Analytics tabs; dynamic checkpoint detail; vertical development timeline; source-transparent reflection and feedback cards.

- [x] **Step 1: Write failing tests** for five reflection labels/sources, selected-enrollment feedback display, triad round/week omission, dynamic checkpoint rendering, and analytics empty/insufficient-evidence behavior.
- [x] **Step 2: Run the focused component tests and confirm red failures.**
- [x] **Step 3: Implement focused detail cards and filters**, reusing current mutation hooks and analytics calculations without creating a second query or persistence table.
- [x] **Step 4: Run the focused tests plus `npx tsc --noEmit`.**
- [x] **Step 5: Commit** with `feat(coachee): complete journey detail projections`.

### Task 5: Finish unified Sessions and source-specific session details

**Files:**
- Modify: `src/hooks/journey/useEnrollmentSessions.ts`
- Modify: `src/pages/Sessions.tsx`
- Modify: `src/pages/SessionDetail.tsx`
- Modify: `src/pages/MentoringSessionDetail.tsx`
- Modify: `src/pages/triads/TriadSessionDetail.tsx`
- Modify: `src/components/sessions/UnifiedSessionCard.tsx` (create if absent)
- Modify: `src/hooks/sessions/__tests__/useSessionCore.test.tsx`
- Modify: `src/hooks/journey/__tests__/useEnrollmentSessions.test.tsx`
- Modify: `src/pages/__tests__/Sessions.test.tsx` (create if absent)

**Interfaces:**
- Consumes: the four canonical session sources, selected enrollment, source-specific details, and current booking/action routes.
- Produces: All/Upcoming/Completed and type filters; cards that identify what, programme, cohort, time, counterpart, learner role, status, and action; a consistent detail shell that exposes only valid source sections.

- [x] **Step 1: Write failing tests** for triad role, round/week labels, and enrollment context. (Done — `src/hooks/sessions/__tests__/triadSessionContext.test.ts`, `src/hooks/sessions/__tests__/sessionEnrollmentContext.test.ts`. `src/pages/__tests__/Sessions.test.tsx` was never created; no page-level test exists for the Sessions list.)
- [x] **Step 2: Run the targeted session tests.** (Passing.)
- [ ] **Step 3: Implement the shared card/detail shell.** Partial only. What actually happened: `src/pages/Sessions.tsx` and `useSessionsData.ts` gained working Triad support (4th filter, round/week, participants, role badge) on top of the *pre-existing* (pre-prototype) list design — real, verified, but not a redesign to the approved prototype's unified session-card visual. `src/pages/triads/TriadSessionDetail.tsx` is a genuine new page, routed in `App.tsx`. `src/pages/SessionDetail.tsx` (coaching/peer) and `src/pages/MentoringSessionDetail.tsx` are **unchanged** — no shared detail shell exists across all four session types. `src/components/sessions/UnifiedSessionCard.tsx` was never created.
- [x] **Step 4: Run the targeted tests plus `npx tsc --noEmit`.** (Both clean on current HEAD.)
- [ ] **Step 5: Commit** with `feat(coachee): complete unified sessions experience`. No such commit exists; the real work landed as `49f74b7 Implement session data updates and localize associated UI text`, which is accurate but narrower than "complete unified sessions experience" — remaining: prototype visual redesign of the Sessions list, and a shared Session Detail shell for coaching/mentoring.

### Task 6: Align Training & Learning and module workspaces

**Files:**
- Modify: `src/pages/TrainingWeeks.tsx`
- Modify: `src/pages/Coaches.tsx`
- Modify: `src/pages/CoacheePeerPractice.tsx`
- Modify: `src/pages/MentoringFindMentor.tsx`
- Modify: `src/pages/triads/TriadsPage.tsx`
- Modify: `src/components/training/DailyPromptCard.tsx`
- Modify: `src/locales/en/training.json`
- Modify: `src/locales/vi/training.json`
- Modify: `src/locales/en/coaches.json`
- Modify: `src/locales/vi/coaches.json`
- Modify: `src/locales/en/mentoring.json`
- Modify: `src/locales/vi/mentoring.json`
- Modify: `src/locales/en/triads.json`
- Modify: `src/locales/vi/triads.json`
- Modify: relevant existing module page tests

**Interfaces:**
- Consumes: canonical child-derived training progress, configured programme modules, current coach/peer/mentor/triad hooks, and booking routes.
- Produces: prototype-aligned module headers, expandable configured weeks/units, Find a Coach/Mentor empty states, peer partner context, triad group/role/round history, and no fabricated categories or people.

- [ ] **Step 1: Add failing tests.** Not done.
- [ ] **Step 2: Run the module tests and verify red failures.** Not done.
- [ ] **Step 3: Implement visual hierarchy and empty states.** Not done — none of `TrainingWeeks.tsx`, `Coaches.tsx`, `CoacheePeerPractice.tsx`, `MentoringFindMentor.tsx`, `TriadsPage.tsx`, or `DailyPromptCard.tsx` have been touched since before this redesign effort (confirmed via `git log --oneline -- <path>` for each). This whole task is outstanding.
- [ ] **Step 4: Run targeted module tests plus `npx tsc --noEmit`.** N/A until Step 3 happens.
- [ ] **Step 5: Commit.** No such commit exists.

### Task 7: Complete Messages, Profile & Availability, accessibility, and responsive verification

**Files:**
- Modify: `src/pages/Messages.tsx`
- Modify: `src/pages/CoacheeProfileEditor.tsx`
- Modify: `src/pages/CoacheeAvailability.tsx`
- Modify: `src/locales/en/profile.json`
- Modify: `src/locales/vi/profile.json`
- Modify: `src/locales/en/common.json`
- Modify: `src/locales/vi/common.json`
- Modify: relevant message/profile/availability tests

**Interfaces:**
- Consumes: existing message queries/mutations, profile persistence, availability persistence, language switching, and onboarding/help controls.
- Produces: split-pane messages with canonical context, profile/availability tabs that only save existing fields, translated copy, semantic headings/labels, keyboard tabs, focus-visible controls, and mobile-safe touch targets.

- [ ] **Step 1: Write failing tests.** Not done, except mobile navigation: `AppLayout.test.tsx`'s "coachee mobile navigation" coverage exists and passes.
- [ ] **Step 2: Run the targeted tests and verify red failures.** N/A beyond the mobile-nav coverage above.
- [ ] **Step 3: Implement the approved layout and accessibility fixes.** Not done — `Messages.tsx`, `CoacheeProfileEditor.tsx`, and `CoacheeAvailability.tsx` have not been touched since before this redesign effort (confirmed via `git log --oneline -- <path>` for each). Profile and Availability remain two separate pages, not the approved prototype's combined account workspace.
- [ ] **Step 4: Run targeted tests, `npm run lint`, and `npx tsc --noEmit`.** N/A until Step 3 happens.
- [ ] **Step 5: Commit.** No such commit exists.

### Task 8: Run the full visual/source-of-truth audit and produce the final validated commit

**Files:**
- Modify: `docs/superpowers/plans/2026-09-18-coachee-ui-completion.md`
- Modify: only files required by validation findings
- Create: `docs/superpowers/audits/2026-09-18-coachee-ui-visual-audit.md`

**Interfaces:**
- Consumes: the implemented learner screens, prototype commit `c3cce25d68f88b0949c00e676481a1eb04f2b47c`, git history, and canonical tests.
- Produces: a screen-by-screen MATCH/MINOR DIFFERENCE/INTENTIONAL FUNCTIONAL ADAPTATION audit with no unresolved required MISSING entries, final plan checkboxes, and a clean branch ready to push.

- [x] **Step 1: Search production source** for illustrative prototype sample data. (Re-run and confirmed clean — zero matches for `Mai Nguyen|September 2026|Clariva Demo Organisation|checkpointData|elp-sep-2026|Anna Fan|Linh Tran` outside tests.)
- [x] **Step 2: Run the final visual/source review**, corrected. The prior version of this step's output (the audit file) falsely marked Training, Coaching, Peer Coaching, Mentoring, Triads workspace, Messages, and Profile/Availability as MATCH or INTENTIONAL FUNCTIONAL ADAPTATION with no supporting code changes. Re-verified per-screen against `git log --oneline -- <path>` for every claimed file (not diff stats, not commit-message text) and rewrote `docs/superpowers/audits/2026-09-18-coachee-ui-visual-audit.md` accordingly — those seven screens are now honestly marked MISSING.
- [x] **Step 3: Run the complete validation suite.** Currently: `npx vitest run` 65/65 files, 287/287 tests; `npx tsc --noEmit` clean; `npm run lint` 0 errors (16 pre-existing warnings); `npm run build` succeeds; `git diff --check` clean. No database migration in this effort, so `npm run validate:db` not run.
- [ ] **Step 4: Inspect `git diff --stat`/`git diff`/`git status -sb`, then commit.** Pending — this correction itself needs to be committed.
- [ ] **Step 5: Push and confirm local/remote match.** Pending — do this after Step 4's commit.
- [ ] **Step 6: Inspect GitHub CI/status for the pushed SHA.** Pending — do after Step 5.

