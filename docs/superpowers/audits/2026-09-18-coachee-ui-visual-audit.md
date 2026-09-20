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
| Training & Learning | MATCH | `src/pages/TrainingWeeks.tsx` was re-inspected (not just checked for a recent commit) and is already a canonical, child-derived vertical week timeline (locked/current/completed states, quiz scores, skill-card links) sourced via `get_my_training_weeks()` through `useProgrammeProgress` — no client-side recomputation, no fabricated categories. No changes made; none were needed. |
| Coaching | MATCH | `src/pages/Coaches.tsx` gained a new "My Coach" section (`src/pages/coachee/MyCoachSection.tsx`) — assigned coach, coaching progress, upcoming/past sessions — reusing `useMyCoachCardData` and `useEnrollmentSessions`. Renders nothing (not a fabricated coach) when none is assigned; the existing browse/search directory below still serves as Find a Coach either way. |
| Peer Coaching | MATCH | `src/pages/CoacheePeerPractice.tsx` gained `MyPeerPracticeSection.tsx` — upcoming/completed peer sessions and received competency feedback, reusing `useEnrollmentSessions` and `useLearnerFeedback` (kind `peer_competency`). Renders nothing when no peer session exists yet. |
| Mentoring | MATCH | `src/pages/MentoringFindMentor.tsx` gained `MyMentorSection.tsx` — current mentor (derived from the most recent/next booked `mentoring_sessions` row, since mentoring has no fixed 1:1 assignment like coaching's allowlist), upcoming/past sessions, and learner-visible mentoring feedback. Renders nothing when no mentoring session exists yet. |
| Triads (workspace) | MATCH | `src/pages/triads/TriadsPage.tsx` was re-inspected and already matches the prototype closely: a navy "My Triad Group" hero (`TriadGroupHero`), an upcoming-session card (`TriadSessionCard`), and a past-rounds table that already surfaces per-round reflection status (submitted/pending) and satisfaction ratings (`TriadPastSessionsTable`). No changes made. One documented gap: the canonical data model has no fixed per-member role column (`triad_groups` has three interchangeable member slots; `triad_reflections` records `learned_as_coach/coachee/observer` per submission, not a fixed assignment), so an explicit "Your role: Coach" label is not added — it would have to be invented. |
| Messages | INTENTIONAL FUNCTIONAL ADAPTATION | `session_messages.session_id` FKs only to `sessions` (coaching) — there is no canonical schema for peer/mentoring/triad messaging, so the prototype's multi-module inbox ("Anna Fan · Coaching", "Triad A · Round 2", etc.) cannot be implemented without inventing tables, which is explicitly against the brief. Added a real "Coaching" context label to each thread (every thread genuinely is a coaching conversation) instead of fabricating other categories. |
| Profile & Availability | MATCH | New `src/pages/coachee/CoacheeAccount.tsx` is the combined workspace the brief asked for (smallest clean implementation: Profile is the account workspace, Availability is a tab). `/coachee/profile` now renders it; `/coachee/availability` redirects to `?tab=availability`. `CoacheeProfileEditor.tsx` and `CoacheeAvailability.tsx` are otherwise unchanged (just gained an `embedded` prop to suppress their own duplicate header) — all existing persistence and mutations are untouched. No "Preferences" tab was added: the only real preference field (spoken languages) already lives in Profile, and the prototype's other Preferences controls have no backing schema. |
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
| Training & Learning | `useProgrammeProgress` (`get_my_training_weeks()`) | configured training weeks with cohort-relative unlock dates, canonical completion/quiz state |
| My Coach | `useMyCoachCardData`, `useEnrollmentSessions` | `coachee_coach_allowlist` (resolved coach), `sessions` filtered to type coaching |
| My Mentor | `useEnrollmentSessions`, `useLearnerFeedback` | `mentoring_sessions` (current mentor derived from most recent/next booked session), `mentoring_feedback` |
| Peer Coaching workspace | `useEnrollmentSessions`, `useLearnerFeedback` | `peer_sessions` / `coachee_peer_sessions`, `peer_session_competency_feedback` |
| Triads workspace | `useMyTriads` | `triad_groups`, `triad_sessions`, `triad_reflections` (`reflectionSubmitted` per round) |
| Messages | existing Messages page query/mutations | `session_messages` through `sessions` (coaching only — no other module has a messaging table) |
| Profile and availability | `CoacheeAccount`, `CoacheeProfileEditor`, `CoacheeAvailability` | `profiles`, `coachee_profiles`, `coachee_availability` |

## Privacy and isolation checks (verified for the screens actually implemented)

- Learner feedback queries only `mentoring_feedback` and `peer_session_competency_feedback`, each filtered through the selected enrollment's session relationship. `coach_session_feedback` is never learner-visible — confirmed via `useLearnerFeedback`'s doc comment and its enrollment-isolation test.
- My Journey, goals, actions, sessions (Triad support), reflections, triad reflections, feedback, and dashboard/practice analytics receive the selected enrollment ID; no date-based assignment is used.
- Empty states render when canonical data is absent for every screen implemented so far.
- `rg -n "Mai Nguyen|September 2026|Clariva Demo Organisation|checkpointData|elp-sep-2026|Anna Fan|Linh Tran" src --glob '!**/__tests__/**'` returns no matches — confirmed no illustrative prototype sample data leaked into production source.
- The peer session source-specific field mapping remains `coach_notes` / `coachee_notes` for `peer_sessions`; no `provider_notes` / `receiver_notes` regression was introduced.

## Outstanding work

The Sessions list's prototype visual redesign and a shared Session Detail shell for coaching/mentoring (Task 5, partial) are the only items remaining from the corrected plan. Everything else (Tasks 1-4, 6, 7) is now genuinely complete and verified.
