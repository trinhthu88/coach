# Live Demo Organization design

Date: 2026-09-11  
Repository: trinhthu88/coach  
Target branch: feature/enrollment-scoped-foundation  
Status: Design specification for review; implementation is not authorized by this document.

## Purpose and approved scope

Provide prospective clients with a realistic demonstration inside the live Clariva application. One permanent, generic **Clariva Demo Organization** contains fictional programme activity and four stable shared accounts: **Demo Learner — Executive Coaching (A)**, **Demo Learner — Emerging Leaders (C)**, **Demo Coach**, and **Demo Sponsor**. The owner manually distributes credentials to selected prospects. There is no public Try Demo page, public credential listing, automatic prospect signup, or client-branded copy workflow.

Learner and Coach use a hybrid experience: permitted everyday actions persist, while programme structure and core baseline records remain protected. Sponsor is strictly read-only and can explore filters, cohort selection, date ranges, drill-downs, exports, and report views. Changes remain until a real Clariva administrator invokes **Reset Demo Data**. There is no scheduled, nightly, login-triggered, or deployment-triggered reset.

This document defines future behavior only. It does not provision accounts, change production data, implement code, create migrations, deploy, merge, or authorize production enforcement. The next stage is review followed by a separately requested implementation plan.

## Repository grounding

Reviewed branch revision: e8ee09fb01c6b474f8b3694ef8ea24f5425e4867.

Relevant existing surfaces:

- `supabase/seed.sql` explicitly prohibits hosted/production use. It creates two cohorts and ten leaders, uses fixed dates and fixture IDs, looks up identities by email, and selects providers from existing coach roles. Those assumptions are unsuitable for this live subsystem.
- Enrollment ownership and schedule/progress are established through `20260910150000_enrollment_scoped_core.sql`, `20260910161000_enrollment_activity_ownership.sql`, and subsequent enrollment migrations. The live fixture must use the resulting current contracts, including snapshots, milestones, and enrollment-owned activities.
- `src/hooks/sponsor/useSponsorDashboardData.ts` uses `sponsor_cohort_summaries` and `sponsor_organisation_summary`; organization reporting is aggregate-only, with enrollment rows reached through an explicit unsuppressed cohort.
- `20260910173000_enrollment_sponsor_reporting.sql` and `20260911150000_final_privacy_and_peer_booking.sql` establish reporting authorization, suppression, and peer booking validation. Later definitions in the full migration chain remain authoritative.
- `src/pages/sponsor/SponsorSettings.tsx` currently permits profile, avatar, and notification preference writes. The demo restriction must cover these surfaces as well as business-data editing.
- `src/pages/admin/AdminOrganizations.tsx` is the existing organization-management surface for the future reset control.
- Existing enrollment, Sponsor isolation, and demo seed contract tests provide regression coverage to retain. The production-safe subsystem needs its own fixture and safety contract; the local fixture remains unchanged.
- `.agents/memory/enrollment-enforcement-gate.md` requires zero unresolved backfill audits and explicit approval before final production constraints or destructive cleanup.

These observations do not prove the branch is deployed or production isolation is complete. Verified production enrollment ownership and authorization are prerequisites to enabling the live demo.

## Architecture and alternatives

Choose a dedicated, versioned demo provisioning/reset subsystem in the live application, with database-enforced organization and enrollment boundaries. It uses normal application reads and permitted writes so reports demonstrate the real product.

A separate demo deployment would isolate infrastructure but duplicates release maintenance and does not match the approved live-organization model. Reusing the local seed would be simpler initially but brings unsafe identity lookup, provider selection, reset assumptions, and insufficient fixture coverage. Neither is selected.

The subsystem has five responsibilities:

1. **Protected registry:** identifies the sole demo organization, dedicated identities, baseline version, generation, state, and exclusively owned resources.
2. **Versioned fixture manifest:** defines fictional entities, relationships, schedules, permitted interaction targets, and expected reporting scenarios.
3. **Provisioning/reset executor:** validates scope and schema compatibility, serializes operations, and restores the approved baseline.
4. **Demo authorization layer:** intersects normal role permissions with a narrow demo allowlist on every entry point.
5. **Admin control and operation audit:** exposes reset status and records attributable administrative operations without credentials or private text.

