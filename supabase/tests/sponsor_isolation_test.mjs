// Live integration test: proves a sponsor account cannot see another
// organization's data through the canonical sponsor_* SECURITY DEFINER functions,
// even calling them the same way a real client would (signed-in session,
// no ability to pass an org id — the functions derive it server-side).
//
// Creates temporary auth users/orgs/enrollments/sessions via the
// service-role key, signs in as each sponsor with the anon key (exactly
// what the browser client does), calls every sponsor_* RPC, asserts
// cross-org isolation, then deletes every fixture row it created.
//
// Run manually against the linked project:
//   node supabase/tests/sponsor_isolation_test.mjs
// Requires VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and
// SUPABASE_SERVICE_ROLE_KEY in the environment (already present in this
// workspace's secrets).

import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

const RUN_ID = Math.random().toString(36).slice(2, 8);
const PASSWORD = `Test-${RUN_ID}-Passw0rd!`;

const created = { users: [], orgIds: [], cohortIds: [], enrollmentIds: [], goalIds: [], sessionIds: [] };
let failures = 0;

function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`  FAIL: ${message}`);
  } else {
    console.log(`  ok: ${message}`);
  }
}

async function createAuthUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  created.users.push(data.user.id);
  return data.user.id;
}

async function insertCoachingSessionAsLeader(email, session) {
  const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw signInErr;

  try {
    const { data, error } = await client.from("sessions").insert(session).select().single();
    if (error) throw error;
    return data;
  } finally {
    await client.auth.signOut();
  }
}

async function makeSponsor(label, programmeId) {
  const email = `sponsor-isolation-${RUN_ID}-${label}@example.test`;
  const userId = await createAuthUser(email);

  // handle_new_user() defaults new signups to a 'coachee' role + profile row.
  // Replace that with sponsor for this test user.
  await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "coachee");
  await admin.from("coachee_profiles").delete().eq("id", userId);
  await admin.from("profiles").update({ status: "active" }).eq("id", userId);

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `Isolation Test Org ${label} ${RUN_ID}` })
    .select()
    .single();
  if (orgErr) throw orgErr;
  created.orgIds.push(org.id);

  const { data: cohort, error: cohortErr } = await admin
    .from("cohorts")
    .insert({ name: `Isolation Test Cohort ${label} ${RUN_ID}`, programme_id: programmeId,
      organization_id: org.id, start_date: "2020-01-01", end_date: "2030-01-01" })
    .select("id").single();
  if (cohortErr) throw cohortErr;
  created.cohortIds.push(cohort.id);

  const { error: roleErr } = await admin.from("user_roles").insert({ user_id: userId, role: "sponsor" });
  if (roleErr) throw roleErr;

  const { error: spErr } = await admin
    .from("sponsor_profiles")
    .insert({ user_id: userId, organization_id: org.id, title: "Head of L&D" });
  if (spErr) throw spErr;

  return { email, userId, orgId: org.id, cohortId: cohort.id };
}

async function makeLeader(label, orgId, cohortId, programmeId, coachId) {
  const email = `leader-isolation-${RUN_ID}-${label}@example.test`;
  const userId = await createAuthUser(email);
  await admin.from("profiles").update({ status: "active" }).eq("id", userId);

  const startDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { data: enrollment, error: enrErr } = await admin
    .from("programme_enrollments")
    .insert({
      id: crypto.randomUUID(),
      user_id: userId,
      coachee_id: userId,
      programme_id: programmeId,
      cohort_id: cohortId,
      organization_id: orgId,
      status: "active",
      progress_pct: 40,
      start_date: startDate,
    })
    .select()
    .single();
  if (enrErr) throw enrErr;
  created.enrollmentIds.push(enrollment.id);

  const { data: goal, error: goalErr } = await admin
    .from("coachee_goals")
    .insert({ coachee_id: userId, enrollment_id: enrollment.id, title: `Isolation test goal ${label}` })
    .select()
    .single();
  if (goalErr) throw goalErr;
  created.goalIds.push(goal.id);

  const { error: ratingErr } = await admin
    .from("coachee_goal_ratings")
    .insert({ goal_id: goal.id, coachee_id: userId, enrollment_id: enrollment.id,
      start_rating: 20, current_rating: 60, target_rating: 80 });
  if (ratingErr) throw ratingErr;

  // Programme Coaching eligibility is cohort-scoped. The learner-level
  // allowlist is legacy/non-programme authority and must not be used by this
  // canonical sponsor fixture.
  const { error: assignmentErr } = await admin
    .from("cohort_coach_assignments")
    .upsert(
      { cohort_id: cohortId, coach_id: coachId, is_active: true },
      { onConflict: "cohort_id,coach_id" }
    );
  if (assignmentErr) throw assignmentErr;

  const session = await insertCoachingSessionAsLeader(email, {
    enrollment_id: enrollment.id,
    coach_id: coachId,
    coachee_id: userId,
    topic: `Isolation test session ${label}`,
    start_time: new Date(Date.now() - 5 * 86400000).toISOString(),
    duration_minutes: 30,
    status: "completed",
    coachee_rating: 5,
  });
  created.sessionIds.push(session.id);

  return { userId, enrollmentId: enrollment.id };
}

