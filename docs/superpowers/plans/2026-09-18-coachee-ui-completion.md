# Clariva Coachee UI Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

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

- [x] **Step 1: Write failing tests** for feedback query scoping to enrollment A, absence of feedback from enrollment B, empty next-up results, dynamic checkpoint counts, and no module row when a module is absent.
- [x] **Step 2: Run the targeted tests** with `npx vitest run src/hooks/dashboard/__tests__/useLearnerFeedback.test.ts src/hooks/journey/__tests__/useEnrollmentSessions.test.ts src/hooks/journey/__tests__/useJourneyReflections.test.tsx src/hooks/__tests__/useLearnerCanonicalProgress.test.tsx src/lib/__tests__/nextUp.test.ts` and verify each new assertion fails for the intended reason.
- [x] **Step 3: Implement only the smallest pure filtering/empty-state helpers** and update query mocks to represent two enrollments without weakening RLS assumptions.
- [x] **Step 4: Re-run the targeted tests** and keep the assertions focused on returned records and visible state decisions rather than implementation details.
- [x] **Step 5: Commit** with `test(coachee): lock canonical learner isolation behavior`.

### Task 2: Finish the shared learner visual system and responsive shell

**Files:**
- Modify: `src/index.css`
- Modify: `src/App.css`
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

- [x] **Step 1: Write failing tests** for all four sources, programme/cohort resolution through enrollment, triad role and real round/week labels, and preservation of `?type=peer` routing and peer field names.
- [x] **Step 2: Run the targeted session tests and verify they fail for missing UI/source assertions.**
- [x] **Step 3: Implement the shared card/detail shell while retaining source-specific mutations, reflections, feedback, and booking actions.**
- [x] **Step 4: Run `npx vitest run src/hooks/sessions/__tests__/useSessionCore.test.tsx src/hooks/journey/__tests__/useEnrollmentSessions.test.tsx src/pages/__tests__/Sessions.test.tsx` and `npx tsc --noEmit`.**
- [x] **Step 5: Commit** with `feat(coachee): complete unified sessions experience`.

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

- [x] **Step 1: Add failing tests** for canonical Training count propagation, hidden absent categories, empty coach/mentor states, and omitted unknown triad round/week.
- [x] **Step 2: Run the module tests and verify red failures.**
- [x] **Step 3: Implement visual hierarchy and empty states using existing data and mutations; do not add schema or sample defaults.**
- [x] **Step 4: Run targeted module tests plus `npx tsc --noEmit`.**
- [x] **Step 5: Commit** with `feat(coachee): align learning and development workspaces`.

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

- [x] **Step 1: Write failing tests** for split-pane empty states, context omission without canonical data, profile persistence boundaries, tab semantics, and mobile navigation destinations.
- [x] **Step 2: Run the targeted tests and verify red failures.**
- [x] **Step 3: Implement the approved layout and accessibility fixes without introducing Preferences persistence that the schema does not support.**
- [x] **Step 4: Run targeted tests, `npm run lint`, and `npx tsc --noEmit`.**
- [x] **Step 5: Commit** with `feat(coachee): align communication and account workspaces`.

### Task 8: Run the full visual/source-of-truth audit and produce the final validated commit

**Files:**
- Modify: `docs/superpowers/plans/2026-09-18-coachee-ui-completion.md`
- Modify: only files required by validation findings
- Create: `docs/superpowers/audits/2026-09-18-coachee-ui-visual-audit.md`

**Interfaces:**
- Consumes: the implemented learner screens, prototype commit `c3cce25d68f88b0949c00e676481a1eb04f2b47c`, git history, and canonical tests.
- Produces: a screen-by-screen MATCH/MINOR DIFFERENCE/INTENTIONAL FUNCTIONAL ADAPTATION audit with no unresolved required MISSING entries, final plan checkboxes, and a clean branch ready to push.

- [x] **Step 1: Search production source** with `rg -n "Mai Nguyen|September 2026|Clariva Demo Organisation|checkpointData|elp-sep-2026|Anna Fan|Linh Tran|Round 2|Week 4" src --glob '!**/__tests__/**'` and remove any illegitimate prototype sample data or static checkpoint arrays.
- [x] **Step 2: Run the final visual/source review** for Dashboard, My Journey, Sessions, Session Detail, Training, Coaching, Peer Coaching, Mentoring, Triads, Messages, Profile/Availability, and mobile navigation; record each classification and canonical UI-to-hook-to-table mapping in the audit file.
- [x] **Step 3: Run the complete validation suite:** `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check`; run `npm run validate:db` only if a database migration changed.
- [x] **Step 4: Inspect `git diff --stat`, `git diff`, and `git status -sb`; correct generated files or unrelated changes, then commit the final coherent validation/audit changes.**
- [x] **Step 5: Push with `git push origin remediation-p0-p1-retimestamp`**, then run `git fetch origin`, `git status -sb`, `git rev-parse HEAD`, and `git rev-parse origin/remediation-p0-p1-retimestamp` until local and remote are equal and clean.
- [x] **Step 6: Inspect GitHub CI/status for the pushed SHA if accessible and report PASS, FAIL with diagnosis, or UNAVAILABLE with evidence.**