These are logical components, not prescribed new table or function names. Exact storage/API signatures belong in the implementation plan after inspecting all current dependencies.

## Identity and ownership invariants

The demo organization has a stable UUID registered for the exact deployment/database. Its display name is not an authorization key. Privileged operations require agreement between server configuration and the protected registry; absent, duplicate, mismatched, or unverified configuration fails closed. The browser cannot supply an arbitrary target organization, table, fixture payload, or deletion list.

Register dedicated UUIDs for all demo identities. Never adopt an existing identity because its email or name matches. Any collision with an unregistered record aborts provisioning. Never attach a real coach, mentor, learner, Sponsor, administrator, organization, or enrollment to the demo.

Every mutable demo row must have provable ownership through its organization or an unbroken enrollment/cohort/organization chain. Records without an organization column, including programmes, content, profiles, provider availability, and relationship records, require an explicit protected ownership manifest plus validated references. A fixture ID or naming prefix alone is insufficient authority to delete.

Use dedicated demo programme/content records. Do not reset or mutate shared global templates. If any real enrollment, cohort, assignment, session participant, profile, or other record references a demo-owned resource, reset must abort before writes; it must not repair the real record or cascade through it. Enforce the reciprocal rule during normal writes so real clients cannot attach to demo resources.

All participants in coaching, mentoring, peer, triad, and booking relationships must be demo-owned and satisfy current enrollment rules. Preserve the one-ongoing-enrollment rule and explicit historical enrollment selection. Check every participant side, including triad coach/coachee/observer and peer giver/receiver relationships. Do not infer ownership from a user's current cohort when an activity has explicit enrollment ownership.

## Accounts and access

There are exactly four prospect-accessible logins: two separate learners, one Coach, and one Sponsor. Additional fictional leaders and providers are data identities, not additional distributed logins. If the schema requires Auth identities for those records, create them through supported administrative provisioning with interactive authentication disabled.

Both Demo Learners map to the normal coachee role. Demo Learner — Executive Coaching has one ongoing enrollment in Programme A / Cohort A. Demo Learner — Emerging Leaders has one ongoing enrollment in Programme C / Cohort C. They are separate identities, pre-enrolled by the administrator; prospects do not apply, self-enroll, switch programmes, or hold both ongoing enrollments on one account. The Demo Coach maps to the normal coach role and is assigned to both shared learners and a bounded set of other demo enrollments. Demo Sponsor has only the Sponsor role and is linked solely to the demo organization. None has admin privileges or real-organization memberships.

Provisioning creates dedicated accounts before publishing the completed organization as available. Shared login UUIDs and passwords survive ordinary data resets. Reset restores their application profiles, role assignments, and demo links, but does not delete/recreate Auth users or rotate passwords. Missing or compromised Auth identities require a separate privileged repair or credential-rotation operation; reset fails closed in that case. Secrets are stored outside source control and distributed manually by the owner.

Protect shared accounts against email/password changes, account deletion, role changes, invitations, linking external identities, and recovery-based takeover at the Auth/server boundary, not just in the interface. Operator-controlled recovery addresses are never prospect-controlled. Do not enable the demo until the deployed Auth configuration can enforce this contract. Administrative credential rotation remains available separately.

Show a persistent notice: this is a shared fictional demo, changes may be visible to other prospects using the same role, and users must not enter confidential information. Shared accounts cannot attribute an action to an individual prospect; audits identify the shared account and session, not an invented individual.

## Hybrid interaction contract

Normal role authorization still applies. An action is available only when the user's selected enrollment, enabled programme module and enrollment snapshot, lifecycle, ownership/assignment, entitlement, and demo allowlist all permit it. Demo authorization only narrows these permissions. The table below is the maximum safe action set, not a grant of every action to every learner. Every unlisted mutation is denied by default.

