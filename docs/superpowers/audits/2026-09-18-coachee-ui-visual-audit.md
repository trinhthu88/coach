# Clariva Coachee visual and source-of-truth audit

Prototype authority: `Clariva Coachee Prototype standalone-src.dc.html` at `c3cce25d68f88b0949c00e676481a1eb04f2b47c`.

The current learner implementation uses live canonical data. The sample values in the prototype are not production fixtures or fallbacks.

> **Correction (2026-09-18, later same day):** the previous version of this file marked every screen MATCH or INTENTIONAL FUNCTIONAL ADAPTATION and every plan task complete. That was not accurate. It was re-verified against actual git history (`git log --oneline -- <file>` per claimed file, plus reading the real commit diffs) rather than trusted at face value, and corrected below. Training & Learning, Coaching, Peer Coaching, Mentoring workspace, Triads workspace, Messages, and Profile & Availability have **not** been touched by this redesign effort — their last commits predate it entirely. Session Detail only gained a new Triad-specific page; Coaching and Mentoring session detail are unchanged. Do not trust a MATCH/adaptation classification below without confirming the cited file was actually modified for this effort (`git log --oneline -- <path>`).

## Screen comparison

| Screen | Result | Evidence / adaptation |
|---|---|---|
| Dashboard | MATCH | `CoacheeDashboard` follows Hero, Next Up, progress, journey preview, module progress, goals/actions, feedback/development, sessions, and recent development. Verified: all files under `src/pages/dashboard/coachee/` were authored for this effort. |
| My Journey | MATCH | `CoacheeJourney` uses the hero, horizontal canonical checkpoint timeline, development projection, and approved detail tabs (Overview, Goals, Actions, Sessions, Reflections, Feedback, Practice & Competency Analytics). Verified against the actual tab implementation and its tests. |
| Sessions | INTENTIONAL FUNCTIONAL ADAPTATION | The pre-existing `/sessions` list gained a working Triad filter (round/week/participants, role badge) alongside its existing coaching/peer/mentoring filters — real, verified work (`src/pages/Sessions.tsx`, `useSessionsData.ts`). It has **not** been restyled to the approved prototype's unified session-card visual design; it still uses its pre-redesign layout. |
| Session Detail | MISSING (partial) | Only Triads gained a dedicated new detail page (`src/pages/triads/TriadSessionDetail.tsx`, routed in `App.tsx`). Coaching (`SessionDetail.tsx`) and Mentoring (`MentoringSessionDetail.tsx`) detail pages are unchanged since before this redesign effort — no shared prototype-style detail shell exists yet. |
| Training & Learning | MISSING | `src/pages/TrainingWeeks.tsx` has not been modified since before this redesign effort (`git log` shows its last touch predates the prototype work). The page still functions on its pre-existing design, not the approved prototype layout. |
| Coaching | MISSING | `src/pages/Coaches.tsx` not modified for this effort. |
| Peer Coaching | MISSING | `src/pages/CoacheePeerPractice.tsx` not modified for this effort. |
| Mentoring | MISSING | `src/pages/MentoringFindMentor.tsx` not modified for this effort. |
| Triads (workspace) | MISSING | `src/pages/triads/TriadsPage.tsx` (group/role/round-history view) not modified for this effort — only the session-detail sub-page was added (see Session Detail row above). |
| Messages | MISSING | `src/pages/Messages.tsx` not modified for this effort. |
| Profile & Availability | MISSING | `src/pages/CoacheeProfileEditor.tsx` and `src/pages/CoacheeAvailability.tsx` not modified for this effort; they remain two separate pages, not the approved prototype's combined account workspace. |
| Mobile navigation | MATCH | Coachee mobile primary navigation (Dashboard, My Journey, Sessions, Messages, More) is implemented in `AppLayout.tsx` and covered by a passing test. |

## Source-of-truth mapping (for the screens actually implemented so far)

| UI | Read model / hook | Canonical source |
|---|---|---|
| Dashboard hero and progress | `useLearnerCanonicalProgress` | learner canonical progress and journey read models for selected `programme_enrollments.id` |
| Dashboard Next Up | `deriveNextUp` plus canonical progress/actions/session experience | learner journey requirements, `enrollment_actions`, and enrollment-linked session sources |
| Programme Journey | `useLearnerCanonicalProgress` | configured programme checkpoints and canonical activity attribution |
| Development Journey | `useEnrollmentDevelopmentJourney` | `enrollment_actions`, `sessions`, `peer_sessions`, `mentoring_sessions`, `triad_sessions`, five reflection sources, and learner-visible feedback |
| Goals and check-ins | `useJourneyGoals`, `useJourneyRatings` | goals, milestones, goal check-ins, and session ratings scoped to enrollment |
| Actions | `useEnrollmentActionsSummary`, `EnrollmentActionGroups` | `enrollment_actions.enrollment_id`, regardless of originating module |
| Reflections (My Journey tab) | `useEnrollmentDevelopmentJourney` reflection events + `useJourneyReflections` (private) | five canonical reflection sources, aggregated only at the read boundary |
| Feedback (My Journey tab) | `useLearnerFeedback` | `mentoring_feedback` / `peer_session_competency_feedback`, joined through the selected enrollment's session relationship |
| Practice & Competency Analytics | `usePracticeAnalytics` | selected enrollment's peer coaching sessions and `peer_session_competency_feedback`; `triad_reflections` intentionally excluded (no per-competency columns) |
| Sessions list (Triad support) | `useSessionsData` | `sessions`, `peer_sessions`, `coachee_peer_sessions`, `mentoring_sessions`, `triad_sessions` |

The remaining rows from the previous version of this table (Training, Coaching, Peer Coaching, Mentoring workspace, Triads workspace, Messages, Profile/Availability) are removed here — those screens have not yet been redesigned against the prototype, so there is no new source-of-truth mapping to report for them. Their existing (pre-redesign) hooks continue to serve real data; only the prototype visual/informational alignment is outstanding.

## Privacy and isolation checks (verified for the screens actually implemented)

- Learner feedback queries only `mentoring_feedback` and `peer_session_competency_feedback`, each filtered through the selected enrollment's session relationship. `coach_session_feedback` is never learner-visible — confirmed via `useLearnerFeedback`'s doc comment and its enrollment-isolation test.
- My Journey, goals, actions, sessions (Triad support), reflections, triad reflections, feedback, and dashboard/practice analytics receive the selected enrollment ID; no date-based assignment is used.
- Empty states render when canonical data is absent for every screen implemented so far.
- `rg -n "Mai Nguyen|September 2026|Clariva Demo Organisation|checkpointData|elp-sep-2026|Anna Fan|Linh Tran" src --glob '!**/__tests__/**'` returns no matches — confirmed no illustrative prototype sample data leaked into production source.
- The peer session source-specific field mapping remains `coach_notes` / `coachee_notes` for `peer_sessions`; no `provider_notes` / `receiver_notes` regression was introduced.

## Outstanding work

Training & Learning, Coaching, Peer Coaching, Mentoring workspace, Triads workspace, Messages, Profile & Availability, and the shared Session Detail shell (coaching/mentoring) still need their prototype-aligned implementation. See the plan file for the corrected task checklist.
