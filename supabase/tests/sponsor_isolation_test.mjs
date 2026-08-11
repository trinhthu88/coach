// Live integration test: proves a sponsor account cannot see another
// organization's data through the sponsor_* SECURITY DEFINER functions,
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

const created = { users: [], orgIds: [], enrollmentIds: [], goalIds: [], sessionIds: [] };
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

async function makeSponsor(label) {
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

  const { error: roleErr } = await admin.from("user_roles").insert({ user_id: userId, role: "sponsor" });
  if (roleErr) throw roleErr;

  const { error: spErr } = await admin
    .from("sponsor_profiles")
    .insert({ user_id: userId, organization_id: org.id, title: "Head of L&D" });
  if (spErr) throw spErr;

  return { email, userId, orgId: org.id };
}

async function makeLeader(label, orgId, programmeId, coachId) {
  const email = `leader-isolation-${RUN_ID}-${label}@example.test`;
  const userId = await createAuthUser(email);
  await admin.from("profiles").update({ status: "active" }).eq("id", userId);

  const startDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { data: enrollment, error: enrErr } = await admin
    .from("programme_enrollments")
    .insert({
      coachee_id: userId,
      programme_id: programmeId,
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
    .insert({ coachee_id: userId, title: `Isolation test goal ${label}` })
    .select()
    .single();
  if (goalErr) throw goalErr;
  created.goalIds.push(goal.id);

  const { error: ratingErr } = await admin
    .from("coachee_goal_ratings")
    .insert({ goal_id: goal.id, coachee_id: userId, start_rating: 20, current_rating: 60, target_rating: 80 });
  if (ratingErr) throw ratingErr;

  const { data: session, error: sessErr } = await admin
    .from("sessions")
    .insert({
      coach_id: coachId,
      coachee_id: userId,
      topic: `Isolation test session ${label}`,
      start_time: new Date(Date.now() - 5 * 86400000).toISOString(),
      duration_minutes: 30,
      status: "completed",
      coachee_rating: 5,
    })
    .select()
    .single();
  if (sessErr) throw sessErr;
  created.sessionIds.push(session.id);

  return { userId, enrollmentId: enrollment.id };
}

async function callAllAsUser(email) {
  const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw signInErr;

  const [roster, growth, satisfaction, kpis, timeline] = await Promise.all([
    client.rpc("sponsor_roster"),
    client.rpc("sponsor_goal_growth_summary"),
    client.rpc("sponsor_satisfaction_summary"),
    client.rpc("sponsor_kpis"),
    client.rpc("sponsor_timeline"),
  ]);

  for (const [name, res] of [
    ["sponsor_roster", roster],
    ["sponsor_goal_growth_summary", growth],
    ["sponsor_satisfaction_summary", satisfaction],
    ["sponsor_kpis", kpis],
    ["sponsor_timeline", timeline],
  ]) {
    if (res.error) throw new Error(`${name} errored: ${res.error.message}`);
  }

  await client.auth.signOut();
  return { roster: roster.data, growth: growth.data, satisfaction: satisfaction.data, kpis: kpis.data, timeline: timeline.data };
}

async function cleanup() {
  console.log("\nCleaning up fixtures...");
  for (const id of created.sessionIds) await admin.from("sessions").delete().eq("id", id);
  for (const id of created.goalIds) await admin.from("coachee_goal_ratings").delete().eq("goal_id", id);
  for (const id of created.goalIds) await admin.from("coachee_goals").delete().eq("id", id);
  for (const id of created.enrollmentIds) await admin.from("programme_enrollments").delete().eq("id", id);
  await admin.from("sponsor_profiles").delete().in("organization_id", created.orgIds);
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

  console.log("\nCreating sponsor A + org A + leader A...");
  const sponsorA = await makeSponsor("a");
  await makeLeader("a", sponsorA.orgId, programme.id, coachId);

  console.log("Creating sponsor B + org B + leader B...");
  const sponsorB = await makeSponsor("b");
  await makeLeader("b", sponsorB.orgId, programme.id, coachId);

  console.log("\nCalling all 5 sponsor_* functions as sponsor A...");
  const asA = await callAllAsUser(sponsorA.email);
  console.log("\nCalling all 5 sponsor_* functions as sponsor B...");
  const asB = await callAllAsUser(sponsorB.email);

  console.log("\nAssertions:");
  assert(asA.roster.length === 1, "sponsor A roster has exactly 1 leader (their own)");
  assert(asB.roster.length === 1, "sponsor B roster has exactly 1 leader (their own)");
  assert(
    asA.roster.length === 1 && asB.roster.length === 1 && asA.roster[0].enrollment_id !== asB.roster[0].enrollment_id,
    "sponsor A and sponsor B see different, non-overlapping enrollment ids"
  );
  assert(asA.kpis[0]?.leaders_enrolled === 1, "sponsor A KPIs count exactly 1 leader");
  assert(asB.kpis[0]?.leaders_enrolled === 1, "sponsor B KPIs count exactly 1 leader");
  assert(
    asA.growth[0]?.hit_target_count == null && asA.growth[0]?.enrolled_leaders_count === 1,
    "sponsor A goal-growth distribution is suppressed (org has < 5 leaders)"
  );
  assert(asA.satisfaction[0]?.rated_session_count === 1, "sponsor A satisfaction counts exactly 1 rated session");
  assert(asB.satisfaction[0]?.rated_session_count === 1, "sponsor B satisfaction counts exactly 1 rated session");
  assert(
    !JSON.stringify(asA).includes(sponsorB.orgId) && !JSON.stringify(asB).includes(sponsorA.orgId),
    "neither sponsor's response mentions the other org's id anywhere"
  );

  console.log("\nCalling functions directly with an unauthenticated (anon) client...");
  const anonClient = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const anonRoster = await anonClient.rpc("sponsor_roster");
  assert(
    anonRoster.error?.code === "42501",
    "unauthenticated caller is denied at the grant level (42501), not merely handed empty data"
  );

  console.log("\nCalling functions as an authenticated non-sponsor (a coachee)...");
  const nonSponsorEmail = `nonsponsor-isolation-${RUN_ID}@example.test`;
  await createAuthUser(nonSponsorEmail);
  const nonSponsorRoster = await callAllAsUser(nonSponsorEmail);
  assert(
    nonSponsorRoster.roster.length === 0 &&
      nonSponsorRoster.kpis[0]?.leaders_enrolled === 0 &&
      nonSponsorRoster.satisfaction[0]?.rated_session_count === 0,
    "an authenticated coachee (not a sponsor) gets empty results from every function, not an error"
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