| Actor | Permitted behavior | Protected boundary |
| --- | --- | --- |
| Learner | Read their demo enrollment; create and edit their own goals/actions; complete actions; submit goal check-ins, reflections, training responses and numeric feedback | Current enrollment rules and goal limits apply; no structural changes or other learners' private data |
| Learner | Book a new session against dedicated demo availability; reschedule or cancel that interaction-created session | Only demo participants and enabled modules; normal entitlement and conflict validation |
| Coach | View assigned demo clients; add session notes, feedback, goal check-ins, and actions where the normal coach role permits | Only assigned demo enrollments; no reassignment or unrelated private records |
| Coach | Accept, reschedule, cancel, or complete interaction-created demo bookings | Cannot cancel, delete, reschedule, or rewrite baseline session history |
| Sponsor | Read authorized reports; change local filters, dates, cohort selection and views; download safe exports | No application-data, settings, avatar, notification, or account mutation |
| Real Clariva admin | Invoke the dedicated reset operation | Server-verified admin authority and fixed demo target required |

Core baseline includes organization identity, accounts and profiles, roles, programme structure, cohorts, enrollments, assignments, schedules, seeded sessions, content definitions, and historical results. Prospects cannot delete any baseline record. Seeded goals/actions explicitly marked interactive may receive normal progress/check-in/completion updates; their ownership and identifying baseline content remain protected. Other seeded rows are read-only. Interaction-created goals/actions may be edited and completed, but hard deletion is disabled for this first version.

Learner and Coach may create only activities supported by their existing permissions; this design does not grant the Coach learner-only reflection or training rights. Historical cohort activity is read-only for both. Structural fields, participant IDs, ownership IDs, baseline markers, and generation fields cannot be changed by clients.

No prospect file uploads, external calendar connections, real meeting provisioning, payments, email invitations, support-message sending, or outbound integrations are allowed. Demo activity must be excluded from email, push, webhook, digest, billing, and external automation delivery, including queued workers and reset-triggered events. Auth delivery is limited to operator-controlled account provisioning/recovery. In-app notifications may remain within the demo boundary.

Apply normal validation and bounded request/record limits to shared writes and exports. Reaching a limit rejects further writes with an explanatory message; it must never trigger automatic cleanup or reset.

## Fictional baseline and reporting coverage

Use the following fixed portfolio size: four distinct demo programmes, each with one corresponding cohort, and 40 distinct fictional leaders. The shared Executive Coaching learner is included among the 8 leaders in Cohort A; the shared Emerging Leaders learner is included among the 12 leaders in Cohort C. These accounts do not increase the total to 42. The shared Coach and Sponsor are not counted as leaders.

| Cohort | Leaders | Programme profile | Baseline lifecycle |
| --- | ---: | --- | --- |
| A — Executive Coaching | 8 | Coaching only | Active cohort containing the Executive Coaching learner and varied individual progress |
| B — Leadership Development | 10 | Coaching and blended development | Active cohort with mixed activity and satisfaction |
| C — Emerging Leaders | 12 | Blended training, coaching, mentoring, peer and triad activity | Active cohort containing the Emerging Leaders learner |
| D — Leadership Excellence | 10 | Completed blended programme | Historical completed cohort with mixed final outcomes |

An active cohort can contain paused, at-risk, or completed individual enrollments. Enrollment lifecycle and computed pace are separate dimensions: paused is not a fabricated pace enum. Across current cohorts demonstrate ahead, on_track, scheduled, behind, not_yet_due, and completed using actual progress calculations. Historical completion does not imply every goal was reached or all satisfaction scores were perfect.

The manifest must include completed and future booked coaching sessions; mentoring; valid peer and triad participants; varied attendance; training completion and incomplete work; goals with starting, current and target ratings; goal check-ins; open, in-progress and completed actions; reflections and assignment/prompt responses; and a mixture of numeric satisfaction scores and unrated activity. Include private fictional notes to prove Sponsor exclusion. Do not use real client text, emails, photos, logos, or copied records.