async function callAllAsUser(email, ownCohortId, foreignCohortId) {
  const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw signInErr;

  const asOf = new Date().toISOString().slice(0, 10);
  const [
    enrollments,
    cohorts,
    organisation,
    metadata,
    foreignEnrollments,
    foreignCohorts,
    foreignMetadata,
  ] = await Promise.all([
    client.rpc("sponsor_canonical_enrollment_progress", {
      p_cohort_id: ownCohortId,
      p_as_of: asOf,
    }),
    client.rpc("sponsor_canonical_cohort_progress", {
      p_cohort_id: ownCohortId,
      p_as_of: asOf,
    }),
    client.rpc("sponsor_canonical_organisation_progress", { p_as_of: asOf }),
    client.rpc("sponsor_canonical_enrollment_metadata", {
      p_cohort_id: ownCohortId,
      p_as_of: asOf,
    }),
    client.rpc("sponsor_canonical_enrollment_progress", {
      p_cohort_id: foreignCohortId,
      p_as_of: asOf,
    }),
    client.rpc("sponsor_canonical_cohort_progress", {
      p_cohort_id: foreignCohortId,
      p_as_of: asOf,
    }),
    client.rpc("sponsor_canonical_enrollment_metadata", {
      p_cohort_id: foreignCohortId,
      p_as_of: asOf,
    }),
  ]);

  for (const [name, res] of [
    ["sponsor_canonical_enrollment_progress", enrollments],
    ["sponsor_canonical_cohort_progress", cohorts],
    ["sponsor_canonical_organisation_progress", organisation],
    ["sponsor_canonical_enrollment_metadata", metadata],
    ["foreign sponsor_canonical_enrollment_progress", foreignEnrollments],
    ["foreign sponsor_canonical_cohort_progress", foreignCohorts],
    ["foreign sponsor_canonical_enrollment_metadata", foreignMetadata],
  ]) {
    if (res.error) throw new Error(`${name} errored: ${res.error.message}`);
  }

  await client.auth.signOut();
  return { enrollments: enrollments.data, cohorts: cohorts.data, organisation: organisation.data,
    metadata: metadata.data, foreignEnrollments: foreignEnrollments.data,
    foreignCohorts: foreignCohorts.data, foreignMetadata: foreignMetadata.data };
}

async function checkDirectAccess(email, leaderId, enrollmentId, programmeId) {
  const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw signInErr;

  const checks = [
    ["profiles", client.from("profiles").select("id").eq("id", leaderId)],
    ["coachee_profiles", client.from("coachee_profiles").select("id").eq("id", leaderId)],
    ["programme_enrollments", client.from("programme_enrollments").select("id").eq("id", enrollmentId)],
    ["programme_modules", client.from("programme_modules").select("programme_id").eq("programme_id", programmeId)],
    ["get_enrollment_progress", client.rpc("get_enrollment_progress", {
      p_enrollment_id: enrollmentId,
    })],
  ];
  const results = await Promise.all(checks.map(([, request]) => request));
  await client.auth.signOut();
  return Object.fromEntries(checks.map(([name], index) => [name, results[index]]));
}

async function cleanup() {
  console.log("\nCleaning up fixtures...");
  for (const id of created.sessionIds) await admin.from("sessions").delete().eq("id", id);
  for (const id of created.enrollmentIds) {
    await admin.from("session_activity_attributions").delete().eq("enrollment_id", id);
  }
  for (const id of created.goalIds) await admin.from("coachee_goal_ratings").delete().eq("goal_id", id);
  for (const id of created.goalIds) await admin.from("coachee_goals").delete().eq("id", id);
  for (const id of created.enrollmentIds) await admin.from("programme_enrollments").delete().eq("id", id);
  await admin.from("sponsor_profiles").delete().in("organization_id", created.orgIds);
  for (const id of created.cohortIds) await admin.from("cohorts").delete().eq("id", id);
  for (const id of created.orgIds) await admin.from("organizations").delete().eq("id", id);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  console.log("Cleanup done.");
}

