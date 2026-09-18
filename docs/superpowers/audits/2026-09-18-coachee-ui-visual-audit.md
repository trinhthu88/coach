# Clariva Coachee visual and source-of-truth audit

Prototype authority: `Clariva Coachee Prototype standalone-src.dc.html` at `c3cce25d68f88b0949c00e676481a1eb04f2b47c`.

The current learner implementation uses live canonical data. The sample values in the prototype are not production fixtures or fallbacks.

## Screen comparison

| Screen | Result | Evidence / adaptation |
|---|---|---|
| Dashboard | MATCH | `CoacheeDashboard` follows Hero, Next Up, progress, journey preview, module progress, goals/actions, feedback/development, sessions, and recent development. |
| My Journey | MATCH | `CoacheeJourney` uses the hero, horizontal canonical checkpoint timeline, development projection, and approved detail tabs. |
| Sessions | MATCH | Unified source list has status/type filters, role/status cards, and enrollment-resolved programme/cohort context. |
| Session Detail | INTENTIONAL FUNCTIONAL ADAPTATION | Shared detail shell retains source-specific coaching, peer, mentoring, and triad fields; sections appear only where the canonical source supplies them. |
| Training & Learning | MATCH | Existing training routes render configured weeks and child-derived canonical progress. |
| Coaching | MATCH | Current coaching workspace, booking, preparation, reflection, actions, and empty Find a Coach state remain routed through existing hooks. |
| Peer Coaching | MATCH | Peer workspace and session detail preserve source-specific peer fields and `?type=peer` routing. |
| Mentoring | MATCH | Mentor workspace, preparation, mentee notes, mentoring reflection, and learner-visible feedback use mentoring sources. |
| Triads | MATCH | Group, role, sessions, round history, and self-reflection use canonical triad relationships; missing round/week values are omitted. |
| Messages | INTENTIONAL FUNCTIONAL ADAPTATION | Split-pane behavior uses the existing session message source; programme/session context is shown only when canonical context is available. |
| Profile & Availability | INTENTIONAL FUNCTIONAL ADAPTATION | Existing persisted profile fields and availability/peer opt-in controls are presented in the account workspace; unsupported prototype Preferences fields are not persisted. |
| Mobile navigation | MATCH | Coachee mobile primary navigation is Dashboard, My Journey, Sessions, Messages, More; More opens the full translated drawer. |

## Source-of-truth mapping

| UI | Read model / hook | Canonical source |
|---|---|---|
| Dashboard hero and progress | `useLearnerCanonicalProgress` | learner canonical progress and journey read models for selected `programme_enrollments.id` |
| Dashboard Next Up | `deriveNextUp` plus canonical progress/actions/session experience | learner journey requirements, `enrollment_actions`, and enrollment-linked session sources |
| Programme Journey | `useLearnerCanonicalProgress` | configured programme checkpoints and canonical activity attribution |
| Development Journey | `useEnrollmentDevelopmentJourney` | `enrollment_actions`, `sessions`, `peer_sessions`, `mentoring_sessions`, `triad_sessions`, five reflection sources, and learner-visible feedback |
| Goals and check-ins | `useJourneyGoals`, `useJourneyRatings` | goals, milestones, goal check-ins, and session ratings scoped to enrollment |
| Actions | `useEnrollmentActionsSummary`, `EnrollmentActionGroups` | `enrollment_actions.enrollment_id` |
| Sessions list | `useSessionsData` | `sessions`, `peer_sessions`, `coachee_peer_sessions`, `mentoring_sessions`, `triad_sessions`; programme/cohort joins through `programme_enrollments` |
| Coaching reflection | `useJourneyReflections` / session core | `sessions.coachee_notes` |
| Mentoring reflection and feedback | mentoring hooks / `useLearnerFeedback` | `mentoring_sessions.mentee_notes`, `mentoring_feedback` joined through `mentoring_sessions.enrollment_id` |
| Triad self-reflection | triad hooks and development journey | `triad_reflections`, with round/week through triad group → round → training week |
| Private reflection | `useJourneyReflections` | `coachee_reflections.enrollment_id` |
| Training | training hooks and canonical progress | configured training content, `programme_reflections` + `reflection_submissions`, and canonical child-derived progress |
| Practice analytics | `usePracticeAnalytics` | selected enrollment's coaching/peer activity and competency feedback |
| Messages | existing Messages page query/mutations | `session_messages` through canonical sessions |
| Profile and availability | account pages | `profiles`, `coachee_availability` |

## Privacy and isolation checks

- Learner feedback queries only `mentoring_feedback` and `peer_session_competency_feedback`, each filtered through the selected enrollment's session relationship. `coach_session_feedback` is never learner-visible.
- My Journey, goals, actions, sessions, reflections, triad reflections, feedback, dashboard progress, and practice analytics receive the selected enrollment ID; no date-based assignment is used.
- Empty states render when canonical data is absent; the production-source sample scan found no prototype learner, programme, cohort, static checkpoint, or illustrative session values.
- The peer session source-specific field mapping remains `coach_notes` / `coachee_notes` for `peer_sessions`; no `provider_notes` / `receiver_notes` regression was introduced.