Dates are derived once per successful initialization/reset from a recorded UTC anchor date. Current cohort schedules span that anchor; historical schedules end before it. Record deterministic offsets and fixture version so the same version and anchor reproduce the baseline. Normal time continues afterward: pace may age and changes persist. Do not silently shift dates, freeze the application clock, or reseed on visits. A later manual reset establishes a new anchor.

Fixture assertions must use the real progress and Sponsor reporting functions at the anchor, rather than infer pace from row counts. Store schedules and enrollment snapshots consistently, respect module weights and entitlements, and keep optional/non-applicable modules distinct from zero completion.

## Programme modules and learner experiences

Each programme has a dedicated configuration and enrollment snapshots. A–D identify programmes as well as their corresponding cohorts; a programme and a cohort remain separate records. The following module matrix defines the demo baseline. B and D use the same blended module selection but separate programme records, schedules and content; D demonstrates completed historical delivery.

| Module / capability | A — Executive Coaching | B — Leadership Development | C — Emerging Leaders | D — Leadership Excellence |
| --- | --- | --- | --- | --- |
| Coaching | Enabled | Enabled | Enabled | Enabled; historical |
| Mentoring | Disabled | Enabled | Enabled | Enabled; historical |
| Peer coaching | Disabled | Disabled | Enabled | Enabled; historical |
| Triads | Disabled | Enabled | Enabled | Enabled; historical |
| Training / learning content | Disabled | Enabled | Enabled | Enabled; historical |
| Quizzes / assignments | Disabled | Enabled | Enabled | Enabled; historical |
| Daily prompts | Disabled | Enabled | Enabled | Enabled; historical |
| Programme reflections | Disabled | Enabled | Enabled | Enabled; historical |
| Enrollment goals, goal check-ins and actions | Available | Available | Available | Historical, read-only |
| Numeric session feedback | For enabled session types | For enabled session types | For enabled session types | Historical, read-only |

Goals, check-ins, actions and feedback are supporting capabilities governed by existing enrollment and activity rules, not newly invented programme module enums. Programme reflections belong to the enabled learning experience; their absence in A does not disable goal check-ins or coaching-session feedback. Map each learning capability to its existing module/content controls during implementation planning; do not add a duplicate module system. Enabled does not bypass content release dates, activity prerequisites, role permissions, session limits, or baseline protection.

**Learner A** demonstrates a focused coaching experience: their own programme overview, coaching bookings, goals, check-ins, actions, coaching progress and session feedback. Training, quizzes, daily prompts, programme reflections, mentoring, peer and triad actions are unavailable. A must not show missing training work or diluted progress because those modules are disabled.

**Learner C** demonstrates the full blended experience: coaching, mentoring, peer and triad participation plus released learning content, quizzes, prompts and programme reflections, alongside goals and actions. Safe writes are limited by the hybrid contract. Seed dedicated eligible partners, provider assignments and session opportunities so enabled activities have valid targets. Group participation does not permit editing baseline triad structure or other participants' records.

**Coach** sees both learner assignments and their different programme requirements. Assignment to C does not enable C's modules for A, and the coach role does not automatically grant mentor, peer, triad or learner permissions. Other required provider identities remain non-login fictional fixtures.

**Sponsor** can compare all four programmes and cohorts. Show disabled modules as not applicable, never as incomplete or zero performance; aggregate module metrics use only eligible enrollments. D retains its enabled configuration and recorded outcomes while its completed lifecycle blocks new activity.

The implementation plan must derive unit counts, weights and milestone schedules for these enabled modules using current programme configuration contracts. Those scheduling parameters do not change this module-selection decision or authorize implementation in this specification revision.

## Sponsor reporting and privacy

Use the existing production Sponsor reporting contracts and their current suppression threshold. Organization views are aggregate-only. Cohort selection permits authorized cohort reports; leader drill-down is limited to the existing Sponsor-visible enrollment summary in an explicit unsuppressed cohort. It never opens a learner's private profile or session payload.

