# Clariva source-of-truth contract

**One authoritative source per business fact.** Every Admin, Learner, Sponsor,
Analytics, Alerts, Dashboard, Journey or reporting surface is a *projection*
of that source. Role and privacy rules may hide detail. They must never
change how a number, date or state is calculated.

Derived or cached storage may exist when it's technically useful, but it is
never a second answer to a business question.

## Ownership matrix

| Business fact | Authoritative source | Read through (all roles) | Notes |
|---|---|---|---|
| **Programme required units** (what is required) | `programme_modules.config` (`required`, `required_units`) | `canonical_module_progress` → `canonical_enrollment_progress`; `programme_required_units`, `enrollment_module_config`, `get_enrollment_programme_modules` | Admin edits the programme template. Every reader takes the template as it is NOW: the enrollment-time `enrollment_module_snapshots.config` is historical and its capture trigger is dropped (`20261005130000`), so raising Coaching from 2 to 3 units changes progress, the calendar and booking eligibility together. |
| **Booking eligibility** (Coaching, Mentoring, Peer dyad) | a free requirement (`next_coaching_requirement` / `next_mentoring_requirement` / `next_peer_requirement`) + the cohort pool + the goal gate (`enrollment_goal_gate_blocked`) | `can_book_session` → `check_can_book_session`; `can_book_mentoring_session_reason` → `check_can_book_mentoring_session_reason_for_enrollment`; `can_book_coachee_peer_session` (the Admin-assigned partner instead of a pool, `20261006120000`) | `20261005130000`. No session allowance enters it: `receive_limit`, `monthly_limit`, `give_limit` and `programmes.coachee_session_limit` are not programme quantities, and the coach-as-coachee allowlist path is retired. No screen shows an allowance; booking pages, the Admin Coach lists and the Coach's own learner journey show the canonical module row (completed / required). Nothing enforces one either (`20261006110000`): the completion-count trigger `enforce_coach_as_coachee_limit`, the allowance readers (`get_coachee_session_usage_for_enrollment`, `check_mentoring_given_usage` and the functions behind it) and the Coaching / Mentoring limit checks in `validate_programme_module_config` are gone, and the Admin programme editors neither show nor save `give_limit` / `receive_limit` for Coaching or Mentoring. `programmes.coachee_session_limit` / `mentoring_received_limit` are historical columns. The Peer practice limit (`monthly_limit`) is separate: it caps practice from the Coach opt-in pool, which earns no requirement, per calendar month in `programme_time_zone()` (Asia/Ho_Chi_Minh). `peer_practice_month_count_internal` is its one count: the booking check (`assert_peer_session_bookable_internal`) and the usage a page shows (`get_peer_session_usage`) both read it (`20261006120000`). Nothing reads `receive_limit`, `give_limit`, `programmes.coachee_session_limit` or `mentoring_received_limit`; the values stay until production is verified, then a cleanup migration drops them. A Coaching reschedule is decided by `reschedule_coaching_session`, not by this check. |
| **Requirement due date** (every module, Training included) | `cohort_requirement_dates.due_on` — one date per requirement instance | `canonical_enrollment_requirement_calendar` | The cohort answers BY WHEN, per unit. A row an Admin dated (`is_overridden`) keeps its date; every other row follows its default. Written by `admin_set_cohort_requirement_dates` (`20260928100000`). `distribution_mode` stays retired: no policy spreads dates. |
| **Default module deadline** (session modules) | `cohort_module_deadlines.completion_deadline` (one per cohort × module) | `sync_cohort_requirement_dates` | The date new rows start at and non-overridden rows follow; "apply to all" resets rows to it. It never replaces the per-requirement dates. |
| **Cohort requirement identity** (Coaching / Peer / Mentoring / Triads / Training) | `cohort_requirement_dates` — exactly `required_units` rows per session module (`units = 1`, ordinals 1..N) and exactly one row per selected Training week (`training_week_id`, ordinal = week position) | `canonical_enrollment_requirement_calendar`, `sponsor_canonical_module_schedule` | Materialised in full on cohort creation and reconciled by `sync_cohort_requirement_dates` whenever the programme, the cohort, a training week, a cohort week override or the default deadline changes. **A mismatch is an integrity violation, not an operational state** — see below. |
| **Training week default date** | `cohort_week_overrides.unlock_date` → cohort start + (week − 1) × 7 → `training_weeks.unlock_date`, capped at the cohort end | `cohort_training_requirement_weeks` → `cohort_requirement_dates` (training rows) | Only the DEFAULT of a Training requirement. The date every role sees is the requirement's `due_on`; an Admin date on "Week 4" moves Week 4 everywhere. |
| **Training child learning types** | `programme_modules(training).config.learning_components` ⊆ {`skill_cards`, `quizzes`, `reflections`, `daily_prompts`} | `canonical_learning_breakdown` | Evidence inside each week, never extra units: Training = completed weeks / selected weeks. Only selected, visible weeks and visible items count; each child is dated from its week's requirement date. Counts only. |
| **Required vs scheduled (mismatch)** | derived from the two rows above | `cohort_module_schedule_violation`, `cohort_schedule_violations`, `cohort_requirement_schedule_issues` | **Diagnostic only.** "Coaching 5 required / 4 scheduled" is a migration or corruption state that the deferred guards refuse to commit and the booking RPCs refuse to operate against. Nothing is invented, and no projection compensates. |
| **Enrollment applicability** | `programme_enrollments` (programme, cohort, status) | canonical progress / journey wrappers | *Effective* status (after the programme end date) is computed once in `canonical_enrollment_progress`. |
| **Activity completion** | the session lifecycle, per requirement (Coaching / Mentoring / Triads); `peer_session_participants` for Peer (`20260921210000`; dyad sessions only since `20261005140000`); `session_activity_attributions` for quiz, daily prompt and Training | `sponsor_canonical_activity`, `canonical_training_learning_items` | Session booking dates never become requirement due dates. See the operational-vs-evidence rule below. |
| **Coach approval, invite limit, rating, sessions completed** | `coach_profiles.approval_status` / `max_coachee_invites` / `rating_avg` / `sessions_completed` | `coach_profiles` | Written only by an Admin or trusted SQL (`admin_update_coach`, `recompute_coach_rating`, the service role). `guard_coach_profile_protected_fields` refuses any other UPDATE of these four columns (`20261005120000`); a Coach still edits the rest of their own profile. |
| **Coaching provider** | `cohort_coach_assignments` | `cohort_coaching_coach_pool` → `enrollment_coaching_coach_pool` | The learner-level allowlists are not programme Coaching authority. |
| **Coaching requirement link** | `sessions.cohort_requirement_id` (server-assigned) | `canonical_coaching_requirement_fulfilment` → `learner_coaching_requirement_fulfilment`, `coach_coaching_requirement_fulfilment` | One live session per LEARNER per requirement. Set at booking and moved only by `reschedule_coaching_session`; `guard_session_protected_fields` refuses it (and `cohort_id`) in any app UPDATE (`20261005100000`). |
| **Coaching completion** | a COMPLETED session attributed to a requirement | `canonical_coaching_requirement_fulfilment` → `sponsor_canonical_activity` | Evidence never gates it (`20260921130000`). Only the session's Coach or an Admin marks it held, through `complete_coaching_session`; `transition_session_status` only confirms Coaching (`20261005100000`). |
| **Mentoring provider** | `cohort_mentors` | `cohort_mentoring_mentor_pool` → `get_mentors_for_enrollment` | The user-global `mentoring_allowlist` is not programme Mentoring authority. |
| **Mentoring requirement link** | `mentoring_sessions.cohort_requirement_id` (server-assigned) | `canonical_mentoring_requirement_fulfilment` | One live session per LEARNER per requirement. |
| **Mentoring completion** | a COMPLETED session attributed to a requirement | `canonical_mentoring_requirement_fulfilment` → `sponsor_canonical_activity` | The preparation document is optional and gates nothing. |
| **After-session evidence** | the evidence records themselves | `coaching_session_evidence`, `mentoring_session_evidence` | REPORTING ONLY. Neither returns a unit or progress field. |
| **Today and dates** (decision 2) | `programme_time_zone()` = Asia/Ho_Chi_Minh; `programme_today()` | every canonical function: "as of" defaults to `programme_today()`, and a date taken from a timestamp is `(ts AT TIME ZONE programme_time_zone())::date` (`20261006150000`, which also re-dated `session_activity_attributions.occurred_on`) | A session at 06:30 Vietnam time on 15 Oct is dated 15 Oct, not 14 Oct (UTC). No client sends its own as-of; booking pages read slot times with `slotInstant` / `slotTodayKey` (`src/lib/slotTime.ts`) and Edge Functions with `_shared/programmeTime.ts`. No public function reads `CURRENT_DATE` or takes a date in UTC (guarded by the migration and `one_today_test.sql`). |
| **Enrollment is ongoing** | stored `status` (`active`) + the enrollment's dates (else its cohort's) | `enrollment_is_ongoing(enrollment)` (`20261006160000`) | THE predicate for content access and evidence writes. `at_risk` is an effective status only (`canonical_enrollment_progress`): a CHECK refuses storing it. A cohort end-date change carries to enrollments still ending on the old date; an enrollment with its own end date keeps it (`cohorts_sync_enrollment_end`). |
| **Training week open** | cohort override → cohort week pacing → week date → due date, never after the cohort end | `canonical_training_week_available_on(enrollment, week)` → `canonical_training_week_fulfilment.available_on`, `get_enrollment_training_weeks.locked`; `training_week_open_for_enrollment_internal` / `learner_training_week_open` / `learner_training_evidence_allowed` (`20261006160000`) | Content RLS (`training_weeks`, `assignments`, `daily_prompts`, `programme_reflections`), `get_quiz_questions` and evidence writes (`training_progress`, `assignment_submissions`, `daily_prompt_responses`) all use it; no policy reads `unlock_date` or `CURRENT_DATE`. The Development Journey dates a completed week by canonical week completion (`get_enrollment_training_weeks.completed_at`). |
| **1:1 coaching engagement** (decision 4) | a cohort of `kind = 'engagement'` with one `cohort_coach_assignments` row | `admin_create_coaching_engagement` (Admin → Cohorts → New coaching engagement; Coaching-only programme, dates spread evenly through `admin_set_cohort_requirement_dates`, enrollment through `admin_create_programme_enrollment`); `coach_engagement_enrollments` (the Coach's client list) | Run by the same canonical engine as a group cohort, so learner, Coach and Admin read the same progress. A Coach refers a client with `coach_refer_client` (a pending `access_requests` row with `referred_by_coach_id`, `suggested_programme_id`); it grants nothing. `coachee_coach_allowlist` is historical: no app role writes it, and the coach invite function and invite slots are gone (`20261006170000`). |
| **Sessions hub requirement and next session** | `canonical_session_history` (`requirement_unit_number`, `requirement_due_on`) | `learner_session_history` (the viewer's own enrollments, every module), `learner_next_session_by_module` (next live session per module; Peer practice excluded) (`20261006180000`); Coaching the viewer gives: `coach_coaching_requirement_fulfilment` | The hub labels "Coaching 2" / "Peer 1" / "Mentoring 1" and a pending request's due date from these rows, and shows the next session per module; it picks neither from its own rows. A Coach who is also a learner sees the Coaching they receive (hub and Messages), each row marked with the viewer's side (`viewer_is_coach`). |
| **Sponsor needs attention and health** (decision 8) | `sponsor_needs_attention(pace_status, overdue_units)` = behind pace OR ≥ 1 overdue unit; `sponsor_health_signal(needing, leaders)` = green at 0%, amber ≤ 15%, red > 15% | `sponsor_canonical_enrollment_metadata.needs_attention`; `sponsor_canonical_cohort_progress` / `sponsor_canonical_organisation_progress` `.needs_attention_count`, `.health_signal` (`20261006190000`) | The Sponsor pages render these; the browser computes no ratio or threshold. Completed programme units carry one label everywhere ("Programme units completed"), never "units used". |
| **Admin completion rate; Mentor identity** | `canonical_enrollment_progress` units; `cohort_mentors` | `admin_canonical_completion_rate` (completed over required units across enrollments -- the Sponsor formula, never a mean of percentages); `is_active_cohort_mentor` (opens the mentoring routes to a Coach in a cohort Mentor pool) (`20261006200000`) | Admin → Mentoring lists each learner's Mentors as their cohort's pool, not `mentoring_allowlist`. Admin shows no invented values: a missing goal rating or Coach rating is "—", never 30 / 80 / 0. |
| **Requirement calendar** (due / completed / overdue per requirement) | computed once | `canonical_enrollment_requirement_calendar(enrollment, as_of)` → `admin_enrollment_requirement_calendar`, `learner_requirement_calendar`, `sponsor_leader_requirement_calendar` | `is_due_as_of = due_on ≤ as_of`; `is_completed` = fulfilled on/before as_of; `is_overdue = due_on < as_of AND NOT completed` (the due date has PASSED; due today is not yet overdue — `20260930100000`). Carries no narrative, so every role gets the same rows. |
| **Module completion, overall completion %, due-to-date adherence %, overdue units, pace** | counts over the calendar | `canonical_enrollment_progress` (per module: `canonical_module_progress`, which aggregates the calendar) → `learner_canonical_progress`, `sponsor_canonical_enrollment_progress` / `_leader_progress` / `_enrollment_metadata`, `admin_canonical_enrollment_progress` | Cohort and organisation rollups aggregate these per-enrollment rows (`20261006130000`): cohort `overdue_units` = Σ leader `overdue_units`; due adherence = Σ leader `least(completed, due)` / Σ due; schedule coverage = Σ leader `least(completed + booked, due)` / Σ due. The cohort row carries both credited sums (`adherence_credited_units`, `coverage_credited_units`) and the organisation row adds up cohort rows. A leader who is ahead never offsets another leader's overdue unit. |
| **Programme Journey checkpoints** | cumulative calendar counts | `canonical_enrollment_journey` → `learner_canonical_journey`, `sponsor_canonical_leader_journey`, `admin_canonical_enrollment_journey`; cohort view `get_sponsor_programme_journey` (same calendar, cohort aggregate) | One checkpoint per distinct requirement date D: required = requirements due ≤ D, completed = those that count for the programme as of the effective as-of (current fulfilment inside each requirement's availability window, late work included — `20260930100000`), so the final checkpoint always equals the canonical programme totals for the same population and as_of. State: see *Requirement availability, states and the programme-end freeze* below. Modules only in `module_scope`, never as a title. The UI never regroups checkpoints. The learner's "position" is a CALENDAR position (`journeyFocusIndex`: the checkpoint due today, else the next one by date, even if its requirements were completed early), never a completion position and never read from a state — several checkpoints can be `current` at once. |
| **Learner's current enrollment** (which enrollment every learner screen shows) | the learner's ONE ongoing `programme_enrollments` row (historical rows never chosen implicitly; two ongoing rows are an error) | `useActiveEnrollment()` (client resolver, built on `useEnrollmentContext`) → `learner_enrollment_context` (programme, cohort, organisation, effective dates) | Dashboard, My Journey, every module page, the Sessions hub and the sidebar read this one id. A failed or ambiguous resolution is shown as an error, never as an empty page. |
| **Peer requirement credit** | a session in the Admin-assigned dyad (`coachee_peer_sessions`; `validate_coachee_peer_session_partner` checks the active dyad) | `peer_attribute_participant_internal` (called by `sync_peer_session_participants`) → `peer_session_participants.cohort_requirement_id` → `canonical_peer_requirement_fulfilment` | `20261005140000`. A dyad session credits BOTH partners, each against their own cohort. A session booked from the Coach opt-in pool (`peer_sessions`) is **practice**: it keeps its participants (so the Sessions hub files it per viewer) but never holds a requirement — the `peer_practice_holds_no_requirement` CHECK enforces it — and it is labelled practice in CoachPeerCoaching and the Sessions hub. A Coach enrolled as a learner earns nothing for practice they give. `peer_participants_without_requirement` reports practice as its own reason. |
| **Whose enrollment a session belongs to (per viewer)** | the viewer's OWN participation: the session's enrollment for their own Coaching / Mentoring (as mentee) / Triad membership; their own `peer_session_participants` row for Peer | `viewerEnrollmentFor` → `viewer_enrollment_id` on every Sessions-hub row | One physical peer session can belong to different enrollments for its two participants. The learner hub's current view is `viewer_enrollment_id = active enrollment`; never the session row's or a partner's enrollment. |
| **Enrollment date range** | the enrollment's own dates, else its cohort's | `canonical_enrollment_progress.enrollment_start_date / enrollment_end_date` (effective, `20260928130000`) | One range on the learner header, the journey card, Sponsor and Admin. |
| **Learner Training weeks** | the programme's selected weeks (`training_week_ids`) and each week's Training requirement | `get_enrollment_training_weeks` (+ `requirement_due_on`, `requirement_state` from the calendar), `learner_training_week_items` (child evidence per week, from `canonical_learning_items`) | Never gated on `enrollment_module_snapshots` (historical); content unlocking is a separate availability rule. |
| **Organisation membership** | `programme_enrollments.organization_id` | `sponsor_visible_enrollments`, `admin_organization_enrollments`, `admin_organization_leader_summary`, the Admin roster | Never inferred from `cohorts.organization_id` (a default for new enrollments only); one cohort may mix organisations. |
| **Goal-setting period** | `cohorts.goal_setting_opens_on` / `goal_setting_due_on` (NULL = cohort start / start + 7) | `enrollment_goal_setting_period` → `enrollment_goal_gate_state` | An alert date only: never a requirement unit, never part of the booking decision (1–3 active goals, first one required before any booking). |
| **Session history** | session tables (`sessions`, `coachee_peer_sessions`, `peer_sessions`, `mentoring_sessions`, `triad_sessions`) | `learner_session_history` | |
| **Goals / actions** | `coachee_goals`, `coachee_goal_ratings`, `enrollment_actions` | per-goal progress `canonical_goal_progress`; aggregates `canonical_enrollment_engagement` | Archived goals are excluded; unrated goals have no progress. |
| **Reflections** | original reflection records; for Coaching and Mentoring `session_learning_reflections` | `learner_reflection_feed` | `sessions.coachee_notes` is historical for Coaching (`20260921190000`): it was a second place a reflection could live, so the feed and the Admin alert disagreed with the evidence record. |
| **Feedback** | original feedback records | learner feedback source (`useLearnerFeedback`) | Author-private notes are never selected. |
| **Triad membership** | `triad_group_members.enrollment_id` | `canonical_triad_group_members` → `learner_triad_members` | Never derived from session records or role columns. See the Triad ownership map below. |

## The quantity invariant

```
programme_modules.config.required_units = N      the ONLY answer to "how many?"
        ↓
exactly N rows in cohort_requirement_dates       units = 1, ordinals 1..N
        ↓                                         (Training: one row per selected week)
each row carries its OWN due date                default = module deadline / week pacing,
                                                 or the date an Admin set for that unit
```

**One programme unit = one cohort requirement = one ordinal = one date.**
The cohort never decides quantity; it decides only when each
programme-defined requirement is due.

A state such as `Programme = 4, Cohort = 3` is an **integrity violation**, not
a supported operational state. Since `20260923100000` it is enforced rather
than reported:

| Guard | Where | What it refuses |
|---|---|---|
| `cohort_requirement_dates_one_unit_per_row` | CHECK | any row with `units <> 1` |
| `cohort_requirement_dates_assert_schedule` | deferred constraint trigger | a commit leaving the wrong count, an ordinal gap or a duplicate |
| `programme_modules_assert_schedules` | deferred constraint trigger | a quantity change that leaves any cohort of that programme invalid — which is how "reduce 4 → 3 while requirement 4 holds a session" is blocked |
| `assert_enrollment_schedule_valid` | booking RPCs / eligibility | operating against an invalid schedule, with the named cause `cohort_schedule_invalid` |

Both triggers are `DEFERRABLE INITIALLY DEFERRED` on purpose: they judge the
**final** state at COMMIT, so `sync_cohort_requirement_dates()` can delete and
re-insert a whole module's schedule inside one transaction without tripping a
guard halfway through its own work.

The one state allowed to persist is `missing_deadline`: a cohort with no
completion deadline cannot materialise requirements, and no date may be
invented for it. It is **pending**, blocks booking, and is cleared by an Admin
setting the deadline — after which the full schedule materialises by itself.

`cohort_requirement_schedule_issues()` remains for readiness checks and
corruption detection. It is not the normal way a mismatch gets resolved,
because a mismatch can no longer normally occur.

## Triad ownership map

Established by `20260918185800_triad_cutover_ledgers`, `20260918185850_triad_reviewed_decisions`, `20260918185900_triad_legacy_data_cleanup`, `20260918189000_demo_generator_triad_model`, `20260918190000_triad_canonical_cutover` and `20260918195000_canonical_engagement_signals` (deployment 1, live since 2026-09-19), corrected by the forward migration `20260919120000_triad_requirement_groups` (every required Triad has its own group assignment). Legacy storage is dropped by `supabase/deployment-2/20260919190000_triad_retire_legacy.sql` (deployment 2, only after the above are verified in production).

**EVERY REQUIRED TRIAD HAS ITS OWN GROUP ASSIGNMENT.** The business model:

- **Programme** = how many Triads are required (N).
- **Triad requirement** = `cohort_requirement_dates` row "Triad 1 … Triad N" of the cohort, each carrying the cohort × Triads completion deadline (see Deadline model). This is the only Triad "round"; there is no other round object.
- **Group** = the enrollments assigned together for ONE requirement (`triad_groups.cohort_requirement_date_id`). The group owns no date: it references the requirement that owns the deadline.
- **Session** = the actual practice session of that group (normally one).
- **Fulfilment** = a completed session of a requirement's group fulfils THAT requirement, once, for every member of the group. It never fulfils another requirement.

A learner therefore has different group memberships for Triad 1, Triad 2, Triad 3 … (at most one active group per requirement). Extra sessions under one requirement are raw activity only. Nothing assumes the Triad 1 group continues into Triad 2.

| Triad fact | Authoritative source | Read through | Notes |
|---|---|---|---|
| Triad required count | `programme_modules` (`module = 'triads'`, `config.required_units`) | `canonical_module_progress` → `canonical_triad_completion` | Groups can only be created for learners whose programme requires Triads. |
| Triad requirement (Triad N + its deadline) | `cohort_requirement_dates` (`module = 'triads'`, `ordinal = N`, always `units = 1`) | `admin_cohort_triad_requirement`, `admin_cohort_triad_requirements`, `canonical_triad_completion.schedule`, journeys | Its identity is stable: "Regenerate schedule" updates rows in place, and a requirement with assigned groups can't be removed (`cohort_requirement_dates_keep_triad_groups`). Edit its date in the Cohort Requirement Schedule only; every role follows. |
| Triad group | `triad_groups.cohort_requirement_date_id` (+ `is_active`, `closed_at`, `assigned_by`, `group_language`); `cohort_id` is derived from the requirement and validated | `admin_cohort_triad_groups`, `learner_triad_overview` | One group per requirement assignment. Its requirement (and cohort) never change (`triad_guard_group`). |
| Triad members | `triad_group_members.enrollment_id` | `canonical_triad_group_members` → `learner_triad_members` | 2–3 enrollments of the requirement's cohort and programme. **One active group per enrollment per requirement** (`triad_validate_group_member`, serialised by an advisory lock). Membership is final once the group has any session: to regroup, close the group and create a replacement group for the SAME requirement. |
| Actual session | `triad_sessions` (`scheduled_start_time / scheduled_end_time`, `status`) | `learner_triad_overview`, `learner_session_history` (`requirement_unit_number` → "Triad N"), `admin_cohort_triad_groups` | `proposed → confirmed → completed`, or `cancelled`. `completed` and `cancelled` are final. One open session per group. Once the group's session is completed, the group schedules no further programme session (`learner_triad_schedule_session`). |
| Session acceptance | `triad_session_responses` (session × enrollment) | `learner_triad_overview` | Only members of the session's historical group can respond. |
| Alternative time | `triad_alternative_proposals` (`pending → accepted \| superseded \| withdrawn`) + `triad_alternative_proposal_responses` | `learner_triad_overview` | A candidate becomes the session time only when every member accepts it. |
| Goal check-in | `goal_checkins` (via `record_goal_checkins`, source `triad`) | `learner_reflection_feed` | Never copied into Triad tables. |
| Triad reflection | `triad_reflections` (one per session × enrollment; `satisfaction_rating`) | `learner_triad_session_reflections`, `learner_reflection_feed` | Group members see each other's only after everyone has submitted. Sponsors never see it. |
| Triad answers | `triad_reflection_answers` × `triad_reflection_questions` (stable ids / keys) | same | |
| Completion evidence | session × historical membership → `session_activity_attributions` (one writer: `triad_sync_session_attributions`) | `canonical_triad_requirement_fulfilment` | Session evidence only: `milestone_id` is always NULL for Triads. Dated on the session's scheduled start. A cancelled session is no evidence. |
| **Fulfilment** | evidence of the enrollment on a completed session of a group linked to requirement N | `canonical_triad_requirement_fulfilment` (one row per requirement: `fulfilled_on`, `booked_on`, `proposed_on`) → `sponsor_canonical_activity` (one Triad row per requirement, with `requirement_due_on`) | THE rule. Each requirement contributes at most one unit; a second session in the same group is raw activity only. |
| **Completion** | fulfilled requirements, capped at the programme's required units | `canonical_module_progress` → `canonical_triad_completion` (`completed_units`, `raw_completed_sessions` = activity only, `schedule` per requirement with its group) | |
| **Due / overdue** | each requirement against its own `due_on` (the shared module deadline, see Deadline model) | `canonical_module_progress` → `canonical_triad_completion` (`due_units`, `overdue_units`, `next_due_on`), journeys | `due_units` = requirements with deadline ≤ as-of. `overdue_units` = due requirements − fulfilled due requirements (an early Triad 2 never hides an overdue Triad 1). Journey checkpoints count a requirement only at checkpoints on or after its own deadline. `next_due_on` = earliest unfulfilled requirement. Per-requirement state (`canonical_triad_completion.schedule`, `triad_requirement_learners_internal` behind the Admin Triad view and Triad reminders) is the requirement calendar's (`20261006130000`): a Triad due today is due, not overdue. |
| Triad reflection rate | `triad_reflection_rate_internal` | `admin_programme_triad_reflection_rate`, `send-weekly-admin-summary` | An engagement signal, labelled "Triad reflection". It is never Triad completion. Weeks come from the canonical training schedule (`canonical_training_learning_items`); nothing rebuilds cohort weeks. |
| My Journey / Your Sessions / Dashboard | projections only | `learner_reflection_feed`, `learner_session_history`, `canonical_enrollment_journey` | No Triad data is copied into another table. No round or week label. |

Every role reads these facts from the same place: Admin (`admin_cohort_triad_learners`), Learner (`learner_triad_status`, `learner_canonical_progress`), Sponsor (`sponsor_canonical_leader_progress` / journey) and a coach enrolled as a learner (the learner path). Privacy can hide reflection content, but never changes a programme fact.

Assignment is always requirement-first: selected Triad requirement (`cohort_requirement_date_id`) → its cohort's eligible ongoing enrollments in its programme → exclude those already in an active group FOR THIS requirement (`triad_requirement_candidates_internal`; a learner grouped for Triad 1 is a Triad 2 candidate) → language → fewest repeated prior co-members (partners from the cohort's other Triads), then the most availability overlap → groups of 3 → optional dyad → unmatched learners are flagged for Admin. `triad-auto-assign` takes a `cohort_requirement_date_id` and reports how many prior partner pairs it could not avoid (`repeated_pairs`). Manual assignment (`admin_triad_create_group(p_cohort_requirement_date_id, …)`) is requirement-scoped and shows each candidate's prior partners. `triad_validate_group_member` rejects an enrollment outside the requirement's cohort or programme. Auto-assign has no scheduled run and no stored run state. Reminders (`triad-reminders`, `send-programme-reminders`) are per requirement.

### Retired Triad objects

| Retired | Class | Replacement |
|---|---|---|
| `triad_rounds` (incl. `completion_deadline`, `auto_assign_*`, `is_visible`, `title`) | DEPRECATED in deployment 1 (no client access; archived in `triad_cutover_archive`); DROPPED in deployment 2 | nothing: programme = quantity, `cohort_requirement_dates` = cumulative dates |
| `programme_triad_rounds` | DEPRECATED → DROPPED in deployment 2 (it never had a runtime consumer) | `programme_modules.required_units` + `cohort_requirement_dates` |
| `triad_groups.member_1/2/3_id`, `enrollment_1/2/3_id`, `programme_id`, `round_number`, `triad_round_id`, `name` | not written in deployment 1; DROPPED (archived) in deployment 2 | `triad_group_members`, `triad_groups.cohort_id` |
| `triad_sessions.coach_ / coachee_ / observer_enrollment_id` | same | `triad_group_members`. Every member rotates through every role. |
| `triad_sessions.member_N_response`, `triad_alternative_proposals.member_N_response` | same | `triad_session_responses`, `triad_alternative_proposal_responses` |
| `triad_sessions.proposed_start/end_time`, `start_time`, `proposed_by` | same | `scheduled_start_time / scheduled_end_time` |
| `triad_alternative_proposals.proposed_by` | same | `proposed_by_enrollment_id` |
| `triad_reflections.participant_id`, `learned_as_*`, `will_use_as_*` | same (answers backfilled verbatim) | `enrollment_id`, `triad_reflection_answers` |
| `validate_triad_group_enrollment_scope`, `validate_triad_session_enrollment_scope`, `auto_confirm_triad_session`, `auto_accept_alternative_proposal`, `attribute_new_triad_activity` | DROPPED | `triad_validate_group_member`, `triad_guard_session`, `triad_confirm_session_if_accepted`, `triad_accept_proposal_if_unanimous`, `triad_sync_session_attributions` |
| Cohort-level groups (deployment 1: `triad_cohort_candidates_internal`, `admin_triad_create_group(p_cohort_id, …)`, `triad_create_group_internal(p_cohort_id, …)`, completion = distinct completed sessions) | REPLACED by `20260919120000_triad_requirement_groups` (every existing group mapped to its requirement; ambiguity stops the deployment) | requirement-specific groups + `canonical_triad_requirement_fulfilment` |
| `cohort_triad_operations`, `triad_requirement_units_internal`, `triad_unit_enrollment_status_internal` | NEVER DEPLOYED | `cohort_requirement_dates` + `triad_groups.cohort_requirement_date_id` |
| `triad_cutover_review_decisions`, `triad_cutover_archive` | INTERNAL (no client access) | Audit only. They answer no current business question. |

**Production readiness.** For `20260919120000_triad_requirement_groups`, run `scripts/triad-requirement-groups-readiness.sql` (read-only) first: it previews the requirement every existing group maps to (unit = 1 + the member's earlier same-cohort groups with a completed session; all members must agree), lists blocking groups, groups with more than one completed session (the extras become activity only) and the demo sessions that move to their own Triad 2 groups. The migration itself stops if a group can't be mapped or if a real (non-demo) learner's Triad progress would change.

For deployment 1 (already applied), `scripts/triad-cutover-readiness.sql` (read-only) was run against the target before deploying.

- **Section 2** classifies every legacy Triad record that conflicts with the model: no cohort, a member outside the cohort, a programme without a Triad requirement, a reflection on an open or future session, or a duplicate completed session.
  - DEMO/SEED rows are archived and removed by `20260918185900`.
  - REAL/UNKNOWN rows stop the deployment until someone corrects the data or ships a reviewed `delete` decision in `triad_cutover_review_decisions`, in a migration between `20260918185800` and `20260918185900`.
- **Section 3** must be empty.
- **Section 5** shows each enrollment's Triad progress before and after.
- **Section 6** lists past `confirmed` sessions. The legacy `trg_auto_confirm_triad` reset a learner's "Mark complete". A session updated after both its insert and its start is a candidate for a reviewed restore. A session never updated since insert isn't one.


## Requirement availability, states and the programme-end freeze

Confirmed 2026-09-23, implemented by `20260930100000_journey_current_fulfilment`.

| Rule | Definition | Source |
|---|---|---|
| Training availability | a week's effective availability date; **no early-completion window** | `canonical_training_week_fulfilment.available_on` |
| Session availability (Coaching, Mentoring, Peer, Triads) | `due_on - 14 days` | `canonical_session_requirement_available_on` |
| Effective as-of | `least(as_of, programme end)`; programme end = the enrollment end date, else the cohort's | `canonical_enrollment_effective_as_of` |
| Counts for the programme | `available_on <= completed_on <= effective as-of` | `canonical_enrollment_requirement_calendar` |
| Training week complete | Skill Card AND Quiz (when configured) AND Reflection (when configured), each dated inside that window; Daily Prompts tracked, never gating | `canonical_training_week_fulfilment` |

Evidence dated before `available_on`, and activity after the programme end,
stay in their tables as history but earn no programme credit;
`admin_ineligible_programme_activity()` lists both. Booking rules are
unchanged: a session booked more than 14 days before its requirement's
deadline is still created, but fulfils nothing.

| State | Meaning (per requirement: `canonical_enrollment_requirement_status`) |
|---|---|
| `upcoming` | `available_on > effective as-of` |
| `completed` | counted, `completed_on <= due_on` |
| `completed_late` | counted, `completed_on > due_on` (necessarily <= programme end) |
| `overdue` | not counted and `due_on < effective as-of` |
| `current` | otherwise: available, not yet due, not complete |

**Journey checkpoints** (`canonical_enrollment_checkpoints`, and
`get_sponsor_programme_journey` for a cohort) count the SAME counted rows as
module progress: `required` = requirements due by D, `completed` = those that
count. An unavailable Training week can raise a checkpoint's denominator but
never its numerator. A checkpoint is `completed` / `completed_late` when all
its requirements count (late when one due ON D was fulfilled after D);
otherwise `overdue` when D has passed and an open requirement is available,
`upcoming` when an open requirement is not yet available, else `current`.
Late work is never a permanent `overdue`.

**Invariants** (asserted read-only by
`scripts/journey-current-fulfilment-verification.sql`, and by
`supabase/tests/requirement_availability_window_test.sql`): the final
checkpoint equals the canonical totals for the same population and as-of;
cohort totals are sums of the canonical leader rows, per module; nothing
counts outside its window.

**Training child learning types** (`learning_components`) are always explicit
on a Training module (`programme_modules_training_learning_components`).

## Operational completion is not evidence completion

Added by the 2026-09-21 Coaching and Mentoring remediation. Two different
facts, deliberately never fused:

**Operational completion** — the legitimate scheduled session took place and
reached `completed`. This, and only this, drives programme progress:

```
Coaching    completed session attributed to a requirement  -> one unit
Mentoring   completed session attributed to a requirement  -> one unit
Triads      fulfilled cohort requirement                   -> one unit
```

Triads differ on purpose: a Triad requirement may legitimately contain several
completed sessions, and only the requirement counts. Do not "simplify" Triads
into counting sessions.

**After-session evidence** — reflection, goal check-in, follow-up action,
satisfaction, provider notes, provider feedback, preparation document. Reported
by `coaching_session_evidence()` and `mentoring_session_evidence()`, which
return no unit or progress field of any kind. A surface may legitimately show:

```
Session completed · Reflection pending · Satisfaction pending
```

`20260920130000` originally made a Coaching unit complete only once all four
evidence items existed. That made a held session count as neither completed nor
booked once its date had passed, and — because the reflection had no writer
anywhere in the product — made Coaching completion unreachable for every
learner. `20260921130000` reverses it and renames `unit_complete` to
`evidence_complete`, so the two facts cannot be confused again by name.

### Who writes a session

Added by `20261005100000_session_write_lockdown`. A session row and its status
are written only by SECURITY DEFINER lifecycle functions; no client role holds
INSERT on `sessions`, `mentoring_sessions`, `peer_sessions` or
`coachee_peer_sessions`.

```
Book        book_coaching_session, book_mentoring_session, book_peer_session,
            book_coachee_peer_session, learner_triad_schedule_session
            -> always pending_coach_approval / proposed
Confirm     Coaching: confirm_coaching_session / transition_session_status('confirm')
                      -- Coach or Admin
            Peer: confirm_peer_session / transition_peer_session_status
                      -- the provider or an Admin
Complete    Coaching: complete_coaching_session          -- Coach or Admin
            Mentoring: transition_mentoring_session_status
            Peer: transition_peer_session_status
            Triads: learner_triad_complete_session
Cancel      Coaching: cancel_coaching_session; Peer: transition_peer_session_status
Admin       admin_reschedule_session (time, duration, topic, link)
            admin_reopen_session (cancelled -> pending_coach_approval,
                                  completed -> confirmed: the unit stops counting)
            -> Admin only, a reason, the booking rules re-run, one row in
               session_admin_audit (20261005110000)
```

A Peer or Triad time is never in the past: booking, scheduling, proposing an
alternative and accepting one all refuse a start before `now()`. The remaining
client UPDATE grant covers author-owned fields only (notes, meeting link,
Mentoring preparation document); `guard_session_protected_fields` refuses
everything else unless the lifecycle service set `app.session_transition`.
Admins have no bypass (`20261005110000`): an Admin edit is one of the calls
above, never a row write, and an Admin does not edit a participant's notes.
The `confirm-session` and `cancel-session` edge functions call
`confirm_coaching_session` / `confirm_peer_session` / `cancel_coaching_session`
/ `transition_peer_session_status` with the caller's JWT; the service role only
reads and sends email.

The Peer booking rules for `peer_sessions` (receiver enrollment ongoing, peer
coach opted in, Peer coaching enabled, entitlement not exhausted) have one
owner, `assert_peer_session_bookable_internal` (`20261006100000`). The
booking trigger `validate_peer_session_enrollment` and the Admin path
(`assert_admin_session_bookable_internal`, which adds the peer coach's
eligibility) both call it, so an Admin reschedule or reopen of a Peer session
re-runs the same rules as a booking.

## Canonical chains

```
Completion / progress
  canonical_module_progress (per module, internal)
    → canonical_enrollment_progress (THE enrollment row, internal)
        → learner_canonical_progress · sponsor_canonical_enrollment_progress · admin_canonical_enrollment_progress
        → sponsor_canonical_leader_progress · sponsor_canonical_enrollment_metadata (+ canonical_enrollment_engagement)
    → sponsor_canonical_cohort_progress_one / sponsor_canonical_cohort_progress (sums canonical enrollment rows)
        → sponsor_canonical_organisation_progress (sums visible cohort rows)

Journey:     sponsor_canonical_module_schedule → canonical_enrollment_journey → learner_ / sponsor_canonical_leader_ / admin_canonical_enrollment_journey
Experience:  canonical_enrollment_progress + schedule + activity → canonical_enrollment_experience_base → canonical_enrollment_experience
             → learner_canonical_experience · sponsor_canonical_leader_experience
Schedule state: cohort_programme_schedule_state → canonical_enrollment_schedule_state → learner_ / sponsor_canonical_leader_ / admin_canonical_schedule_state
```

Rollups only aggregate canonical rows (sums, counts of effective status and pace). They never recompute module progress, goal progress, overdue, adherence or status.

### Alerts, reminders and prompts (`20261006130000`, `20261006140000`)

| Surface | Reads |
|---|---|
| Admin → Alerts | `admin_alerts_current()`: alerts computed on read from canonical rows (effective status, `canonical_enrollment_progress` overdue / pace — decision 8, open actions past due, `canonical_session_deliverable_state`, `canonical_enrollment_inactivity_internal`, goal gate, coach flags), plus unresolved stored `admin_alerts` of other types. Nothing is scanned in the browser or stored as a snapshot. Missing reflections, Mentor feedback and preparation files are reminders: nothing gates completion on evidence. |
| `send-programme-reminders` (overdue quiz / reflection) | `training_overdue_assignment_targets_internal()`: the enrollment's calendar marks the Training week overdue, `canonical_training_week_fulfilment` says which part is missing. |
| `send-daily-prompt`, `get_todays_prompt` | `daily_prompt_targets_internal()` / `daily_prompt_for_enrollment_internal()`: the enrollment's current Training week from its own calendar (cohort overrides included), "today" in `programme_time_zone()`. |

## Table / function classification

| Object | Class | Canonical replacement / note |
|---|---|---|
| `programme_modules` | CANONICAL | Requirements + default policy |
| `cohort_requirement_dates` | CANONICAL | One dated requirement per required unit, Training weeks included |
| `canonical_enrollment_requirement_calendar` | CANONICAL (INTERNAL) | THE per-requirement due / completed / overdue rows; progress, overdue items and journeys aggregate it |
| `training_weeks`, `cohort_week_overrides` | CANONICAL | Training week content and pacing. They supply only the DEFAULT of a Training requirement date (cohort override → cohort calendar → programme template date). |
| `session_activity_attributions` | CANONICAL | Completion evidence |
| `canonical_module_progress`, `canonical_enrollment_progress`, `canonical_enrollment_journey`, `canonical_enrollment_experience(_base)`, `canonical_enrollment_engagement`, `canonical_goal_progress`, `canonical_training_learning_items`, `canonical_learning_breakdown`, `sponsor_canonical_module_schedule`, `sponsor_canonical_activity`, `cohort_programme_schedule_state`, `canonical_enrollment_schedule_state`, `sync_cohort_requirement_dates`, `cohort_module_schedule_violation` | CANONICAL (INTERNAL) | Shared constructions. Not client-callable. |
| `learner_canonical_*`, `sponsor_canonical_*`, `admin_canonical_*` | CANONICAL wrappers | Role eligibility only |
| `learner_next_coaching_requirement`, `learner_coaching_requirement_fulfilment`, `coach_coaching_requirement_fulfilment` | CANONICAL wrappers | Owner checks over `next_coaching_requirement` / `canonical_coaching_requirement_fulfilment` (`20261005120000`). A learner reads their own enrollment; a Coach reads only the units their own sessions fulfil. |
| every `canonical_*`, `*_internal` and `next_*_requirement` function, `programme_required_units`, `assert_enrollment_scope`, `resolve_current_enrollment` | INTERNAL (no client EXECUTE) | Revoked from PUBLIC, anon and authenticated (`20261005120000`); `service_role` keeps EXECUTE for edge functions. `supabase/tests/grants_and_profile_guard_test.sql` fails if any of them becomes client-executable again, and `src/test/clientRpcGrants.test.ts` fails if app code calls one. |
| `get_sponsor_programme_progress`, `get_sponsor_programme_journey`, `sponsor_canonical_cohort_progress_one` | INTERNAL | Projections used inside canonical functions; not client-callable |
| `attribute_activity_to_cadence_milestone`, `generate_enrollment_schedule`, `backfill_enrollment_schedule_snapshots` | INTERNAL / HISTORICAL | Maintain the snapshot history only |
| `enrollment_module_snapshots`, `enrollment_module_milestones` | HISTORICAL / DERIVED | Enrollment-time record for activity-to-milestone attribution. Never current requirements, dates or completion. `enrollment_module_snapshots.config` is no longer captured or read (`20261005130000`). |
| `get_enrollment_progress` | HISTORICAL | Snapshot progress engine; not client-callable |
| `programme_enrollments.progress_pct` | DEPRECATED | Not maintained (maintenance functions dropped), always NULL. Use `canonical_enrollment_progress.full_completion_pct`. |
| `sponsor_min_leaders_for_distribution()` | CANONICAL | Single zero-argument signature |
| Learner Training page unlock (`get_enrollment_training_weeks`, `get_my_training_weeks`) | CONTENT ACCESS | Unlocks content from the learner's own enrollment start. This is a content-availability rule, not a requirement due date. |
| `20260918090000_sponsor_canonical_calendar_followup.sql` | RETIRED | Intentional no-op |

### Retired (dropped in `20260918180000_retire_legacy_sponsor_sources`)

| Retired | Canonical replacement |
|---|---|
| `sponsor_enrollment_summaries` | `sponsor_canonical_enrollment_progress` / `sponsor_canonical_enrollment_metadata` |
| `sponsor_cohort_summaries`, `sponsor_cohort_summaries_legacy`* | `sponsor_canonical_cohort_progress` |
| `sponsor_organisation_summary`, `sponsor_organisation_summary_legacy`* | `sponsor_canonical_organisation_progress` |
| `sponsor_metric_rows`*, `sponsor_metric_rows_legacy`*, `sponsor_satisfaction_summary`, `sponsor_satisfaction_events`*, `sponsor_normalize_satisfaction`* | `canonical_enrollment_engagement` satisfaction fields (via `sponsor_canonical_enrollment_metadata`) |
| `sponsor_leader_engagement_summary` | `sponsor_canonical_enrollment_metadata` |
| `sponsor_leader_cadence_items`*, `sponsor_cohort_cadence_items`* | `canonical_enrollment_journey` |
| `sponsor_enrollment_next_session`*, `sponsor_canonical_leader_next_booking` | `canonical_enrollment_experience` → `coaching_utilisation.next_session_at` |
| `sponsor_leader_programme_history`* | `sponsor_canonical_leader_progress` |
| `sponsor_canonical_leader_experience_base`, `sponsor_canonical_leader_experience_legacy`, `learner_canonical_experience_legacy` | `canonical_enrollment_experience` |
| `get_admin_enrollment_progress` | `admin_canonical_enrollment_progress` |
| `dashboard_summary` (dropped in `20261005120000`; no caller, anon could execute it) | the role wrappers above |
| `compute_leader_progress`, `refresh_all_progress_pct`, `trg_update_progress_from_session`, `trg_update_progress_from_training` | none (`progress_pct` is deprecated) |

\* existed only on hosted production (not created by any repository migration).

### Known production-only exception

The demo-organisation reset tooling (30 `demo_*` / `get_demo_organization_status` functions and 5 `demo_*` tables) exists only on hosted production. It answers no programme business fact. Only `get_demo_organization_status` is client-callable, and it is Admin/service-role gated. Pending a decision: bring it under migration control, or remove it.

### Assessment review (`20261006210000`)

One pipeline for Triad submissions and the Final Assessment: learner submits → Admin assigns an assessor from the cohort pool → the assessor reviews → Admin approves (releases and notifies) or returns with a reason → only approved, released feedback reaches the learner. A Triad review is evidence: no Triad completion function reads these tables.

| Fact | Single owner | Read through |
|---|---|---|
| Who may assess in a cohort | `cohort_assessors` (written by `admin_set_cohort_assessor`) | `admin_cohort_assessors`, `admin_assign_assessor` |
| What was submitted, and its status | `assessment_submissions` (written by `learner_submit_assessment`, then only by the step functions) | `learner_assessment_status`, `admin_assessment_queue`, `coach_assessment_inbox` |
| Uploaded media, transcripts, feedback PDFs | `assessment_files` + bucket `assessment-files` (private; MP3 / PDF / txt / docx, 50 MB; paths `{enrollment}/{submission}/…`) | storage policies via `assessment_object_readable` / `_writable` / `_registered` |
| Who is assessing now | the one open `assessment_assignments` row (due 7 days after assignment) | `coach_assessment_inbox`, `admin_assessment_queue` |
| Each version of the feedback | `assessment_reviews` (`coach_submit_review`) | Admin queue; the learner only via release |
| Admin's decision | `assessment_validations` (`admin_validate_review`; return needs a reason; approve releases + notifies in one transaction) | Admin queue; the returned assessor sees the reason |
| Feedback the learner sees | the latest approved review of a released submission | `learner_assessment_feedback` (`canonical_assessment_feedback_internal`); `learner_mark_feedback_viewed` |
| Sponsor view | status and Pass / Not pass only | `sponsor_final_assessment_status` |
| Which Triads are assessed | `programme_modules.config.assessed_units` for `triads` (Programme Builder checkboxes; live, decision 1) | `triad_requirement_is_assessed`, `learner_triad_session_assessed` (the reflection form's notice) |
| A Triad submission | created by `learner_triad_submit_reflection` through `assessment_create_triad_submission_internal` (one per enrollment and session; evidence only, never read by `canonical_triad_completion`) | the assessment functions above |

The app holds no privilege on the six tables (rules 1, 4, 7); every timestamp is the server's (rule 8); the quiz score is `assignment_submissions.score_pct` (rule 9); type and size are refused by the bucket and again by the step functions (rule 10); foreign keys restrict deletes (rule 12). `supabase/tests/assessment_pipeline_test.sql` has one section per rule.

### Retirement backlog

Kept for now as HISTORICAL; no current-state surface may read them. Retire in a
cleanup migration once production is verified:

- `get_enrollment_progress`, `enrollment_module_snapshots`, `enrollment_module_milestones`,
  `session_activity_attributions` and the functions that maintain them
  (`attribute_activity_to_cadence_milestone`, `generate_enrollment_schedule`,
  `backfill_enrollment_schedule_snapshots`).
- The production-only demo-organisation reset tooling above (decision: demo data
  is kept, but flagged and excluded from every Admin and Sponsor metric).
- The retired limit storage: `programmes.coachee_session_limit`,
  `programmes.mentoring_received_limit` and the `give_limit` / `receive_limit`
  keys in `programme_modules.config` (`20261006110000`, `20261006120000`).

## Rules for new code

1. **Don't calculate** requirement dates, completion, adherence, overdue,
   status or checkpoints in the frontend. Render what the canonical RPC
   returns.
2. **Adding a role or surface** means adding an *eligibility wrapper* around
   the shared construction (`canonical_enrollment_progress`,
   `canonical_enrollment_journey`, `canonical_enrollment_schedule_state`).
   Never write a new aggregation.
3. **Granting a new function**: Supabase's default privileges grant EXECUTE
   on every new public function to anon and authenticated. A new or re-created
   `canonical_*`, `*_internal` or `next_*_requirement` function must be
   revoked from `PUBLIC, anon, authenticated` in the same migration;
   `grants_and_profile_guard_test.sql` fails otherwise. The app calls only a
   role wrapper with an owner check.
4. **Changing when a requirement is due** goes through the cohort: the
   module default (`admin_set_cohort_module_deadlines`) or one requirement's
   own date (`admin_set_cohort_requirement_dates`). An Admin-dated requirement
   is never rewritten implicitly.
5. **Snapshots and caches** must not be read by user-facing current-state
   surfaces.
6. **Guards enforce this contract** and must stay green:
   - `src/test/programmeProfileArchitecture.test.ts` and
     `src/test/migrationChain.test.ts` (frontend and migration chain);
   - `supabase/tests/cohort_requirement_schedule_test.sql`,
     `supabase/tests/requirement_calendar_contract_test.sql` (N units = N dated
     requirements, Admin = Learner = Sponsor numbers, organisation isolation),
     `supabase/tests/source_of_truth_contract_test.sql`,
     `supabase/tests/grants_and_profile_guard_test.sql` (no client-executable
     shared construction), `supabase/tests/one_quantity_authority_test.sql`
     (a raised `required_units` reaches eligibility and progress alike),
     `supabase/tests/canonical_progress_reconciliation_test.sql` (Admin =
     Learner = Sponsor = spine, Peer and a Coach enrolled as a learner
     included) and
     `supabase/tests/triad_canonical_contract_test.sql` (database);
   - the "Triad source of truth" block in `src/test/programmeProfileArchitecture.test.ts`,
     which also scans `supabase/functions` (no retired Triad field, no Triad round, no
     cohort-scoped assignment, requirement-scoped auto-assignment with repeated-partner
     minimisation, one Admin card / learner section per required Triad, sessions labelled
     "Triad N", per-requirement reminders, no local Triad completion, no client-side Triad
     date or overdue logic, and no "0 required" when the requirement fails to load);
   - the final-state guard at the end of
     `20260918170000_single_source_of_truth.sql`, which fails the deployment
     if the canonical definitions aren't in place; the final-state guards of
     `20260918190000_triad_canonical_cutover.sql` (equivalence with the legacy
     data), of `20260919120000_triad_requirement_groups.sql` (every group linked
     to a requirement of its cohort, one active group per enrollment per
     requirement, projection = canonical progress, real learners' progress
     unchanged, no retired field, no cohort-scoped assignment) and of
     `supabase/deployment-2/20260919190000_triad_retire_legacy.sql` (no
     retired Triad field or client-callable internal Triad function; the
     requirement link is required).

## Deadline model
One date per requirement instance (`20260928100000_requirement_calendar`,
superseding the one-deadline-per-module lock of `20260926400000`).

- Programme: `required_units = N` (Training: N selected weeks).
- Cohort: exactly N `cohort_requirement_dates` rows per required module, each with its own `due_on`.
- Default: a session row starts at, and while not overridden follows, `cohort_module_deadlines`; a Training row starts at, and follows, its week pacing date.
- Admin: `admin_cohort_requirement_schedule` (read) and `admin_set_cohort_requirement_dates` (a date = keep it; `null` = back to the default). "Apply the deadline to all" = reset every row of the module.
- Integrity: `cohort_module_schedule_violation` (Training included), `requirement_integrity_issues()` / `admin_requirement_integrity_issues()` (count mismatch, missing/duplicate ordinal, unmapped or unselected week, Training `required_units` ≠ selected weeks, requirement outside the cohort's programmes, ongoing enrollment without an organisation).
- Pinned by `supabase/tests/deadline_contract_test.sql` and `supabase/tests/requirement_calendar_contract_test.sql`.
- Verify any environment read-only with `scripts/requirement-calendar-verification.sql`.

## Demo data
As of 2026-09-23 there is no demo dataset. `supabase/seed-demo.sql` only ensures the Admin (`trang.tt@erickson.vn`) exists; an existing account is left untouched. The previous dataset (Organisations A/B, sponsors, coaches, the Cohort A–D learners such as Linh Nguyen and Ana Silva, and the Training content in `scripts/seed-training-content.sql`) was removed: it dated everything relative to the day it ran, so databases seeded on different days disagreed, and several learners contradicted the fulfilment rules of `20260930100000`. It remains in git history (up to commit `4ae79b0`).

A replacement will use fixed calendar dates, an explicit `cohort_requirement_dates.due_on` for every requirement, and must pass `admin_ineligible_programme_activity()`, `requirement_integrity_issues()` and `scripts/journey-current-fulfilment-verification.sql` with zero issues before it is applied anywhere.

`supabase/seed.sql` is separate: it is the local-only pgTAP fixture baseline applied by `supabase db reset`, not demo data.

There is no other demo generator. The out-of-band production generator (`demo_*` tables/functions) was retired by `20260926900000_retire_out_of_repo_demo_generator.sql` (functions dropped, tables archived in the locked `demo_archive` schema), and the `seed-demo-data` / `seed-tasc-content` edge functions were deleted.