async function main() {
  console.log(`Run ID: ${RUN_ID}`);

  const { data: programme, error: progErr } = await admin
    .from("programmes")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .single();
  if (progErr) throw progErr;

  const coachId = await createAuthUser(`coach-isolation-${RUN_ID}@example.test`);
  await admin.from("profiles").update({ status: "active" }).eq("id", coachId);
  const { error: coachRoleErr } = await admin
    .from("user_roles")
    .upsert({ user_id: coachId, role: "coach" }, { onConflict: "user_id,role" });
  if (coachRoleErr) throw coachRoleErr;
  const { error: coachProfileErr } = await admin
    .from("coach_profiles")
    .upsert(
      { id: coachId, title: "Isolation test coach", approval_status: "active" },
      { onConflict: "id" }
    );
  if (coachProfileErr) throw coachProfileErr;

  console.log("\nCreating sponsor A + org A + leader A...");
  const sponsorA = await makeSponsor("a", programme.id);
  const leaderA = await makeLeader("a", sponsorA.orgId, sponsorA.cohortId, programme.id, coachId);

  console.log("Creating sponsor B + org B + leader B...");
  const sponsorB = await makeSponsor("b", programme.id);
  const leaderB = await makeLeader("b", sponsorB.orgId, sponsorB.cohortId, programme.id, coachId);

  console.log("\nCalling canonical enrollment/cohort/organisation sponsor functions as sponsor A...");
  const asA = await callAllAsUser(sponsorA.email, sponsorA.cohortId, sponsorB.cohortId);
  console.log("\nCalling canonical enrollment/cohort/organisation sponsor functions as sponsor B...");
  const asB = await callAllAsUser(sponsorB.email, sponsorB.cohortId, sponsorA.cohortId);

  console.log("\nAssertions:");
  // Visibility is the enrollment's organisation (20260925100000): no size
  // gate, each sponsor sees exactly its own organisation's leader.
  assert(asA.enrollments.length === 1 && asA.enrollments[0].enrollment_id === leaderA.enrollmentId,
    "sponsor A sees exactly organisation A's leader");
  assert(asB.enrollments.length === 1 && asB.enrollments[0].enrollment_id === leaderB.enrollmentId,
    "sponsor B sees exactly organisation B's leader");
  assert(asA.cohorts.length === 1 && asA.cohorts[0].cohort_id === sponsorA.cohortId &&
    asB.cohorts.length === 1 && asB.cohorts[0].cohort_id === sponsorB.cohortId,
    "each sponsor cohort RPC returns only its own cohort identity");
  assert(
    asA.enrollments.every((row) => row.enrollment_id !== leaderB.enrollmentId) &&
      asB.enrollments.every((row) => row.enrollment_id !== leaderA.enrollmentId),
    "sponsor reports cannot cross org or enrollment boundaries"
  );
  assert(asA.metadata.every((row) => row.enrollment_id === leaderA.enrollmentId) &&
      asB.metadata.every((row) => row.enrollment_id === leaderB.enrollmentId),
    "sponsor metadata carries only the sponsor's own organisation's leaders");
  assert(asA.foreignEnrollments.length === 0 && asA.foreignCohorts.length === 0 &&
    asA.foreignMetadata.length === 0 &&
    asB.foreignEnrollments.length === 0 && asB.foreignCohorts.length === 0 &&
    asB.foreignMetadata.length === 0,
    "own sponsor cannot query foreign cohort through any canonical reporting RPC");
  assert(
    !JSON.stringify(asA).includes(sponsorB.orgId) && !JSON.stringify(asB).includes(sponsorA.orgId),
    "neither sponsor's response mentions the other org's id anywhere"
  );

  console.log("\nChecking signed sponsor direct table/RPC access...");
  const directA = await checkDirectAccess(sponsorA.email, leaderA.userId, leaderA.enrollmentId, programme.id);
  const directB = await checkDirectAccess(sponsorB.email, leaderB.userId, leaderB.enrollmentId, programme.id);
  for (const [name, result] of Object.entries(directA)) {
    assert(!result.data || result.data.length === 0,
      `sponsor A cannot enumerate suppressed ${name} rows`);
  }
  for (const [name, result] of Object.entries(directB)) {
    assert(!result.data || result.data.length === 0,
      `sponsor B cannot enumerate suppressed ${name} rows`);
  }

  console.log("\nCalling functions directly with an unauthenticated (anon) client...");
  const anonClient = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const anonRoster = await anonClient.rpc("sponsor_canonical_organisation_progress", {
    p_as_of: new Date().toISOString().slice(0, 10),
  });
  assert(
    anonRoster.error?.code === "42501",
    "unauthenticated caller is denied at the grant level (42501), not merely handed empty data"
  );

  console.log("\nCalling functions as an authenticated non-sponsor (a coachee)...");
  const nonSponsorEmail = `nonsponsor-isolation-${RUN_ID}@example.test`;
  await createAuthUser(nonSponsorEmail);
  const nonSponsorRoster = await callAllAsUser(nonSponsorEmail, sponsorA.cohortId, sponsorB.cohortId);
  assert(
    nonSponsorRoster.enrollments.length === 0 &&
      nonSponsorRoster.organisation.length === 1 &&
      nonSponsorRoster.organisation[0]?.enrollment_count === 0 &&
      nonSponsorRoster.metadata.length === 0 &&
      nonSponsorRoster.foreignEnrollments.length === 0 &&
      nonSponsorRoster.foreignCohorts.length === 0 &&
      nonSponsorRoster.foreignMetadata.length === 0,
    "an authenticated coachee (not a sponsor) gets empty results from every canonical function, not an error"
  );

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) FAILED`);
  } else {
    console.log("\nAll assertions passed.");
  }
}

main()
  .catch((err) => {
    failures++;
    console.error("\nTest run threw an error:", err);
  })
  .finally(async () => {
    await cleanup();
    process.exit(failures > 0 ? 1 : 0);
  });