Reports should visibly vary in participation, lifecycle, full completion, due adherence, booked coverage, overdue units, coaching/mentoring/peer/triad usage, goal progress, action completion, training and attendance, and numeric satisfaction. Calculate from fixture activity; do not hardcode display-only KPI totals. Undefined values remain unavailable rather than becoming misleading zeroes.

Filters and exports must use the same authorized population, field allowlist, aggregation semantics, and privacy suppression as displayed reports. Selecting another organization's cohort or tampering with an enrollment ID yields no unauthorized data. Narrow date ranges or combinations of filters must not defeat suppression.

Date controls must state whether they select activity within a period or a snapshot as of the end date. Period activity metrics count events in the inclusive selected dates; snapshot progress uses obligations and completed activity through the end date. Labels distinguish these meanings. Do not filter only the visible roster while presenting unchanged totals as period metrics. Any missing date-aware report contract is an implementation requirement, not permission to fabricate data.

Exports contain only Sponsor-visible reporting fields, clearly marked as fictional demo data, with selected scope, dates, and generation timestamp. Private notes, reflection text, goal/action narrative, session topics, feedback comments, contact information, and unauthorized identifiers must not appear in exports or hidden response fields. Escape spreadsheet formula-leading text when generating CSV. Generate downloads without persisting report edits or creating public share links. Auth/session bookkeeping and system audit records do not constitute Sponsor editing permissions.

## Production-safe provisioning and reset

Never execute, import, or remove the environment guard from `supabase/seed.sql` in production. Never run a database reset, truncate shared tables, disable RLS/triggers/foreign keys, or perform broad email/name-based cleanup. Use a separate explicit admin operation with an approved fixture version. Migrations may eventually establish infrastructure but must not automatically seed/reset the live organization.

The executor is server-only. Service-role credentials never reach the client. Because privileged execution can bypass RLS, every affected row needs explicit ownership validation and predicates; RLS alone is not the reset safety mechanism. Privileged database routines require restricted execution grants, fixed search paths, qualified objects, authenticated admin checks, and no arbitrary SQL or client-selected targets.

Reset sequence:

1. Verify current authenticated real-admin authority, configured environment, fixed registry identity, fixture/schema compatibility, and dedicated account integrity. Reject shared demo accounts regardless of supplied claims.
2. Allocate an operation ID and idempotency key. Acquire an organization-scoped lock shared with all demo mutation paths. Duplicate requests return the existing operation status; concurrent resets serialize or return busy.
3. Block new demo mutations, drain in-flight demo writes, and validate the complete dependency closure, including triggers, queues, storage and cross-organization references. An unknown table/dependency or any foreign ownership aborts before destructive work.
4. Within one database transaction, remove interaction-created demo data and restore approved baseline application rows in dependency order. Preserve the organization UUID, shared Auth identities, credentials, protected registry, and reset audit history. All cascades must be proven to remain in the demo closure.
5. Validate counts, references, roles, participant ownership, schedules, reporting scenarios and privacy; increment the demo generation and commit only if every assertion succeeds. On failure, roll back the entire data restoration.
6. Publish success, anchor and version; invalidate only demo caches and require clients to reload. Reopen demo mutations against the new generation.

All writes must verify the current generation under the same lock/transaction boundary; a request opened before reset cannot recreate stale records afterward. Reads and exports during reset return a clear temporary-unavailable result or a consistent previously committed snapshot, never partial baseline state. Multi-query reports must pin/check one generation and retry if it changes.

Ordinary reset performs no Auth API deletion, external file deletion, or network-dependent work inside the database transaction. Initial provisioning uses staged disabled identities and makes the demo available only after database validation; partial provisioning is recorded and retryable without touching unregistered identities. Static fixture assets are immutable; uploads are disabled, so reset has no mutable external storage to clean.

