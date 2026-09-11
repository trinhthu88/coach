import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { DEMO_ACCOUNTS, LIVE_DEMO_VERSION } from "./manifest.ts";

async function assertRealAdmin(asUser: SupabaseClient): Promise<User> {
  const { data: { user }, error } = await asUser.auth.getUser();
  if (error || !user) throw new Response("Unauthorized", { status: 401 });
  const { data: allowed } = await asUser.rpc("is_real_clariva_admin");
  if (!allowed) throw new Response("Only a Clariva administrator may reset demo data", { status: 403 });
  return user;
}

async function findUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 1000) break;
  }
  return null;
}

Deno.serve(async (req) => {
  const headers = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!authHeader || !url || !anonKey || !serviceKey) throw new Response("Server configuration is incomplete", { status: 500 });

    const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const requester = await assertRealAdmin(asUser);
    const idempotencyKey = req.headers.get("idempotency-key") ?? crypto.randomUUID();
    const ids: Record<string, string> = {};

    for (const account of DEMO_ACCOUNTS) {
      const registered = await admin.from("live_demo_identities").select("user_id,email").eq("kind", account.kind).maybeSingle();
      if (registered.error) throw registered.error;
      let identity = registered.data ? await admin.auth.admin.getUserById(registered.data.user_id) : null;
      if (identity?.error) throw identity.error;
      if (!identity?.data.user) {
        const collision = await findUserByEmail(admin, account.email);
        if (collision) {
          if (collision.app_metadata?.live_demo !== true || collision.app_metadata?.demo_kind !== account.kind) {
            throw new Error(`Non-demo identity already uses ${account.email}; refusing to adopt it`);
          }
          identity = { data: { user: collision }, error: null };
        } else {
          const password = Deno.env.get(account.passwordEnv);
          if (!password || password.length < 12) throw new Error(`${account.passwordEnv} must contain at least 12 characters`);
          const created = await admin.auth.admin.createUser({
            email: account.email, password, email_confirm: true,
            user_metadata: { full_name: account.name },
            app_metadata: { live_demo: true, demo_kind: account.kind },
          });
          if (created.error || !created.data.user) throw created.error ?? new Error("Demo identity creation failed");
          identity = { data: { user: created.data.user }, error: null };
        }
      }
      if (identity.data.user.email?.toLowerCase() !== account.email) throw new Error("Registered demo identity email mismatch");
      const metadataUpdate = await admin.auth.admin.updateUserById(identity.data.user.id, {
        app_metadata: { ...identity.data.user.app_metadata, live_demo: true, demo_kind: account.kind },
      });
      if (metadataUpdate.error) throw metadataUpdate.error;
      ids[account.kind] = identity.data.user.id;
    }

    const { data, error } = await admin.rpc("reset_live_demo_data", {
      p_requester_id: requester.id,
      p_idempotency_key: idempotencyKey,
      p_fixture_version: LIVE_DEMO_VERSION,
      p_anchor_date: new Date().toISOString().slice(0, 10),
      p_identity_ids: ids,
    });
    if (error) throw error;
    return new Response(JSON.stringify(data), { headers: jsonHeaders });
  } catch (error) {
    if (error instanceof Response) return new Response(JSON.stringify({ error: await error.text() }), { status: error.status, headers: jsonHeaders });
    console.error("seed-demo-data failed", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Demo reset failed" }), { status: 500, headers: jsonHeaders });
  }
});
