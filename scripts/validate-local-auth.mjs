import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_AUTH_TEST_PASSWORD;
const demoEmails = (process.env.DEMO_AUTH_EMAILS ??
  "contact@erickson.vn,admin@demo.clariva.club,provider.1@demo.clariva.club,provider.2@demo.clariva.club")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

function fail(message) {
  console.error(`Demo Auth validation failed: ${message}`);
  process.exit(1);
}

if (!url || !anonKey || !serviceKey || !password) {
  fail("local Supabase URL, anon key, service key, or test password is missing");
}

const parsedUrl = new URL(url);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname)) {
  fail(`refusing to run against non-local host ${parsedUrl.hostname}`);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: listed, error: listError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listError) fail(`Auth Admin listUsers failed: ${listError.message}`);

const usersByEmail = new Map(
  (listed.users ?? [])
    .filter((user) => user.email)
    .map((user) => [user.email.toLowerCase(), user]),
);

for (const email of demoEmails) {
  const listedUser = usersByEmail.get(email);
  if (!listedUser) fail(`seeded demo user is not readable: ${email}`);

  const { data: fetched, error: fetchError } = await admin.auth.admin.getUserById(listedUser.id);
  if (fetchError || !fetched.user?.email) {
    fail(`Auth Admin getUserById failed for ${email}: ${fetchError?.message ?? "empty user"}`);
  }
  if (!fetched.user.email_confirmed_at) {
    fail(`demo user is not confirmed: ${email}`);
  }

  // The seed intentionally preserves existing credentials. This password is
  // assigned only to the disposable local CI database so every seeded Auth
  // identity can be exercised through the same password flow.
  const { error: passwordError } = await admin.auth.admin.updateUserById(
    listedUser.id,
    { password },
  );
  if (passwordError) {
    fail(`could not prepare local password authentication for ${email}: ${passwordError.message}`);
  }

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || signedIn.user?.id !== listedUser.id) {
    fail(`password authentication failed for ${email}: ${signInError?.message ?? "wrong user"}`);
  }
  await client.auth.signOut();
  console.log(`ok: ${email} is readable and authenticatable`);
}

console.log(`Demo Auth validation passed for ${demoEmails.length} local users`);