A lost HTTP response is resolved by querying the operation ID, not blindly starting another reset. Audit records capture requesting administrator, organization UUID, version, anchor, start/end time, outcome, generation and bounded affected-row counts. Audit failures before execution prevent reset; failed data transactions still receive a failure outcome through the operation record outside the rolled-back transaction. A stuck operation is reconciled against database transaction state before unlocking or retrying.

## Admin experience and failure behavior

Place **Reset Demo Data** in the demo organization's admin detail area. Show the last successful reset, fixture version, current state and operation result. The action is absent from real-organization details and all prospect accounts.

Before submission, show a confirmation naming Clariva Demo Organization and explaining that shared demo changes will be replaced and all four login credentials retained. No organization picker or freeform target is provided. Disable repeat submission while running and show success only after committed validation. Report failure with an operation reference; never display success for a partial restoration.

If configuration is invalid, ownership is ambiguous, accounts are missing, dependencies cross the boundary, or schema compatibility fails, keep existing data and refuse reset. A reset failure does not justify weakening scope checks. Operational recovery remains limited to the demo and never restores or rewrites the whole production database.

## Acceptance and release gates

Future implementation must demonstrate:

1. Exactly one registered demo organization, four accessible shared logins, four distinct programmes, and 8/10/12/10 fictional leaders across three active and one historical cohort.
2. Allowed Learner/Coach actions succeed and persist across logout and reload; structural edits, baseline deletion and historical writes fail through direct APIs as well as UI. Verify A and C with their separate learner logins: A cannot access C's training, mentoring, peer or triad actions by URL or API; C can use its enabled modules within normal permissions. Neither learner can access the other's private enrollment. Coach permissions are checked separately against each assigned enrollment. Disabled modules contribute neither missing-work indicators nor progress denominators.
3. Sponsor cannot mutate application settings or data through tables, RPCs, storage, Auth flows or alternate routes. Filters, dates, report views, cohort/leader drill-down and safe exports work.
4. Organization totals, cohort reports and exports reconcile using the real reporting contracts. All specified pace scenarios are verified at the baseline anchor.
5. Private text stays absent from Sponsor payloads and exports; production suppression remains effective under narrow filters.
6. Demo identities cannot discover, read, book, modify or message real client identities; real users cannot discover demo providers or join demo relationships through normal discovery routes. Test both directions with a second non-demo test organization.
7. Wrong organization/environment, ID/email collision, forged roles, tampered ownership, anonymous reset, real-resource references, and unknown dependencies all fail before data mutation.
8. Repeated reset, duplicate submission, concurrent writes, stale tabs, read/export races and injected failures at each reset stage produce one consistent generation or full rollback.
9. Non-demo test records and relationships remain byte-for-byte unchanged after seed/reset attempts; verify the full affected dependency set, not only organization row counts.
10. Auth IDs/passwords remain stable across reset, activity is restored, audit history survives, and no notification, calendar, payment or webhook escapes the demo.
11. Existing enrollment, Sponsor isolation and local-seed tests remain intact and pass alongside the new subsystem tests.

Run these destructive scenarios in isolated test/staging databases containing synthetic non-demo sentinel records. Production activation requires a separately reviewed rollout, deployed enrollment readiness, verified isolation and supported Auth restrictions. Do not use real client records as destructive test fixtures. This specification does not waive the existing production enforcement gate.

## Self-review

Reviewed for placeholders, contradictions, ambiguity and scope. The contract defines four distinct programmes and two separately enrolled learner accounts, with all four shared credentials preserved on reset. Module eligibility narrows every allowed action and reporting denominator. The contract distinguishes baseline protection from permitted progress updates, cohort lifecycle from computed pace, stable credentials from resettable application data, report exploration from Sponsor mutations, and ordinary persistence from reset-time date anchoring. Organization ownership covers resources lacking an organization column and every relationship participant. Reset concurrency, rollback, stale requests, external effects and identity collisions have explicit fail-closed behavior.

The deliverable is this design specification only. No code, migrations, production operations or implementation plan are included.
